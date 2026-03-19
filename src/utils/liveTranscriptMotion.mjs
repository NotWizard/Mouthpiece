/**
 * @param {string} text
 * @param {{ maxChars?: number }} [options]
 */
export function normalizeLiveTranscriptText(text, { maxChars = 160 } = {}) {
  const normalizedText =
    typeof text === "string" ? text.trim().replace(/\s+/g, " ").trim() : "";

  if (!normalizedText) {
    return "";
  }

  const safeMaxChars = Math.max(1, Math.floor(maxChars));
  const characters = Array.from(normalizedText);

  if (characters.length <= safeMaxChars) {
    return normalizedText;
  }

  return characters.slice(-safeMaxChars).join("").trimStart();
}

/**
 * @param {{
 *   contentWidthPx?: number;
 *   viewportWidthPx?: number;
 *   trailingRevealPx?: number;
 * }} [options]
 */
export function getLiveTranscriptOffsetPx({
  contentWidthPx,
  viewportWidthPx,
  trailingRevealPx = 0,
} = {}) {
  const safeContentWidthPx = Number.isFinite(contentWidthPx) ? Number(contentWidthPx) : 0;
  const safeViewportWidthPx = Number.isFinite(viewportWidthPx) ? Number(viewportWidthPx) : 0;
  const safeTrailingRevealPx = Math.max(
    0,
    Number.isFinite(trailingRevealPx) ? Number(trailingRevealPx) : 0
  );

  if (
    safeContentWidthPx <= 0 ||
    safeViewportWidthPx <= 0 ||
    safeContentWidthPx <= safeViewportWidthPx
  ) {
    return 0;
  }

  return Math.round(safeViewportWidthPx - safeContentWidthPx - safeTrailingRevealPx);
}
