// Wraps untrusted ASR output in a delimiter the system prompt can refer
// to, so the model has a structural cue that the content is data — not
// a follow-up instruction. Closing tags inside the user content are
// neutralized before wrapping to prevent boundary forgery (e.g. a user
// who literally dictates "</transcript>" cannot escape the wrapper).
export const TRANSCRIPT_OPEN_TAG = "<transcript>";
export const TRANSCRIPT_CLOSE_TAG = "</transcript>";

const CLOSE_TAG_PATTERN = /<\/transcript>/gi;

export function wrapTranscript(text: unknown): string {
  const escaped = String(text == null ? "" : text).replace(CLOSE_TAG_PATTERN, "</transcript_>");
  return `${TRANSCRIPT_OPEN_TAG}\n${escaped}\n${TRANSCRIPT_CLOSE_TAG}`;
}
