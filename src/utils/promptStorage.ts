export const CUSTOM_CLEANUP_PROMPT_KEY = "customCleanupPrompt";

const LEGACY_CUSTOM_PROMPT_KEY = "custom" + "Unified" + "Prompt";
const LEGACY_PROMPT_SET_KEY = "custom" + "Prompts";
const LEGACY_NAME_KEY = "agent" + "Name";
const LEGACY_VOICE_FLAG_KEY = "voiceAssistant" + "Enabled";

const UNSAFE_CLEANUP_PROMPT_PATTERNS = [
  /\{\{\s*agent\s*Name\s*\}\}/i,
  /\bMODE\s*2\b/i,
  new RegExp("\\bdirect\\s+address\\b", "i"),
  new RegExp("\\bvoice\\s+assistant\\b", "i"),
  new RegExp("\\binstruction\\s+mode\\b", "i"),
  new RegExp("\\bAgent\\s+instructions\\b", "i"),
  new RegExp("指令" + "模式"),
  new RegExp("语音" + "助手"),
  new RegExp("語音" + "助理"),
];

function parsePromptValue(raw: string | null): string | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "string" && parsed.trim() ? parsed : null;
  } catch {
    return raw.trim() ? raw : null;
  }
}

function getLegacyPromptCandidate(storage: Storage): string | null {
  const unifiedPrompt = parsePromptValue(storage.getItem(LEGACY_CUSTOM_PROMPT_KEY));
  if (unifiedPrompt) return unifiedPrompt;

  const legacyPrompts = storage.getItem(LEGACY_PROMPT_SET_KEY);
  if (!legacyPrompts) return null;

  try {
    const parsed = JSON.parse(legacyPrompts);
    const cleanupPrompt = parsed?.cleanup || parsed?.regular;
    return typeof cleanupPrompt === "string" && cleanupPrompt.trim() ? cleanupPrompt : null;
  } catch {
    return null;
  }
}

export function isUnsafeCleanupPrompt(prompt: string): boolean {
  return UNSAFE_CLEANUP_PROMPT_PATTERNS.some((pattern) => pattern.test(prompt));
}

export function readCustomCleanupPrompt(storage: Storage = window.localStorage): string | null {
  const prompt = parsePromptValue(storage.getItem(CUSTOM_CLEANUP_PROMPT_KEY));
  if (!prompt || isUnsafeCleanupPrompt(prompt)) {
    return null;
  }

  return prompt;
}

export function migrateLegacyVoiceModeStorage(storage: Storage = window.localStorage): void {
  if (!storage.getItem(CUSTOM_CLEANUP_PROMPT_KEY)) {
    const legacyPrompt = getLegacyPromptCandidate(storage);
    if (legacyPrompt && !isUnsafeCleanupPrompt(legacyPrompt)) {
      storage.setItem(CUSTOM_CLEANUP_PROMPT_KEY, JSON.stringify(legacyPrompt));
    }
  }

  storage.removeItem(LEGACY_PROMPT_SET_KEY);
  storage.removeItem(LEGACY_CUSTOM_PROMPT_KEY);
  storage.removeItem(LEGACY_NAME_KEY);
  storage.removeItem(LEGACY_VOICE_FLAG_KEY);
}
