import { moderateText } from "../lib/moderation.js";
import { buildPersonaInstructions } from "../lib/persona.js";
import { callGemini, GeminiProviderError } from "../lib/gemini.js";
import {
  acquireConcurrency,
  checkRateLimit,
  releaseConcurrency
} from "../lib/rateLimit.js";
import {
  ChatRequest,
  ChatResponse,
  isChatRequest,
  sanitizeMessages
} from "../lib/types.js";

const MAX_BODY_BYTES = 48_000;
const MAX_MESSAGES = 24;
const MAX_TOTAL_MESSAGE_CHARACTERS = 24_000;

function corsHeaders(extra: HeadersInit = {}): Headers {
  const headers = new Headers(extra);
  headers.set("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN?.trim() || "*");
  headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Client-ID, X-App-Token"
  );
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
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
  return request.headers.get("x-client-id")?.slice(0, 100) || ip || "unknown";
}

function isAuthorizedApp(request: Request): boolean {
  const requiredToken = process.env.APP_CLIENT_TOKEN?.trim();
  if (!requiredToken) return true;
  return request.headers.get("x-app-token") === requiredToken;
}

function rateHeaders(rate: ReturnType<typeof checkRateLimit>): HeadersInit {
  return {
    "X-RateLimit-Limit": String(rate.minuteLimit),
    "X-RateLimit-Remaining": String(rate.minuteRemaining),
    "X-RateLimit-Daily-Limit": String(rate.dailyLimit),
    "X-RateLimit-Daily-Remaining": String(rate.dailyRemaining),
    "Retry-After": String(rate.retryAfterSeconds)
  };
}

export default {
  async fetch(request: Request): Promise<Response> {
    const requestID = crypto.randomUUID();
    const startedAt = Date.now();

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (request.method !== "POST") {
      return jsonResponse({ error: "Use POST /api/chat." }, 405, { "X-Request-ID": requestID });
    }

    if (!isAuthorizedApp(request)) {
      return jsonResponse({ error: "Aplicativo não autorizado." }, 401, { "X-Request-ID": requestID });
    }

    if (!process.env.GEMINI_API_KEY) {
      return jsonResponse(
        { error: "GEMINI_API_KEY não está configurada no servidor." },
        500,
        { "X-Request-ID": requestID }
      );
    }

    const identifier = getClientIdentifier(request);
    const rate = checkRateLimit(identifier, "chat");
    const commonHeaders = { ...rateHeaders(rate), "X-Request-ID": requestID };

    if (!rate.allowed) {
      return jsonResponse(
        { error: "Limite de mensagens atingido. Aguarde antes de tentar novamente." },
        429,
        commonHeaders
      );
    }

    if (!acquireConcurrency(identifier)) {
      return jsonResponse(
        { error: "Já existem solicitações em andamento para este dispositivo." },
        429,
        commonHeaders
      );
    }

    try {
      const rawBody = await request.text();
      if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
        return jsonResponse({ error: "A conversa enviada é muito grande." }, 413, commonHeaders);
      }

      let parsedBody: unknown;
      try {
        parsedBody = JSON.parse(rawBody);
      } catch {
        return jsonResponse({ error: "JSON inválido." }, 400, commonHeaders);
      }

      if (!isChatRequest(parsedBody)) {
        return jsonResponse({ error: "Formato inválido para o Chat." }, 400, commonHeaders);
      }

      const body: ChatRequest = parsedBody;
      const messages = sanitizeMessages(body.messages).slice(-MAX_MESSAGES);
      const totalCharacters = messages.reduce((total, message) => total + message.content.length, 0);

      if (totalCharacters > MAX_TOTAL_MESSAGE_CHARACTERS) {
        return jsonResponse({ error: "O histórico contém texto demais." }, 413, commonHeaders);
      }

      if (messages.length === 0 || messages.at(-1)?.role !== "user") {
        return jsonResponse({ error: "A última mensagem precisa ter role=user." }, 400, commonHeaders);
      }

      const lastUserMessage = messages.at(-1)?.content ?? "";
      const moderation = await moderateText(lastUserMessage);
      if (moderation.flagged) {
        return jsonResponse(
          {
            reply: "Não consigo continuar por esse caminho. Podemos conversar sobre outra coisa?",
            blocked: true
          } satisfies ChatResponse,
          200,
          commonHeaders
        );
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
      const outputModeration = await moderateText(geminiResult.reply);
      const responseHeaders = {
        ...commonHeaders,
        "X-Gemini-Model": geminiResult.model
      };

      if (outputModeration.flagged) {
        return jsonResponse(
          {
            reply: "Prefiro responder de outra forma. Que tal mudarmos um pouco o assunto?",
            blocked: true
          } satisfies ChatResponse,
          200,
          responseHeaders
        );
      }

      console.info(JSON.stringify({
        event: "chat.success",
        requestID,
        model: geminiResult.model,
        durationMs: Date.now() - startedAt,
        messageCount: messages.length,
        totalCharacters
      }));

      return jsonResponse(
        { reply: geminiResult.reply, blocked: false } satisfies ChatResponse,
        200,
        responseHeaders
      );
    } catch (error) {
      const providerError = error instanceof GeminiProviderError ? error : undefined;
      const message = error instanceof Error ? error.message : "Erro desconhecido no servidor.";
      const status = providerError?.statusCode === 429
        ? 429
        : providerError?.statusCode === 504
          ? 504
          : providerError?.retryable
            ? 503
            : 500;

      console.error(JSON.stringify({
        event: "chat.error",
        requestID,
        durationMs: Date.now() - startedAt,
        status,
        error: message.slice(0, 300)
      }));

      return jsonResponse(
        {
          error: process.env.NODE_ENV === "development"
            ? message
            : status === 429
              ? "A capacidade da IA foi atingida. Tente novamente em instantes."
              : "Não foi possível obter uma resposta agora."
        },
        status,
        commonHeaders
      );
    } finally {
      releaseConcurrency(identifier);
    }
  }
};
