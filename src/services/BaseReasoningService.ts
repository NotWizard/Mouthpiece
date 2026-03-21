import { getSystemPrompt } from "../config/prompts";
import { getSettings } from "../stores/settingsStore";
import type { ContextClassification } from "../utils/contextClassifier";
import type { PostProcessingPolicy } from "../utils/postProcessingPolicy";

export interface ReasoningConfig {
  maxTokens?: number;
  temperature?: number;
  contextSize?: number;
  systemPrompt?: string;
  contextClassification?: ContextClassification;
  postProcessingPolicy?: PostProcessingPolicy;
  strictMode?: boolean;
  strictOverlapThreshold?: number;
}

export abstract class BaseReasoningService {
  protected isProcessing = false;

  protected getCustomDictionary(): string[] {
    return getSettings().customDictionary;
  }

  protected getTerminologyProfile() {
    return getSettings().terminologyProfile;
  }

  protected getPreferredLanguage(): string {
    return getSettings().preferredLanguage || "auto";
  }

  protected getUiLanguage(): string {
    return getSettings().uiLanguage || "zh-CN";
  }

  protected getSystemPrompt(
    agentName: string | null,
    transcript?: string,
    contextClassification?: ContextClassification,
    postProcessingPolicy?: PostProcessingPolicy
  ): string {
    const language = this.getPreferredLanguage();
    const uiLanguage = this.getUiLanguage();
    return getSystemPrompt(
      agentName,
      this.getCustomDictionary(),
      language,
      transcript,
      uiLanguage,
      contextClassification,
      postProcessingPolicy,
      this.getTerminologyProfile()
    );
  }

  protected calculateMaxTokens(
    textLength: number,
    minTokens = 100,
    maxTokens = 2048,
    multiplier = 2
  ): number {
    return Math.max(minTokens, Math.min(textLength * multiplier, maxTokens));
  }

  abstract isAvailable(): Promise<boolean>;

  abstract processText(
    text: string,
    modelId: string,
    agentName?: string | null,
    config?: ReasoningConfig
  ): Promise<string>;
}
