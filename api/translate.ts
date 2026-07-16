import { callGemini, GeminiProviderError } from "../lib/gemini.js";
import {
  acquireConcurrency,
  checkRateLimit,
  releaseConcurrency
} from "../lib/rateLimit.js";
import {
  isTranslationRequest,
  TranslationResponse
} from "../lib/types.js";

const MAX_BODY_BYTES = 8_000;

function corsHeaders(extra: HeadersInit = {}): Headers {
  const headers = new Headers(extra);
  headers.set("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN?.trim() || "*");
  headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, X-Client-ID, X-App-Token");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return headers;
}

function jsonResponse(body: unknown, status = 200, extra: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders({ "Content-Type": "application/json; charset=utf-8", ...extra })
  });
}

function identifier(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return request.headers.get("x-client-id")?.slice(0, 100) || forwarded || "unknown";
}

function authorized(request: Request): boolean {
  const token = process.env.APP_CLIENT_TOKEN?.trim();
  return !token || request.headers.get("x-app-token") === token;
}

function parseJSONReply(text: string): TranslationResponse | undefined {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    const value = JSON.parse(cleaned) as Record<string, unknown>;
    if (typeof value.romaji === "string" && typeof value.translation === "string") {
      const romaji = value.romaji.trim();
      const translation = value.translation.trim();
      if (romaji && translation) return { romaji, translation };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export default {
  async fetch(request: Request): Promise<Response> {
    const requestID = crypto.randomUUID();

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (request.method !== "POST") {
      return jsonResponse({ error: "Use POST /api/translate." }, 405);
    }
    if (!authorized(request)) {
      return jsonResponse({ error: "Aplicativo não autorizado." }, 401);
    }
    if (!process.env.GEMINI_API_KEY) {
      return jsonResponse({ error: "GEMINI_API_KEY não está configurada." }, 500);
    }

    const clientID = identifier(request);
    const rate = checkRateLimit(clientID, "translate");
    const headers = {
      "X-Request-ID": requestID,
      "X-RateLimit-Limit": String(rate.minuteLimit),
      "X-RateLimit-Remaining": String(rate.minuteRemaining),
      "Retry-After": String(rate.retryAfterSeconds)
    };

    if (!rate.allowed) {
      return jsonResponse({ error: "Limite de traduções atingido." }, 429, headers);
    }
    if (!acquireConcurrency(clientID)) {
      return jsonResponse({ error: "Já existem solicitações em andamento." }, 429, headers);
    }

    try {
      const raw = await request.text();
      if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
        return jsonResponse({ error: "Texto muito grande." }, 413, headers);
      }

      let parsed: unknown;
      try { parsed = JSON.parse(raw); }
      catch { return jsonResponse({ error: "JSON inválido." }, 400, headers); }

      if (!isTranslationRequest(parsed)) {
        return jsonResponse({ error: "Envie text e targetLanguage=pt ou en." }, 400, headers);
      }

      const languageName = parsed.targetLanguage === "pt" ? "Brazilian Portuguese" : "English";
      const instructions = `
You are a precise Japanese language annotation engine.
Return ONLY valid minified JSON with exactly two string fields: romaji and translation.
- romaji: Hepburn-style romanization of all Japanese content. Preserve punctuation and line breaks when useful.
- translation: natural ${languageName} translation.
- Do not add markdown, notes, explanations, alternatives, or extra keys.
- Keep names as names and preserve the original tone.
`.trim();

      const result = await callGemini({
        instructions,
        messages: [{ role: "user", content: parsed.text.trim() }]
      });
      const annotation = parseJSONReply(result.reply);

      if (!annotation) {
        return jsonResponse({ error: "A IA não retornou uma anotação válida." }, 502, headers);
      }

      return jsonResponse(annotation, 200, {
        ...headers,
        "X-Gemini-Model": result.model
      });
    } catch (error) {
      const providerError = error instanceof GeminiProviderError ? error : undefined;
      const status = providerError?.statusCode === 429 ? 429 : providerError?.retryable ? 503 : 500;
      return jsonResponse(
        { error: status === 429 ? "Limite da IA atingido." : "Não foi possível traduzir agora." },
        status,
        headers
      );
    } finally {
      releaseConcurrency(clientID);
    }
  }
};
