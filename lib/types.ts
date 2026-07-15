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

function isMessage(value: unknown): value is ClientMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    (candidate.role === "user" || candidate.role === "assistant") &&
    typeof candidate.content === "string" &&
    candidate.content.trim().length > 0
  );
}

export function isChatRequest(value: unknown): value is ChatRequest {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    Array.isArray(candidate.messages) &&
    candidate.messages.every(isMessage) &&
    (candidate.teacherMode === undefined ||
      typeof candidate.teacherMode === "boolean") &&
    (candidate.userName === undefined ||
      typeof candidate.userName === "string") &&
    (candidate.personaName === undefined ||
      typeof candidate.personaName === "string") &&
    (candidate.friendshipLevel === undefined ||
      typeof candidate.friendshipLevel === "string") &&
    (candidate.friendshipXP === undefined ||
      typeof candidate.friendshipXP === "number") &&
    (candidate.memory === undefined ||
      (typeof candidate.memory === "object" &&
        candidate.memory !== null &&
        !Array.isArray(candidate.memory)))
  );
}

export function sanitizeMessages(
  messages: ClientMessage[]
): ClientMessage[] {
  return messages
    .map((message) => ({
      role: message.role,
      content: message.content.trim().slice(0, 4_000)
    }))
    .filter((message) => message.content.length > 0);
}
