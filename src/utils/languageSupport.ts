import registry from "../config/languageRegistry.json";

function buildLanguageSet(key: "whisper" | "parakeet" | "assemblyai"): Set<string> {
  const set = new Set<string>();
  for (const lang of registry.languages) {
    if (lang[key]) {
      set.add(lang.code);
      const base = lang.code.split("-")[0];
      if (base !== lang.code) set.add(base);
    }
  }
  return set;
}

const WHISPER_LANGUAGES = buildLanguageSet("whisper");
const PARAKEET_LANGUAGES = buildLanguageSet("parakeet");
const QWEN_ASR_LANGUAGES = new Set(["en", "zh"]);
const ASSEMBLYAI_UNIVERSAL3_PRO_LANGUAGES = buildLanguageSet("assemblyai");

const MODEL_LANGUAGE_MAP: Record<string, Set<string>> = {
  "parakeet-tdt-0.6b-v3": PARAKEET_LANGUAGES,
  "qwen3-asr-0.6b-mlx": QWEN_ASR_LANGUAGES,
  "qwen3-asr-1.7b-mlx": QWEN_ASR_LANGUAGES,
};

export function getBaseLanguageCode(language: string | null | undefined): string | undefined {
  if (!language || language === "auto") return undefined;
  return language.split("-")[0];
}

export function validateLanguageForModel(
  language: string | null | undefined,
  modelId: string
): string | undefined {
  const baseCode = getBaseLanguageCode(language);
  if (!baseCode) return undefined;

  const supportedSet = MODEL_LANGUAGE_MAP[modelId];
  if (!supportedSet) return baseCode;

  return supportedSet.has(baseCode) ? baseCode : undefined;
}

export {
  WHISPER_LANGUAGES,
  PARAKEET_LANGUAGES,
  QWEN_ASR_LANGUAGES,
  ASSEMBLYAI_UNIVERSAL3_PRO_LANGUAGES,
};
