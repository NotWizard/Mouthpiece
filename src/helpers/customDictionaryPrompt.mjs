export const DEFAULT_MAX_CHARS = 600;
const SEPARATOR = ", ";

export function buildCustomDictionaryPrompt(words, { maxChars = DEFAULT_MAX_CHARS } = {}) {
  if (!Array.isArray(words) || words.length === 0) return null;

  // Keep the most recently added words first so users who add a new term mid-
  // session don't have it silently dropped by Whisper's ~224-token prompt cap.
  const reversed = [...words].reverse();
  const kept = [];
  let length = 0;
  for (const raw of reversed) {
    if (typeof raw !== "string") continue;
    const word = raw.trim();
    if (!word) continue;
    const projected = length + (kept.length > 0 ? SEPARATOR.length : 0) + word.length;
    if (projected > maxChars) break;
    kept.push(word);
    length = projected;
  }
  if (kept.length === 0) return null;
  return kept.reverse().join(SEPARATOR);
}
