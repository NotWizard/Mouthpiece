export function buildLiveTranscriptPreview(text, { maxChars = 28 } = {}) {
  const normalizedText = typeof text === "string" ? text.trim() : "";
  if (!normalizedText) {
    return "";
  }

  const safeMaxChars = Math.max(1, Math.floor(maxChars));
  const characters = Array.from(normalizedText);

  if (characters.length <= safeMaxChars) {
    return normalizedText;
  }

  const visibleTail = characters.slice(-safeMaxChars).join("").trimStart();
  return visibleTail ? `…${visibleTail}` : "…";
}
