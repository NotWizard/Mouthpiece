import promptData from "./promptData.json";
import i18n, { normalizeUiLanguage } from "../i18n";
import { en as enPrompts, type PromptBundle } from "../locales/prompts";
import { readCustomCleanupPrompt } from "../utils/promptStorage";
import { getLanguageLabel } from "../utils/languageRegistry";
import type { TerminologyProfile } from "../utils/terminologyProfile";

export const CLEANUP_PROMPT = promptData.CLEANUP_PROMPT;
export const UNIFIED_SYSTEM_PROMPT = promptData.CLEANUP_PROMPT;

export const TRANSLATION_PLACEHOLDER = "{{TARGET_LANG_INSTRUCTION}}";

function getPromptBundle(uiLanguage?: string): PromptBundle {
  const locale = normalizeUiLanguage(uiLanguage || "zh-CN");
  const t = i18n.getFixedT(locale, "prompts");

  return {
    cleanupPrompt: t("cleanupPrompt", { defaultValue: enPrompts.cleanupPrompt }),
    dictionarySuffix: t("dictionarySuffix", { defaultValue: enPrompts.dictionarySuffix }),
  };
}


function getDictionaryEnforcementInstruction(uiLanguage?: string): string {
  const locale = normalizeUiLanguage(uiLanguage || "zh-CN");
  const isZh = locale.startsWith("zh");

  if (isZh) {
    return [
      "词典强约束：",
      "- 对人名、产品名、缩写与专有名词，优先使用词典中的写法。",
      "- 当转录词与词典词存在明显发音相近时，优先归一到词典写法。",
      "- 不要在词典候选明显可用时自行发明新的拼写。",
    ].join("\n");
  }

  return [
    "Dictionary enforcement:",
    "- For names, product terms, acronyms, and proper nouns, prefer dictionary spellings.",
    "- If a transcript token sounds close to a dictionary entry, normalize to the dictionary spelling.",
    "- Do not invent alternate spellings when a dictionary candidate is plausible.",
  ].join("\n");
}

function getTerminologyInstruction(
  terminologyProfile?: Partial<TerminologyProfile> | null
): string {
  if (!terminologyProfile || typeof terminologyProfile !== "object") {
    return "";
  }

  const sections: string[] = [];
  const profilePreferredTerms = Array.isArray(terminologyProfile.preferredTerms)
    ? terminologyProfile.preferredTerms
    : [];
  const glossaryTerms = Array.isArray(terminologyProfile.glossaryTerms)
    ? terminologyProfile.glossaryTerms
    : [];
  const blacklistedTerms = Array.isArray(terminologyProfile.blacklistedTerms)
    ? terminologyProfile.blacklistedTerms
    : [];
  const homophoneMappings = Array.isArray(terminologyProfile.homophoneMappings)
    ? terminologyProfile.homophoneMappings
    : [];

  const preferredTerms = [...profilePreferredTerms, ...glossaryTerms].filter(Boolean);
  if (preferredTerms.length > 0) {
    sections.push(`Preferred terminology: ${preferredTerms.join(", ")}`);
  }

  if (blacklistedTerms.length > 0) {
    sections.push(
      `Avoid these terms when a better correction is available: ${blacklistedTerms.join(", ")}`
    );
  }

  if (homophoneMappings.length > 0) {
    sections.push(
      `Homophone normalization candidates: ${homophoneMappings
        .map((mapping) => `${mapping.source} → ${mapping.target}`)
        .join(", ")}`
    );
  }

  return sections.join("\n");
}

export function getSystemPrompt(
  customDictionary?: string[],
  uiLanguage?: string,
  terminologyProfile?: Partial<TerminologyProfile> | null,
  translationContext?: { enabled: boolean; targetLang: string }
): string {
  const prompts = getPromptBundle(uiLanguage);

  let prompt = prompts.cleanupPrompt;
  if (typeof window !== "undefined" && window.localStorage) {
    prompt = readCustomCleanupPrompt(window.localStorage) || prompt;
  }

  if (customDictionary && customDictionary.length > 0) {
    const normalizedDictionary = Array.from(
      new Set(customDictionary.map((word) => word.trim()).filter(Boolean))
    );

    if (normalizedDictionary.length > 0) {
      prompt += `${prompts.dictionarySuffix}${normalizedDictionary.join(", ")}`;
      prompt += `\n\n${getDictionaryEnforcementInstruction(uiLanguage)}`;
    }
  }

  const terminologyInstruction = getTerminologyInstruction(terminologyProfile);
  if (terminologyInstruction) {
    prompt += `\n\n${terminologyInstruction}`;
  }

  const translationEnabled =
    !!translationContext?.enabled && !!translationContext?.targetLang;

  if (translationEnabled) {
    const langDisplayName = getLanguageLabel(translationContext!.targetLang);
    if (!prompt.includes(TRANSLATION_PLACEHOLDER)) {
      const isZh = (uiLanguage || "zh-CN").startsWith("zh");
      const fallbackSentence = isZh
        ? `输出结果的语言必须是：${TRANSLATION_PLACEHOLDER}`
        : `The output language must be: ${TRANSLATION_PLACEHOLDER}`;
      prompt = `${prompt}\n\n${fallbackSentence}`;
    }
    prompt = prompt.replaceAll(TRANSLATION_PLACEHOLDER, langDisplayName);
  } else {
    // Translation off: strip any leftover placeholder so it never reaches the LLM verbatim.
    prompt = prompt.replaceAll(TRANSLATION_PLACEHOLDER, "");
  }

  return prompt;
}

export function getWordBoost(customDictionary?: string[]): string[] {
  if (!customDictionary || customDictionary.length === 0) return [];
  return customDictionary.filter((w) => w.trim());
}

export default {
  CLEANUP_PROMPT,
  UNIFIED_SYSTEM_PROMPT,
  TRANSLATION_PLACEHOLDER,
  getSystemPrompt,
  getWordBoost,
};
