const SUPPORTED_UI_LANGUAGES = /** @type {const} */ ([
  "en",
  "es",
  "fr",
  "de",
  "pt",
  "it",
  "ru",
  "ja",
  "zh-CN",
  "zh-TW",
]);

const DEFAULT_UI_LANGUAGE = "zh-CN";

const UI_LANGUAGE_OPTIONS = /** @type {const} */ ([
  { value: "en", label: "English", flag: "🇺🇸" },
  { value: "es", label: "Español", flag: "🇪🇸" },
  { value: "fr", label: "Français", flag: "🇫🇷" },
  { value: "de", label: "Deutsch", flag: "🇩🇪" },
  { value: "pt", label: "Português", flag: "🇵🇹" },
  { value: "it", label: "Italiano", flag: "🇮🇹" },
  { value: "ru", label: "Русский", flag: "🇷🇺" },
  { value: "ja", label: "日本語", flag: "🇯🇵" },
  { value: "zh-CN", label: "简体中文", flag: "🇨🇳" },
  { value: "zh-TW", label: "繁體中文", flag: "🇹🇼" },
]);

function normalizeUiLanguage(language) {
  const candidate = String(language || "").trim();
  const normalized = candidate.replace("_", "-");
  const fullMatch = SUPPORTED_UI_LANGUAGES.find(
    (locale) => locale.toLowerCase() === normalized.toLowerCase()
  );

  if (fullMatch) {
    return fullMatch;
  }

  const base = candidate.split("-")[0].split("_")[0].toLowerCase();
  return SUPPORTED_UI_LANGUAGES.includes(base) ? base : DEFAULT_UI_LANGUAGE;
}

export {
  SUPPORTED_UI_LANGUAGES,
  DEFAULT_UI_LANGUAGE,
  UI_LANGUAGE_OPTIONS,
  normalizeUiLanguage,
};
