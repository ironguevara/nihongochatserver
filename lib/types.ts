export type MessageRole = "user" | "assistant";

export interface ClientMessage {
  role: MessageRole;
  content: string;
}

export type UserMemory = Record<string, string>;

export interface ChatRequest {
  messages: ClientMessage[];
  teacherMode?: boolean;
  userName?: string;
  personaName?: string;
  friendshipLevel?: string;
  friendshipXP?: number;
  memory?: UserMemory;
}

export interface ChatResponse {
  reply: string;
  blocked?: boolean;
}

export interface TranslationRequest {
  text: string;
  targetLanguage: "pt" | "en";
}

export interface TranslationResponse {
  romaji: string;
  translation: string;
}

function isMessage(value: unknown): value is ClientMessage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.role === "user" || candidate.role === "assistant") &&
    typeof candidate.content === "string" &&
    candidate.content.trim().length > 0 &&
    candidate.content.length <= 4_000
  );
}

export function isChatRequest(value: unknown): value is ChatRequest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;

  return (
    Array.isArray(candidate.messages) &&
    candidate.messages.length > 0 &&
    candidate.messages.length <= 30 &&
    candidate.messages.every(isMessage) &&
    (candidate.teacherMode === undefined || typeof candidate.teacherMode === "boolean") &&
    (candidate.userName === undefined || typeof candidate.userName === "string") &&
    (candidate.personaName === undefined || typeof candidate.personaName === "string") &&
    (candidate.friendshipLevel === undefined || typeof candidate.friendshipLevel === "string") &&
    (candidate.friendshipXP === undefined || typeof candidate.friendshipXP === "number") &&
    (candidate.memory === undefined ||
      (typeof candidate.memory === "object" &&
        candidate.memory !== null &&
        !Array.isArray(candidate.memory)))
  );
}

export function isTranslationRequest(value: unknown): value is TranslationRequest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.text === "string" &&
    candidate.text.trim().length > 0 &&
    candidate.text.length <= 2_000 &&
    (candidate.targetLanguage === "pt" || candidate.targetLanguage === "en")
  );
}

export function sanitizeMessages(messages: ClientMessage[]): ClientMessage[] {
  return messages
    .map((message) => ({
      role: message.role,
      content: message.content.trim().slice(0, 4_000)
    }))
    .filter((message) => message.content.length > 0);
}
