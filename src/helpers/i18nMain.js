const i18next = require("i18next");
const localeManifest = require("../locales/localeManifest");

const enTranslation = require("../locales/en/translation.json");
const esTranslation = require("../locales/es/translation.json");
const frTranslation = require("../locales/fr/translation.json");
const deTranslation = require("../locales/de/translation.json");
const ptTranslation = require("../locales/pt/translation.json");
const itTranslation = require("../locales/it/translation.json");
const ruTranslation = require("../locales/ru/translation.json");
const jaTranslation = require("../locales/ja/translation.json");
const zhCNTranslation = require("../locales/zh-CN/translation.json");
const zhTWTranslation = require("../locales/zh-TW/translation.json");

const enPrompts = require("../locales/en/prompts.json");
const esPrompts = require("../locales/es/prompts.json");
const frPrompts = require("../locales/fr/prompts.json");
const dePrompts = require("../locales/de/prompts.json");
const ptPrompts = require("../locales/pt/prompts.json");
const itPrompts = require("../locales/it/prompts.json");
const ruPrompts = require("../locales/ru/prompts.json");
const jaPrompts = require("../locales/ja/prompts.json");
const zhCNPrompts = require("../locales/zh-CN/prompts.json");
const zhTWPrompts = require("../locales/zh-TW/prompts.json");

const SUPPORTED_UI_LANGUAGES = localeManifest.SUPPORTED_UI_LANGUAGES;
const DEFAULT_UI_LANGUAGE = localeManifest.DEFAULT_UI_LANGUAGE;
const normalizeUiLanguage = localeManifest.normalizeUiLanguage;

const i18nMain = i18next.createInstance();

void i18nMain.init({
  initImmediate: false,
  resources: {
    en: {
      translation: enTranslation,
      prompts: enPrompts,
    },
    es: {
      translation: esTranslation,
      prompts: esPrompts,
    },
    fr: {
      translation: frTranslation,
      prompts: frPrompts,
    },
    de: {
      translation: deTranslation,
      prompts: dePrompts,
    },
    pt: {
      translation: ptTranslation,
      prompts: ptPrompts,
    },
    it: {
      translation: itTranslation,
      prompts: itPrompts,
    },
    ru: {
      translation: ruTranslation,
      prompts: ruPrompts,
    },
    ja: {
      translation: jaTranslation,
      prompts: jaPrompts,
    },
    "zh-CN": {
      translation: zhCNTranslation,
      prompts: zhCNPrompts,
    },
    "zh-TW": {
      translation: zhTWTranslation,
      prompts: zhTWPrompts,
    },
  },
  lng: normalizeUiLanguage(process.env.UI_LANGUAGE || "zh-CN"),
  fallbackLng: "en",
  ns: ["translation", "prompts"],
  defaultNS: "translation",
  interpolation: {
    escapeValue: false,
  },
  returnEmptyString: false,
  returnNull: false,
});

function changeLanguage(language) {
  const normalized = normalizeUiLanguage(language);

  if (i18nMain.language !== normalized) {
    void i18nMain.changeLanguage(normalized);
  }

  return normalized;
}

module.exports = {
  i18nMain,
  changeLanguage,
  normalizeUiLanguage,
  SUPPORTED_UI_LANGUAGES,
};
