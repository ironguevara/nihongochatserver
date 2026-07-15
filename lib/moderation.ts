const MAX_REPEATED_CHARACTER_RUN = 200;

export async function moderateText(
  text: string
): Promise<{ flagged: boolean }> {
  const normalized = text.trim();

  if (!normalized) {
    return { flagged: false };
  }

  // Proteção simples contra payloads claramente abusivos.
  const repeatedCharacterPattern = new RegExp(
    `(.)\\1{${MAX_REPEATED_CHARACTER_RUN},}`,
    "u"
  );

  return {
    flagged: repeatedCharacterPattern.test(normalized)
  };
}
