import { moderateText } from "../lib/moderation.js";
import { buildPersonaInstructions } from "../lib/persona.js";
import { callGemini, GeminiProviderError } from "../lib/gemini.js";
import { checkRateLimit } from "../lib/rateLimit.js";
import {
  ChatRequest,
  ChatResponse,
  isChatRequest,
  sanitizeMessages
} from "../lib/types.js";

const MAX_BODY_BYTES = 80_000;
const MAX_MESSAGES = 30;

function corsHeaders(extra: HeadersInit = {}): Headers {
  const headers = new Headers(extra);
  headers.set(
    "Access-Control-Allow-Origin",
    process.env.ALLOWED_ORIGIN?.trim() || "*"
  );
  headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Client-ID"
  );
  return headers;
}

function jsonResponse(
  body: unknown,
  status = 200,
  extraHeaders: HeadersInit = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders({
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders
    })
  });
}

function getClientIdentifier(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim();

  return (
    request.headers.get("x-client-id")?.slice(0, 100) ||
    ip ||
    "unknown"
  );
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders()
      });
    }

    if (request.method !== "POST") {
      return jsonResponse({ error: "Use POST /api/chat." }, 405);
    }

    if (!process.env.GEMINI_API_KEY) {
      return jsonResponse(
        { error: "GEMINI_API_KEY não está configurada no servidor." },
        500
      );
    }

    const rawBody = await request.text();

    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      return jsonResponse({ error: "A conversa enviada é muito grande." }, 413);
    }

    let parsedBody: unknown;

    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      return jsonResponse({ error: "JSON inválido." }, 400);
    }

    if (!isChatRequest(parsedBody)) {
      return jsonResponse(
        {
          error:
            "Formato inválido. Envie messages e, opcionalmente, teacherMode, personaName e memory."
        },
        400
      );
    }

    const body: ChatRequest = parsedBody;
    const messages = sanitizeMessages(body.messages).slice(-MAX_MESSAGES);

    if (messages.length === 0 || messages.at(-1)?.role !== "user") {
      return jsonResponse(
        { error: "A última mensagem precisa ter role=user." },
        400
      );
    }

    const rate = checkRateLimit(getClientIdentifier(request));
    const rateHeaders = {
      "X-RateLimit-Limit": String(rate.limit),
      "X-RateLimit-Remaining": String(rate.remaining)
    };

    if (!rate.allowed) {
      return jsonResponse(
        { error: "Muitas mensagens em pouco tempo. Aguarde alguns instantes." },
        429,
        rateHeaders
      );
    }

    try {
      const lastUserMessage = messages.at(-1)?.content ?? "";
      const moderation = await moderateText(lastUserMessage);

      if (moderation.flagged) {
        const safeReply: ChatResponse = {
          reply:
            "Não consigo continuar por esse caminho. Podemos conversar sobre outra coisa?",
          blocked: true
        };
        return jsonResponse(safeReply, 200, rateHeaders);
      }

      const instructions = buildPersonaInstructions({
        teacherMode: body.teacherMode === true,
        memory: body.memory,
        userName: body.userName,
        personaName: body.personaName,
        friendshipLevel: body.friendshipLevel,
        friendshipXP: body.friendshipXP
      });

      const geminiResult = await callGemini({ instructions, messages });
      const reply = geminiResult.reply;
      const responseHeaders = {
        ...rateHeaders,
        "X-Gemini-Model": geminiResult.model
      };
      const outputModeration = await moderateText(reply);

      if (outputModeration.flagged) {
        return jsonResponse(
          {
            reply:
              "Prefiro responder de outra forma. Que tal mudarmos um pouco o assunto?",
            blocked: true
          } satisfies ChatResponse,
          200,
          responseHeaders
        );
      }

      return jsonResponse(
        { reply, blocked: false } satisfies ChatResponse,
        200,
        responseHeaders
      );
    } catch (error) {
      console.error("Chat API error:", error);

      const message =
        error instanceof Error
          ? error.message
          : "Erro desconhecido no servidor.";

      return jsonResponse(
        {
          error:
            process.env.NODE_ENV === "development"
              ? message
              : `Não foi possível obter uma resposta agora. Detalhe: ${message.slice(0, 220)}`
        },
        500,
        rateHeaders
      );
    }
  }
};
