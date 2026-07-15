import type { ClientMessage } from "./types.js";

interface GeminiPart {
  text?: string;
}

interface GeminiCandidate {
  content?: {
    parts?: GeminiPart[];
  };
  finishReason?: string;
}

interface GeminiErrorPayload {
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

interface GeminiResponsePayload extends GeminiErrorPayload {
  candidates?: GeminiCandidate[];
  promptFeedback?: {
    blockReason?: string;
  };
}

interface GeminiAttemptResult {
  reply: string;
  model: string;
}

export class GeminiProviderError extends Error {
  readonly statusCode: number;
  readonly retryable: boolean;
  readonly model?: string;


  constructor(
    message: string,
    statusCode = 500,
    retryable = false,
    model?: string
  ) {
    super(message);
    this.name = "GeminiProviderError";
    this.statusCode = statusCode;
    this.retryable = retryable;
    this.model = model;
  }
}

function extractReply(payload: GeminiResponsePayload): string {
  const parts =
    payload.candidates?.[0]?.content?.parts
      ?.map((part) => part.text?.trim() ?? "")
      .filter(Boolean) ?? [];

  return parts.join("\n").trim();
}

function toGeminiRole(role: ClientMessage["role"]): "user" | "model" {
  return role === "assistant" ? "model" : "user";
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function configuredModels(): string[] {
  const environmentModels = process.env.GEMINI_MODELS
    ?.split(",")
    .map((model) => model.trim())
    .filter(Boolean);

  if (environmentModels && environmentModels.length > 0) {
    return Array.from(new Set(environmentModels));
  }

  const singleModel = process.env.GEMINI_MODEL?.trim();

  return Array.from(
    new Set(
      [
        singleModel,
        "gemini-3.1-flash-lite",
        "gemini-3.5-flash",
        "gemini-flash-latest"
      ].filter((model): model is string => Boolean(model))
    )
  );
}

function isRetryableStatus(status: number): boolean {
  return [408, 429, 500, 502, 503, 504].includes(status);
}

function friendlyProviderMessage(
  status: number,
  detail: string
): string {
  if (status === 429) {
    return "O limite temporário do Gemini foi atingido. Tente novamente em instantes.";
  }

  if ([500, 502, 503, 504].includes(status)) {
    return "Os modelos do Gemini estão temporariamente ocupados. Tente novamente em alguns instantes.";
  }

  if (status === 400 && /model|no longer available|not found/i.test(detail)) {
    return "O modelo configurado não está disponível. O servidor tentou os modelos alternativos.";
  }

  if (status === 401 || status === 403) {
    return "A chave do Gemini não foi autorizada. Verifique a configuração na Vercel.";
  }

  return detail;
}

async function requestModel(input: {
  apiKey: string;
  model: string;
  instructions: string;
  messages: ClientMessage[];
  timeoutMilliseconds: number;
}): Promise<GeminiAttemptResult> {
  const endpoint =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    `${encodeURIComponent(input.model)}:generateContent`;

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    input.timeoutMilliseconds
  );

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": input.apiKey
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: input.instructions }]
        },
        contents: input.messages.map((message) => ({
          role: toGeminiRole(message.role),
          parts: [{ text: message.content }]
        })),
        generationConfig: {
          temperature: 0.9,
          topP: 0.95,
          maxOutputTokens: 500
        },
        safetySettings: [
          {
            category: "HARM_CATEGORY_HARASSMENT",
            threshold: "BLOCK_MEDIUM_AND_ABOVE"
          },
          {
            category: "HARM_CATEGORY_HATE_SPEECH",
            threshold: "BLOCK_MEDIUM_AND_ABOVE"
          },
          {
            category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
            threshold: "BLOCK_MEDIUM_AND_ABOVE"
          },
          {
            category: "HARM_CATEGORY_DANGEROUS_CONTENT",
            threshold: "BLOCK_MEDIUM_AND_ABOVE"
          }
        ]
      })
    });

    const payload = (await response.json()) as GeminiResponsePayload;

    if (!response.ok) {
      const detail =
        payload.error?.message ||
        payload.error?.status ||
        `Gemini respondeu com status ${response.status}.`;

      throw new GeminiProviderError(
        friendlyProviderMessage(response.status, detail),
        response.status,
        isRetryableStatus(response.status) ||
          /high demand|temporar|overloaded|unavailable/i.test(detail),
        input.model
      );
    }

    const reply = extractReply(payload);

    if (reply) {
      return {
        reply,
        model: input.model
      };
    }

    const blockedReason =
      payload.promptFeedback?.blockReason ||
      payload.candidates?.[0]?.finishReason;

    if (blockedReason) {
      throw new GeminiProviderError(
        `A resposta foi bloqueada pelo Gemini: ${blockedReason}.`,
        422,
        false,
        input.model
      );
    }

    throw new GeminiProviderError(
      "O Gemini retornou uma resposta vazia.",
      502,
      true,
      input.model
    );
  } catch (error) {
    if (error instanceof GeminiProviderError) {
      throw error;
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw new GeminiProviderError(
        `O modelo ${input.model} demorou além do limite interno.`,
        504,
        true,
        input.model
      );
    }

    throw new GeminiProviderError(
      error instanceof Error
        ? error.message
        : "Falha desconhecida ao chamar o Gemini.",
      502,
      true,
      input.model
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function callGemini(input: {
  instructions: string;
  messages: ClientMessage[];
}): Promise<GeminiAttemptResult> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();

  if (!apiKey) {
    throw new GeminiProviderError(
      "GEMINI_API_KEY não está configurada no servidor.",
      500,
      false
    );
  }

  const models = configuredModels();
  const startedAt = Date.now();
  const totalBudgetMilliseconds = 24_000;
  const perAttemptTimeoutMilliseconds = 6_500;
  const errors: string[] = [];

  for (let index = 0; index < models.length; index += 1) {
    const model = models[index];

    if (!model) {
      continue;
    }

    if (Date.now() - startedAt >= totalBudgetMilliseconds) {
      break;
    }

    try {
      return await requestModel({
        apiKey,
        model,
        instructions: input.instructions,
        messages: input.messages,
        timeoutMilliseconds: perAttemptTimeoutMilliseconds
      });
    } catch (error) {
      const providerError =
        error instanceof GeminiProviderError
          ? error
          : new GeminiProviderError(
              error instanceof Error ? error.message : "Falha desconhecida.",
              500,
              true,
              model
            );

      errors.push(`${model}: ${providerError.message}`);

      const hasAnotherModel = index < models.length - 1;

      if (!providerError.retryable && providerError.statusCode !== 400) {
        throw providerError;
      }

      if (!hasAnotherModel) {
        throw new GeminiProviderError(
          "Todos os modelos do Gemini estão temporariamente indisponíveis. " +
            "Tente novamente em alguns instantes.",
          providerError.statusCode === 429 ? 429 : 503,
          true,
          model
        );
      }

      // Backoff curto antes de trocar para o próximo modelo.
      await sleep(350 * (index + 1));
    }
  }

  const lastDetail = errors.at(-1);
  throw new GeminiProviderError(
    lastDetail
      ? `O Gemini não respondeu antes do limite do servidor. ${lastDetail}`
      : "O Gemini não respondeu antes do limite de tempo do servidor.",
    503,
    true
  );
}
