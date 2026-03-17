import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import {
  SUPPORTED_UI_LANGUAGES,
  DEFAULT_UI_LANGUAGE,
  normalizeUiLanguage,
} from "./locales/localeManifest";
import { PROMPTS_BY_LOCALE } from "./locales/prompts";
import { TRANSLATIONS_BY_LOCALE } from "./locales/translations";

const resources = {
  en: {
    translation: TRANSLATIONS_BY_LOCALE.en,
    prompts: PROMPTS_BY_LOCALE.en,
  },
  es: {
    translation: TRANSLATIONS_BY_LOCALE.es,
    prompts: PROMPTS_BY_LOCALE.es,
  },
  fr: {
    translation: TRANSLATIONS_BY_LOCALE.fr,
    prompts: PROMPTS_BY_LOCALE.fr,
  },
  de: {
    translation: TRANSLATIONS_BY_LOCALE.de,
    prompts: PROMPTS_BY_LOCALE.de,
  },
  pt: {
    translation: TRANSLATIONS_BY_LOCALE.pt,
    prompts: PROMPTS_BY_LOCALE.pt,
  },
  it: {
    translation: TRANSLATIONS_BY_LOCALE.it,
    prompts: PROMPTS_BY_LOCALE.it,
  },
  ru: {
    translation: TRANSLATIONS_BY_LOCALE.ru,
    prompts: PROMPTS_BY_LOCALE.ru,
  },
  ja: {
    translation: TRANSLATIONS_BY_LOCALE.ja,
    prompts: PROMPTS_BY_LOCALE.ja,
  },
  "zh-CN": {
    translation: TRANSLATIONS_BY_LOCALE["zh-CN"],
    prompts: PROMPTS_BY_LOCALE["zh-CN"],
  },
  "zh-TW": {
    translation: TRANSLATIONS_BY_LOCALE["zh-TW"],
    prompts: PROMPTS_BY_LOCALE["zh-TW"],
  },
} as const;

const storageLanguage =
  typeof window !== "undefined" ? window.localStorage.getItem("uiLanguage") : undefined;

const initialLanguage = normalizeUiLanguage(storageLanguage || "zh-CN");

void i18n.use(initReactI18next).init({
  resources,
  lng: initialLanguage,
  fallbackLng: "en",
  ns: ["translation", "prompts"],
  defaultNS: "translation",
  interpolation: {
    escapeValue: false,
  },
  returnEmptyString: true,
  returnNull: false,
});

export default i18n;
export { SUPPORTED_UI_LANGUAGES, DEFAULT_UI_LANGUAGE, normalizeUiLanguage };
export type UiLanguage = (typeof SUPPORTED_UI_LANGUAGES)[number];
