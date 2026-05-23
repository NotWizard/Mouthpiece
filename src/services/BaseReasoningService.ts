import { getSystemPrompt } from "../config/prompts";
import { getSettings } from "../stores/settingsStore";
import type { ContextClassification } from "../utils/contextClassifier";

export interface ReasoningConfig {
  maxTokens?: number;
  temperature?: number;
  contextSize?: number;
  systemPrompt?: string;
  contextClassification?: ContextClassification;
  withTranslation?: boolean;
}

export abstract class BaseReasoningService {
  protected isProcessing = false;

  protected getCustomDictionary(): string[] {
    return getSettings().customDictionary;
  }

  protected getTerminologyProfile() {
    return getSettings().terminologyProfile;
  }

  protected getUiLanguage(): string {
    return getSettings().uiLanguage || "zh-CN";
  }

  protected getSystemPrompt(withTranslation = false): string {
    const settings = getSettings();
    return getSystemPrompt(
      this.getCustomDictionary(),
      this.getUiLanguage(),
      this.getTerminologyProfile(),
      {
        enabled: !!settings.translationEnabled,
        targetLang: settings.translationTargetLang || "",
        triggeredByHotkey: !!withTranslation,
      }
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
    config?: ReasoningConfig
  ): Promise<string>;
}