import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import {
  SUPPORTED_UI_LANGUAGES,
  DEFAULT_UI_LANGUAGE,
  normalizeUiLanguage,
} from "./locales/localeManifest";
import { PROMPTS_BY_LOCALE } from "./locales/prompts";
import enTranslation from "./locales/en/translation.json";

// Only English translation ships in the entry chunk. The other 9 locale JSONs
// (~60-85 KB each = ~530 KB total, Russian alone is 85 KB) are dynamic
// imports — Vite splits each into its own chunk, fetched only when the
// matching language becomes active. Prompts JSONs are tiny (~2 KB each) so
// staying eager is cheap and avoids reasoning code paths having to await
// translation loads.

const storageLanguage =
  typeof window !== "undefined" ? window.localStorage.getItem("uiLanguage") : undefined;
const initialLanguage = normalizeUiLanguage(storageLanguage || "zh-CN");

// Minimal i18next backend: serves the cached English bundle synchronously
// and lazy-imports any other locale's translation.json. Returns prompts
// synchronously from the (small, eager) PROMPTS_BY_LOCALE map.
type BackendCallback = (err: Error | null, data?: unknown) => void;
const dynamicBundleBackend = {
  type: "backend" as const,
  init() {},
  read(language: string, namespace: string, callback: BackendCallback) {
    if (namespace === "prompts") {
      const data = (PROMPTS_BY_LOCALE as Record<string, unknown>)[language];
      callback(null, data || {});
      return;
    }
    if (namespace === "translation") {
      if (language === "en") {
        callback(null, enTranslation);
        return;
      }
      // Use a switch-like map so Vite can statically analyse the dynamic
      // import targets and split per-locale chunks (otherwise the
      // single import(`./locales/${language}/...`) glob also works in
      // Vite 6, but the explicit map is friendlier to tree-shaking).
      const importer = LAZY_TRANSLATION_LOADERS[language];
      if (!importer) {
        callback(new Error(`No lazy loader registered for locale ${language}`));
        return;
      }
      importer()
        .then((mod) => callback(null, (mod as { default: unknown }).default ?? mod))
        .catch((err) => callback(err as Error));
      return;
    }
    callback(null, {});
  },
};

const LAZY_TRANSLATION_LOADERS: Record<string, () => Promise<unknown>> = {
  es: () => import("./locales/es/translation.json"),
  fr: () => import("./locales/fr/translation.json"),
  de: () => import("./locales/de/translation.json"),
  pt: () => import("./locales/pt/translation.json"),
  it: () => import("./locales/it/translation.json"),
  ru: () => import("./locales/ru/translation.json"),
  ja: () => import("./locales/ja/translation.json"),
  "zh-CN": () => import("./locales/zh-CN/translation.json"),
  "zh-TW": () => import("./locales/zh-TW/translation.json"),
};

void i18n
  .use(dynamicBundleBackend)
  .use(initReactI18next)
  .init({
    // Seed with English only; the backend lazy-imports anything else on
    // demand (i18next handles preloading via the `lng` / `preload` config).
    resources: {
      en: { translation: enTranslation, prompts: PROMPTS_BY_LOCALE.en },
    },
    partialBundledLanguages: true,
    lng: initialLanguage,
    fallbackLng: "en",
    preload: initialLanguage === "en" ? ["en"] : ["en", initialLanguage],
    ns: ["translation", "prompts"],
    defaultNS: "translation",
    interpolation: {
      escapeValue: false,
    },
    returnEmptyString: true,
    returnNull: false,
    initImmediate: false,
  });

export default i18n;
export { SUPPORTED_UI_LANGUAGES, DEFAULT_UI_LANGUAGE, normalizeUiLanguage };
export type UiLanguage = (typeof SUPPORTED_UI_LANGUAGES)[number];
