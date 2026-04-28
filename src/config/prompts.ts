import promptData from "./promptData.json";
import i18n, { normalizeUiLanguage } from "../i18n";
import { en as enPrompts, type PromptBundle } from "../locales/prompts";
import { getLanguageInstruction } from "../utils/languageSupport";
import type { ContextClassification } from "../utils/contextClassifier";
import { readCustomCleanupPrompt } from "../utils/promptStorage";
import {
  resolvePostProcessingPolicy,
  type InputSurfaceMode,
  type OutputStrategy,
  type PostProcessingPolicy,
} from "../utils/postProcessingPolicy";
import type { TerminologyProfile } from "../utils/terminologyProfile";

export const CLEANUP_PROMPT = promptData.CLEANUP_PROMPT;
export const UNIFIED_SYSTEM_PROMPT = promptData.CLEANUP_PROMPT;

function getPromptBundle(uiLanguage?: string): PromptBundle {
  const locale = normalizeUiLanguage(uiLanguage || "zh-CN");
  const t = i18n.getFixedT(locale, "prompts");

  return {
    cleanupPrompt: t("cleanupPrompt", { defaultValue: enPrompts.cleanupPrompt }),
    dictionarySuffix: t("dictionarySuffix", { defaultValue: enPrompts.dictionarySuffix }),
  };
}

function getStrategyInstruction(outputStrategy: OutputStrategy): string {
  switch (outputStrategy) {
    case "raw_first":
      return "Keep rewriting extremely light and avoid stylistic paraphrasing.";
    case "publishable":
      return "Polish the text so it feels ready to send without changing intent.";
    case "structured_rewrite":
      return "You may reorganize structure when it clearly improves the requested result.";
    case "light_polish":
    default:
      return "Apply light cleanup while staying close to the original wording.";
  }
}

function getSurfaceInstruction(surfaceMode: InputSurfaceMode): string {
  switch (surfaceMode) {
    case "ide":
      return "Treat this like an IDE or technical editor. Preserve identifiers, symbols, and syntax exactly.";
    case "search":
      return "Treat this like a search box. Keep it short, literal, and minimally edited.";
    case "form":
      return "Treat this like a form field. Keep values literal, direct, and easy to paste.";
    case "markdown":
      return "Preserve Markdown structure, list markers, inline code, and heading syntax.";
    case "email":
      return "Keep the output email-ready and coherent.";
    case "document":
      return "Preserve structure and readability for longer-form writing.";
    case "chat":
      return "Keep the output concise and conversational.";
    case "general":
    default:
      return "Keep the output natural and easy to read.";
  }
}

function getPolicyInstruction(policy = resolvePostProcessingPolicy()): string {
  const policyHints = [
    `Surface mode: ${policy.surfaceMode}. ${getSurfaceInstruction(policy.surfaceMode)}`,
    `Output strategy: ${policy.outputStrategy}. ${getStrategyInstruction(policy.outputStrategy)}`,
    policy.allowStructuredRewrite
      ? "Structured rewrite is allowed when it improves the requested result."
      : "Do not perform broad structural rewrites.",
  ];

  if (policy.preserveIdentifiers) {
    policyHints.push(
      "Preserve identifiers, symbols, casing, filenames, and code-like tokens exactly."
    );
  }

  if (policy.preserveFormatting) {
    policyHints.push(
      "Preserve visible formatting, list markers, Markdown structure, and intentional line breaks."
    );
  }

  return policyHints.join(" ");
}

function getContextInstruction(context?: ContextClassification): string {
  if (!context) return "";

  const contextLabels: Record<ContextClassification["context"], string> = {
    general: "general writing",
    code: "code or technical content",
    email: "email drafting",
    chat: "chat/message writing",
    document: "document or notes writing",
    search: "search or launcher input",
    form: "form or field entry",
    markdown: "markdown writing",
    ide: "IDE or technical editor input",
  };

  const focusHints: Record<ContextClassification["context"], string> = {
    general: "Keep output natural and concise.",
    code: "Preserve syntax, symbols, casing, and code blocks exactly where possible.",
    email: "Preserve recipient intent and structure it like a clear, professional email.",
    chat: "Keep it concise and conversational, but still polished.",
    document: "Preserve headings, bullets, and list structure when they aid readability.",
    search: "Keep the query literal and do not embellish it.",
    form: "Preserve field values and keep formatting straightforward.",
    markdown: "Preserve Markdown syntax and author-visible structure.",
    ide: "Preserve identifiers, symbols, casing, and editor-safe content.",
  };

  const appSuffix = context.targetApp?.appName ? ` Target app: ${context.targetApp.appName}.` : "";
  const intentHint = "Cleanup mode; stay anchored to user content.";

  return [
    `Context hint: ${contextLabels[context.context]}.${appSuffix} ${focusHints[context.context]} ${intentHint}`,
  ].join(" ");
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
  language?: string,
  transcript?: string,
  uiLanguage?: string,
  context?: ContextClassification,
  postProcessingPolicy?: PostProcessingPolicy,
  terminologyProfile?: Partial<TerminologyProfile> | null
): string {
  const prompts = getPromptBundle(uiLanguage);
  const policy =
    postProcessingPolicy ||
    resolvePostProcessingPolicy({
      contextClassification: context,
    });

  let prompt = prompts.cleanupPrompt;
  if (typeof window !== "undefined" && window.localStorage) {
    prompt = readCustomCleanupPrompt(window.localStorage) || prompt;
  }

  const langInstruction = getLanguageInstruction(language);
  if (langInstruction) {
    prompt += "\n\n" + langInstruction;
  }

  const policyInstruction = getPolicyInstruction(policy);
  if (policyInstruction) {
    prompt += "\n\n" + policyInstruction;
  }

  const contextInstruction = getContextInstruction(context);
  if (contextInstruction) {
    prompt += "\n\n" + contextInstruction;
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

  return prompt;
}

export function getWordBoost(customDictionary?: string[]): string[] {
  if (!customDictionary || customDictionary.length === 0) return [];
  return customDictionary.filter((w) => w.trim());
}

export default {
  CLEANUP_PROMPT,
  UNIFIED_SYSTEM_PROMPT,
  getSystemPrompt,
  getWordBoost,
};
