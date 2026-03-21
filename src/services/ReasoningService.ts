import { getModelProvider, getCloudModel } from "../models/ModelRegistry";
import { BaseReasoningService, ReasoningConfig } from "./BaseReasoningService";
import { SecureCache } from "../utils/SecureCache";
import { withRetry, createApiRetryStrategy } from "../utils/retry";
import { API_ENDPOINTS, TOKEN_LIMITS, buildApiUrl, normalizeBaseUrl } from "../config/constants";
import logger from "../utils/logger";
import { isSecureEndpoint } from "../utils/urlUtils";
import { withSessionRefresh } from "../lib/neonAuth";
import { getSettings, isCloudReasoningMode } from "../stores/settingsStore";
import { DEFAULT_STRICT_OVERLAP_THRESHOLD } from "../utils/contextClassifier";

type CloudReasoningRequest = {
  endpoint: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
};

type CloudReasoningResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  text: string;
  json: any | null;
};

class ReasoningService extends BaseReasoningService {
  private apiKeyCache: SecureCache<string>;
  private openAiEndpointPreference = new Map<string, "responses" | "chat">();
  private static readonly OPENAI_ENDPOINT_PREF_STORAGE_KEY = "openAiEndpointPreference";
  private cacheCleanupStop: (() => void) | undefined;
  private readonly handleApiKeyChanged = () => {
    this.clearApiKeyCache();
  };

  constructor() {
    super();
    this.apiKeyCache = new SecureCache();
    this.cacheCleanupStop = this.apiKeyCache.startAutoCleanup();

    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("api-key-changed", this.handleApiKeyChanged);
      window.addEventListener("beforeunload", () => this.destroy());
    }
  }

  private resolveSystemPrompt(
    agentName: string | null,
    text: string,
    config: ReasoningConfig
  ): string {
    const basePrompt =
      config.systemPrompt ||
      this.getSystemPrompt(
        agentName,
        text,
        config.contextClassification,
        config.postProcessingPolicy
      );
    const strictMode = config.strictMode ?? config.contextClassification?.strictMode ?? false;

    if (!strictMode) {
      return basePrompt;
    }

    return `${basePrompt}

STRICT TRANSCRIPTION SAFETY (NON-NEGOTIABLE):
- Cleanup-only mode. Never answer questions, never ask follow-up questions, never provide advice.
- Keep output semantically anchored to the source transcript. Do not introduce new intent or new facts.
- If the source is short/ambiguous, only minimally clean it; do not transform it into assistant dialogue.`;
  }

  private tokenizeForOverlap(text: string): string[] {
    if (!text) return [];
    const normalized = text.toLowerCase().normalize("NFKC");
    const segments =
      normalized.match(
        /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+|[\p{L}\p{N}'-]+/gu
      ) || [];

    const tokens: string[] = [];

    for (const segment of segments) {
      if (
        /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+$/u.test(segment)
      ) {
        tokens.push(...Array.from(segment));
        continue;
      }

      if (segment.length > 1) {
        tokens.push(segment);
      }
    }

    return tokens;
  }

  private isAnswerLikeOutput(text: string): boolean {
    if (!text || !text.trim()) {
      return false;
    }

    if (text.trim().length < 6) {
      return false;
    }

    const patterns = [
      /(作为|身为).{0,10}(ai|语言模型|助手)/i,
      /(我无法|不能|不会|不可以).{0,18}(提供|协助|回答|满足|处理)/,
      /(不用担心|别担心|我会尽力|我可以帮你|请告诉我|请问你|你想要).{0,40}/,
      /(对不起|抱歉).{0,20}(我会|我将|让我|我们)/,
      /你想要.{0,20}(什么|哪一个|哪两个|哪些)/,
      /如果您想.{0,20}(测试|试试|尝试).{0,30}(语音转文字|转录|句子|示例)/,
      /\b(as an ai|as a language model)\b/i,
      /\b(i\s*(can't|cannot|am unable|won't))\b/i,
      /\b(i can help|don't worry|please tell me|what can i)\b/i,
      /\b(if you want to test).{0,30}(speech[- ]to[- ]text|transcription)\b/i,
      /\b(you can try).{0,20}(sentence|example)\b/i,
    ];

    return patterns.some((re) => re.test(text));
  }

  private calculateOverlapScore(source: string, candidate: string): number {
    const sourceTokens = this.tokenizeForOverlap(source);
    const candidateTokens = this.tokenizeForOverlap(candidate);

    if (sourceTokens.length === 0 || candidateTokens.length === 0) {
      return 0;
    }

    const sourceSet = new Set(sourceTokens);
    const candidateSet = new Set(candidateTokens);

    let outputMatches = 0;
    for (const token of candidateTokens) {
      if (sourceSet.has(token)) {
        outputMatches++;
      }
    }

    let sourceMatches = 0;
    for (const token of sourceSet) {
      if (candidateSet.has(token)) {
        sourceMatches++;
      }
    }

    const outputCoverage = outputMatches / candidateTokens.length;
    const sourceCoverage = sourceMatches / sourceSet.size;

    return Number(((outputCoverage + sourceCoverage) / 2).toFixed(4));
  }

  private localCleanupFallback(text: string): string {
    return text
      .replace(
        /(^|[\s，。！？、,.!?;:])(?:嗯+|呃+|额+|啊+|唉+|诶+|欸+)(?=$|[\s，。！？、,.!?;:])/g,
        "$1"
      )
      .replace(/([\u4e00-\u9fff])\s*(?:嗯+|呃+|额+|啊+|唉+|诶+|欸+)\s*([\u4e00-\u9fff])/g, "$1$2")
      .replace(/\b(?:um+|uh+|er+|ah+|hmm+|mm+|you\s+know|basically)\b/gi, "")
      .replace(/([我你他她它这那])(?:\s*[，,、]?\s*\1)+/g, "$1")
      .replace(
        /([\u4e00-\u9fff])\s*((?:是|就|在|会|要|的|了))(?:\s*[，,、]?\s*\2)+\s*([\u4e00-\u9fff])/g,
        "$1$2$3"
      )
      .replace(
        /(^|[\s，,、。！？,.!?;:])((?:这个|那个|就是|然后|是|就|那|这|我|你|他|她|它|的|了|在|要|会|都|也|还))(?:\s*[，,、]?\s*\2)+/g,
        "$1$2"
      )
      .replace(/\b(i|we|you|he|she|they|it|the|a|an|to|and|but)\b(?:\s+\1\b)+/gi, "$1")
      .replace(/\s+([,.!?;:])/g, "$1")
      .replace(/\s+([，。！？、])/g, "$1")
      .replace(/([,.!?;:，。！？、])\1+/g, "$1")
      .replace(/(^|[\n])\s*[，,、]+\s*/g, "$1")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  private applyStrictModeGuard(
    source: string,
    candidate: string,
    config: ReasoningConfig,
    provider: string,
    model: string
  ): string {
    const strictMode = config.strictMode ?? config.contextClassification?.strictMode ?? false;
    if (!strictMode) {
      return candidate;
    }

    if (this.isAnswerLikeOutput(candidate)) {
      const fallback = this.localCleanupFallback(source);
      logger.logReasoning("STRICT_MODE_ANSWER_PATTERN_BLOCKED", {
        provider,
        model,
        originalLength: source.length,
        candidateLength: candidate.length,
        fallbackLength: fallback.length,
      });
      return fallback;
    }

    const normalizedSource = this.localCleanupFallback(source);
    const normalizedCandidate = this.localCleanupFallback(candidate);
    const normalizedSourceTokens = this.tokenizeForOverlap(normalizedSource);
    const shortInputTokenThreshold = 2;

    if (normalizedSourceTokens.length < shortInputTokenThreshold) {
      const fallback = normalizedSource;
      logger.logReasoning("STRICT_MODE_SHORT_INPUT_LOCAL_CLEANUP", {
        provider,
        model,
        sourceLength: source.trim().length,
        normalizedLength: normalizedSource.length,
        sourceTokenCount: normalizedSourceTokens.length,
        threshold: shortInputTokenThreshold,
        candidateLength: candidate.length,
        fallbackLength: fallback.length,
      });
      return fallback;
    }

    const threshold =
      config.strictOverlapThreshold ||
      config.contextClassification?.strictOverlapThreshold ||
      DEFAULT_STRICT_OVERLAP_THRESHOLD;
    const overlap = this.calculateOverlapScore(normalizedSource, normalizedCandidate);

    logger.logReasoning("STRICT_MODE_OVERLAP_CHECK", {
      provider,
      model,
      overlap,
      threshold,
      context: config.contextClassification?.context || "unknown",
      intent: config.contextClassification?.intent || "cleanup",
    });

    if (overlap >= threshold) {
      return candidate;
    }

    const fallback = this.localCleanupFallback(source);
    logger.logReasoning("STRICT_MODE_FALLBACK_TRIGGERED", {
      provider,
      model,
      overlap,
      threshold,
      originalLength: source.length,
      candidateLength: candidate.length,
      fallbackLength: fallback.length,
    });

    return fallback;
  }

  public enforceStrictMode(
    source: string,
    candidate: string,
    config: ReasoningConfig = {},
    provider = "external",
    model = "external"
  ): string {
    return this.applyStrictModeGuard(source, candidate, config, provider, model);
  }

  private getConfiguredOpenAIBase(): string {
    if (typeof window === "undefined") {
      return API_ENDPOINTS.OPENAI_BASE;
    }

    try {
      const settings = getSettings();
      const provider = settings.reasoningProvider || "";
      const isCustomProvider = provider === "custom";

      if (!isCustomProvider) {
        logger.logReasoning("CUSTOM_REASONING_ENDPOINT_CHECK", {
          hasCustomUrl: false,
          provider,
          reason: "Provider is not 'custom', using default OpenAI endpoint",
          defaultEndpoint: API_ENDPOINTS.OPENAI_BASE,
        });
        return API_ENDPOINTS.OPENAI_BASE;
      }

      const stored = settings.cloudReasoningBaseUrl || "";
      const trimmed = stored.trim();

      if (!trimmed) {
        logger.logReasoning("CUSTOM_REASONING_ENDPOINT_CHECK", {
          hasCustomUrl: false,
          provider,
          usingDefault: true,
          defaultEndpoint: API_ENDPOINTS.OPENAI_BASE,
        });
        return API_ENDPOINTS.OPENAI_BASE;
      }

      const normalized = normalizeBaseUrl(trimmed) || API_ENDPOINTS.OPENAI_BASE;

      logger.logReasoning("CUSTOM_REASONING_ENDPOINT_CHECK", {
        hasCustomUrl: true,
        provider,
        rawUrl: trimmed,
        normalizedUrl: normalized,
        defaultEndpoint: API_ENDPOINTS.OPENAI_BASE,
      });

      const knownNonOpenAIUrls = [
        "api.groq.com",
        "api.anthropic.com",
        "generativelanguage.googleapis.com",
      ];

      const isKnownNonOpenAI = knownNonOpenAIUrls.some((url) => normalized.includes(url));
      if (isKnownNonOpenAI) {
        logger.logReasoning("OPENAI_BASE_REJECTED", {
          reason: "Custom URL is a known non-OpenAI provider, using default OpenAI endpoint",
          attempted: normalized,
        });
        return API_ENDPOINTS.OPENAI_BASE;
      }

      if (!isSecureEndpoint(normalized)) {
        logger.logReasoning("OPENAI_BASE_REJECTED", {
          reason: "HTTPS required (HTTP allowed for local network only)",
          attempted: normalized,
        });
        return API_ENDPOINTS.OPENAI_BASE;
      }

      logger.logReasoning("CUSTOM_REASONING_ENDPOINT_RESOLVED", {
        customEndpoint: normalized,
        isCustom: true,
        provider,
      });

      return normalized;
    } catch (error) {
      logger.logReasoning("CUSTOM_REASONING_ENDPOINT_ERROR", {
        error: (error as Error).message,
        fallbackTo: API_ENDPOINTS.OPENAI_BASE,
      });
      return API_ENDPOINTS.OPENAI_BASE;
    }
  }

  private getOpenAIEndpointCandidates(
    base: string,
    options: { ignoreStoredPreference?: boolean; preferChat?: boolean } = {}
  ): Array<{ url: string; type: "responses" | "chat" }> {
    const lower = base.toLowerCase();

    if (lower.endsWith("/responses") || lower.endsWith("/chat/completions")) {
      const type = lower.endsWith("/responses") ? "responses" : "chat";
      return [{ url: base, type }];
    }

    const preference = options.ignoreStoredPreference
      ? undefined
      : this.getStoredOpenAiPreference(base);
    if (preference === "chat") {
      return [{ url: buildApiUrl(base, "/chat/completions"), type: "chat" }];
    }

    const responsesCandidate = { url: buildApiUrl(base, "/responses"), type: "responses" as const };
    const chatCandidate = { url: buildApiUrl(base, "/chat/completions"), type: "chat" as const };

    if (options.preferChat) {
      return [chatCandidate, responsesCandidate];
    }

    const candidates: Array<{ url: string; type: "responses" | "chat" }> = [
      responsesCandidate,
      chatCandidate,
    ];

    return candidates;
  }

  private getStoredOpenAiPreference(base: string): "responses" | "chat" | undefined {
    if (this.openAiEndpointPreference.has(base)) {
      return this.openAiEndpointPreference.get(base);
    }

    if (typeof window === "undefined" || !window.localStorage) {
      return undefined;
    }

    try {
      const raw = window.localStorage.getItem(ReasoningService.OPENAI_ENDPOINT_PREF_STORAGE_KEY);
      if (!raw) {
        return undefined;
      }
      const parsed = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null) {
        return undefined;
      }
      const value = parsed[base];
      if (value === "responses" || value === "chat") {
        this.openAiEndpointPreference.set(base, value);
        return value;
      }
    } catch {
      return undefined;
    }

    return undefined;
  }

  private rememberOpenAiPreference(base: string, preference: "responses" | "chat"): void {
    this.openAiEndpointPreference.set(base, preference);

    if (typeof window === "undefined" || !window.localStorage) {
      return;
    }

    try {
      const raw = window.localStorage.getItem(ReasoningService.OPENAI_ENDPOINT_PREF_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      const data = typeof parsed === "object" && parsed !== null ? parsed : {};
      data[base] = preference;
      window.localStorage.setItem(
        ReasoningService.OPENAI_ENDPOINT_PREF_STORAGE_KEY,
        JSON.stringify(data)
      );
    } catch {}
  }

  private async getApiKey(
    provider: "openai" | "anthropic" | "gemini" | "groq" | "custom" | "bailian"
  ): Promise<string> {
    if (provider === "custom") {
      let customKey = "";
      try {
        customKey = (await window.electronAPI?.getCustomReasoningKey?.()) || "";
      } catch (err) {
        logger.logReasoning("CUSTOM_KEY_IPC_FALLBACK", { error: (err as Error)?.message });
      }
      if (!customKey || !customKey.trim()) {
        customKey = getSettings().customReasoningApiKey || "";
      }
      const trimmedKey = customKey.trim();

      logger.logReasoning("CUSTOM_KEY_RETRIEVAL", {
        provider,
        hasKey: !!trimmedKey,
        keyLength: trimmedKey.length,
      });

      return trimmedKey;
    }

    if (provider === "bailian") {
      let bailianKey = "";
      try {
        bailianKey = (await window.electronAPI?.getBailianKey?.()) || "";
      } catch (err) {
        logger.logReasoning("BAILIAN_KEY_IPC_FALLBACK", { error: (err as Error)?.message });
      }
      if (!bailianKey || !bailianKey.trim()) {
        bailianKey = getSettings().bailianApiKey || "";
      }
      const trimmedKey = bailianKey.trim();

      logger.logReasoning("BAILIAN_KEY_RETRIEVAL", {
        provider,
        hasKey: !!trimmedKey,
        keyLength: trimmedKey.length,
      });

      return trimmedKey;
    }

    let apiKey = this.apiKeyCache.get(provider);

    logger.logReasoning(`${provider.toUpperCase()}_KEY_RETRIEVAL`, {
      provider,
      fromCache: !!apiKey,
      cacheSize: this.apiKeyCache.size || 0,
    });

    if (!apiKey) {
      try {
        const keyGetters = {
          openai: () => window.electronAPI.getOpenAIKey(),
          anthropic: () => window.electronAPI.getAnthropicKey(),
          gemini: () => window.electronAPI.getGeminiKey(),
          groq: () => window.electronAPI.getGroqKey(),
        };
        apiKey = (await keyGetters[provider]()) ?? undefined;

        logger.logReasoning(`${provider.toUpperCase()}_KEY_FETCHED`, {
          provider,
          hasKey: !!apiKey,
          keyLength: apiKey?.length || 0,
        });

        if (apiKey) {
          this.apiKeyCache.set(provider, apiKey);
        }
      } catch (error) {
        logger.logReasoning(`${provider.toUpperCase()}_KEY_FETCH_ERROR`, {
          provider,
          error: (error as Error).message,
          stack: (error as Error).stack,
        });
      }
    }

    if (!apiKey) {
      const errorMsg = `${provider.charAt(0).toUpperCase() + provider.slice(1)} API key not configured`;
      logger.logReasoning(`${provider.toUpperCase()}_KEY_MISSING`, {
        provider,
        error: errorMsg,
      });
      throw new Error(errorMsg);
    }

    return apiKey;
  }

  private async performCloudReasoningRequest(
    request: CloudReasoningRequest
  ): Promise<CloudReasoningResponse> {
    const timeoutMs = request.timeoutMs ?? 30000;

    if (typeof window !== "undefined" && window.electronAPI?.processCloudReasoningRequest) {
      return window.electronAPI.processCloudReasoningRequest({
        ...request,
        timeoutMs,
      });
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(request.endpoint, {
        method: request.method || "POST",
        headers: request.headers,
        body: request.body,
        signal: controller.signal,
      });

      const text = await response.text();
      let json: any | null = null;

      if (text) {
        try {
          json = JSON.parse(text);
        } catch {
          json = null;
        }
      }

      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        text,
        json,
      };
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async callChatCompletionsApi(
    endpoint: string,
    apiKey: string,
    model: string,
    text: string,
    agentName: string | null,
    config: ReasoningConfig,
    providerName: string
  ): Promise<string> {
    const systemPrompt = this.resolveSystemPrompt(agentName, text, config);
    const userPrompt = text;

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];

    const requestBody: any = {
      model,
      messages,
      temperature: config.temperature ?? 0.3,
      max_tokens:
        config.maxTokens ||
        Math.max(
          4096,
          this.calculateMaxTokens(
            text.length,
            TOKEN_LIMITS.MIN_TOKENS,
            TOKEN_LIMITS.MAX_TOKENS,
            TOKEN_LIMITS.TOKEN_MULTIPLIER
          )
        ),
    };

    // Disable thinking for Groq Qwen models
    const modelDef = getCloudModel(model);
    if (modelDef?.disableThinking && providerName.toLowerCase() === "groq") {
      requestBody.reasoning_effort = "none";
    }

    logger.logReasoning(`${providerName.toUpperCase()}_REQUEST`, {
      endpoint,
      model,
      hasApiKey: !!apiKey,
      requestBody: JSON.stringify(requestBody).substring(0, 200),
    });

    const response = await withRetry(async () => {
      try {
        const res = await this.performCloudReasoningRequest({
          endpoint,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(requestBody),
          timeoutMs: 30000,
        });

        if (!res.ok) {
          const errorText = res.text;
          const errorData: any = res.json || { error: errorText || res.statusText };

          logger.logReasoning(`${providerName.toUpperCase()}_API_ERROR_DETAIL`, {
            status: res.status,
            statusText: res.statusText,
            error: errorData,
            errorMessage: errorData.error?.message || errorData.message || errorData.error,
            fullResponse: errorText.substring(0, 500),
          });

          const errorMessage =
            errorData.error?.message ||
            errorData.message ||
            errorData.error ||
            `${providerName} API error: ${res.status}`;
          throw new Error(errorMessage);
        }

        const jsonResponse = res.json;

        logger.logReasoning(`${providerName.toUpperCase()}_RAW_RESPONSE`, {
          hasResponse: !!jsonResponse,
          responseKeys: jsonResponse ? Object.keys(jsonResponse) : [],
          hasChoices: !!jsonResponse?.choices,
          choicesLength: jsonResponse?.choices?.length || 0,
          fullResponse: JSON.stringify(jsonResponse).substring(0, 500),
        });

        return jsonResponse;
      } catch (error) {
        throw error;
      }
    }, createApiRetryStrategy());

    if (!response.choices || !response.choices[0]) {
      logger.logReasoning(`${providerName.toUpperCase()}_RESPONSE_ERROR`, {
        model,
        response: JSON.stringify(response).substring(0, 500),
        hasChoices: !!response.choices,
        choicesCount: response.choices?.length || 0,
      });
      throw new Error(`Invalid response structure from ${providerName} API`);
    }

    const choice = response.choices[0];
    const responseText = choice.message?.content?.trim() || "";

    if (!responseText) {
      logger.logReasoning(`${providerName.toUpperCase()}_EMPTY_RESPONSE`, {
        model,
        finishReason: choice.finish_reason,
        hasMessage: !!choice.message,
        response: JSON.stringify(choice).substring(0, 500),
      });
      throw new Error(`${providerName} returned empty response`);
    }

    logger.logReasoning(`${providerName.toUpperCase()}_RESPONSE`, {
      model,
      responseLength: responseText.length,
      tokensUsed: response.usage?.total_tokens || 0,
      success: true,
    });

    return responseText;
  }

  async processText(
    text: string,
    model: string = "",
    agentName: string | null = null,
    config: ReasoningConfig = {}
  ): Promise<string> {
    let trimmedModel = model?.trim?.() || "";
    const provider = getModelProvider(trimmedModel);

    if (!trimmedModel && provider !== "openwhispr") {
      throw new Error("No reasoning model selected");
    }

    logger.logReasoning("PROVIDER_SELECTION", {
      model: trimmedModel,
      provider,
      agentName,
      hasConfig: Object.keys(config).length > 0,
      textLength: text.length,
      context: config.contextClassification?.context || "general",
      intent: config.contextClassification?.intent || "cleanup",
      strictMode: config.strictMode ?? config.contextClassification?.strictMode ?? false,
      timestamp: new Date().toISOString(),
    });

    try {
      let result: string;
      const startTime = Date.now();

      logger.logReasoning("ROUTING_TO_PROVIDER", {
        provider,
        model,
      });

      switch (provider) {
        case "openai":
          result = await this.processWithOpenAI(text, trimmedModel, agentName, config);
          break;
        case "bailian":
          result = await this.processWithOpenAI(text, trimmedModel, agentName, config);
          break;
        case "anthropic":
          result = await this.processWithAnthropic(text, trimmedModel, agentName, config);
          break;
        case "local":
          result = await this.processWithLocal(text, trimmedModel, agentName, config);
          break;
        case "gemini":
          result = await this.processWithGemini(text, trimmedModel, agentName, config);
          break;
        case "groq":
          result = await this.processWithGroq(text, model, agentName, config);
          break;
        case "openwhispr":
        case "mouthpiece":
          result = await this.processWithMouthpiece(text, model, agentName, config);
          break;
        case "custom":
          result = await this.processWithOpenAI(text, trimmedModel, agentName, config);
          break;
        default:
          throw new Error(`Unsupported reasoning provider: ${provider}`);
      }

      const processingTime = Date.now() - startTime;
      const guardedResult = this.applyStrictModeGuard(
        text,
        result,
        config,
        provider,
        trimmedModel || model
      );

      logger.logReasoning("PROVIDER_SUCCESS", {
        provider,
        model,
        processingTimeMs: processingTime,
        resultLength: guardedResult.length,
        resultPreview: guardedResult.substring(0, 100) + (guardedResult.length > 100 ? "..." : ""),
      });

      return guardedResult;
    } catch (error) {
      logger.logReasoning("PROVIDER_ERROR", {
        provider,
        model,
        error: (error as Error).message,
        stack: (error as Error).stack,
      });
      throw error;
    }
  }

  private async processWithOpenAI(
    text: string,
    model: string,
    agentName: string | null = null,
    config: ReasoningConfig = {}
  ): Promise<string> {
    const reasoningProvider = getSettings().reasoningProvider || "";
    const isCustomProvider = reasoningProvider === "custom";
    const isBailianProvider = reasoningProvider === "bailian";

    logger.logReasoning("OPENAI_START", {
      model,
      agentName,
      isCustomProvider,
      isBailianProvider,
      hasApiKey: false, // Will update after fetching
    });

    if (this.isProcessing) {
      throw new Error("Already processing a request");
    }

    const apiKey = await this.getApiKey(
      isBailianProvider ? "bailian" : isCustomProvider ? "custom" : "openai"
    );

    logger.logReasoning("OPENAI_API_KEY", {
      hasApiKey: !!apiKey,
      keyLength: apiKey?.length || 0,
    });

    this.isProcessing = true;

    try {
      const systemPrompt = this.resolveSystemPrompt(agentName, text, config);
      const userPrompt = text;

      const messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ];

      const isOlderModel = model && (model.startsWith("gpt-4") || model.startsWith("gpt-3"));
      const bailianReasoningEnableThinking = isBailianProvider
        ? getSettings().bailianReasoningEnableThinking
        : false;
      const customReasoningEnableThinking = isCustomProvider
        ? getSettings().customReasoningEnableThinking
        : false;

      const openAiBase = isBailianProvider
        ? API_ENDPOINTS.DASHSCOPE_BASE
        : this.getConfiguredOpenAIBase();
      const endpointCandidates = isBailianProvider
        ? [
            {
              url: buildApiUrl(API_ENDPOINTS.DASHSCOPE_BASE, "/chat/completions"),
              type: "chat" as const,
            },
          ]
        : this.getOpenAIEndpointCandidates(openAiBase, {
            ignoreStoredPreference: isCustomProvider,
          });
      const isCustomEndpoint = isBailianProvider || openAiBase !== API_ENDPOINTS.OPENAI_BASE;

      logger.logReasoning("OPENAI_ENDPOINTS", {
        base: openAiBase,
        isCustomEndpoint,
        isBailianProvider,
        candidates: endpointCandidates.map((candidate) => candidate.url),
        preference: this.getStoredOpenAiPreference(openAiBase) || null,
      });

      if (isCustomEndpoint) {
        logger.logReasoning("CUSTOM_TEXT_CLEANUP_REQUEST", {
          customBase: openAiBase,
          model,
          textLength: text.length,
          hasApiKey: !!apiKey,
        });
      }

      const response = await withRetry(async () => {
        let lastError: Error | null = null;

        for (const { url: endpoint, type } of endpointCandidates) {
          const endpointTimeoutMs = isCustomProvider && type === "responses" ? 8000 : 30000;
          try {
            const requestBody: any = { model };

            if (type === "responses") {
              requestBody.input = messages;
              requestBody.store = false;
            } else {
              requestBody.messages = messages;
              if (isCustomProvider || isBailianProvider) {
                requestBody.enable_thinking = isBailianProvider
                  ? bailianReasoningEnableThinking
                  : customReasoningEnableThinking;
              }
              if (isOlderModel) {
                requestBody.temperature = config.temperature || 0.3;
              }
            }

            const res = await this.performCloudReasoningRequest({
              endpoint,
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
              },
              body: JSON.stringify(requestBody),
              timeoutMs: endpointTimeoutMs,
            });

            if (!res.ok) {
              const errorData = res.json || { error: res.text || res.statusText };
              const errorMessage =
                errorData.error?.message || errorData.message || `OpenAI API error: ${res.status}`;

              const isUnsupportedEndpoint =
                (res.status === 404 || res.status === 405) && type === "responses";

              if (isUnsupportedEndpoint) {
                lastError = new Error(errorMessage);
                if (!isCustomProvider) {
                  this.rememberOpenAiPreference(openAiBase, "chat");
                }
                logger.logReasoning("OPENAI_ENDPOINT_FALLBACK", {
                  attemptedEndpoint: endpoint,
                  error: errorMessage,
                });
                continue;
              }

              throw new Error(errorMessage);
            }

            if (!isCustomProvider) {
              this.rememberOpenAiPreference(openAiBase, type);
            }
            return res.json;
          } catch (error) {
            const errorMessage = (error as Error).message;
            if (
              errorMessage === `Request timed out after ${Math.round(endpointTimeoutMs / 1000)}s`
            ) {
              const timeoutError = new Error(errorMessage);
              lastError = timeoutError;
              if (type === "responses") {
                logger.logReasoning("OPENAI_ENDPOINT_FALLBACK", {
                  attemptedEndpoint: endpoint,
                  error: timeoutError.message,
                });
                continue;
              }
              throw timeoutError;
            }
            lastError = error as Error;
            if (type === "responses") {
              logger.logReasoning("OPENAI_ENDPOINT_FALLBACK", {
                attemptedEndpoint: endpoint,
                error: (error as Error).message,
              });
              continue;
            }
            throw error;
          }
        }

        throw lastError || new Error("No OpenAI endpoint responded");
      }, createApiRetryStrategy());

      const isResponsesApi = Array.isArray(response?.output);
      const isChatCompletions = Array.isArray(response?.choices);

      logger.logReasoning("OPENAI_RAW_RESPONSE", {
        model,
        format: isResponsesApi ? "responses" : isChatCompletions ? "chat_completions" : "unknown",
        hasOutput: isResponsesApi,
        outputLength: isResponsesApi ? response.output.length : 0,
        outputTypes: isResponsesApi ? response.output.map((item: any) => item.type) : undefined,
        hasChoices: isChatCompletions,
        choicesLength: isChatCompletions ? response.choices.length : 0,
        usage: response.usage,
      });

      let responseText = "";

      if (isResponsesApi) {
        for (const item of response.output) {
          if (item.type === "message" && item.content) {
            for (const content of item.content) {
              if (content.type === "output_text" && content.text) {
                responseText = content.text.trim();
                break;
              }
            }
            if (responseText) break;
          }
        }
      }

      if (!responseText && typeof response?.output_text === "string") {
        responseText = response.output_text.trim();
      }

      if (!responseText && isChatCompletions) {
        for (const choice of response.choices) {
          const message = choice?.message ?? choice?.delta;
          const content = message?.content;

          if (typeof content === "string" && content.trim()) {
            responseText = content.trim();
            break;
          }

          if (Array.isArray(content)) {
            for (const part of content) {
              if (typeof part?.text === "string" && part.text.trim()) {
                responseText = part.text.trim();
                break;
              }
            }
          }

          if (responseText) break;

          if (typeof choice?.text === "string" && choice.text.trim()) {
            responseText = choice.text.trim();
            break;
          }
        }
      }

      logger.logReasoning("OPENAI_RESPONSE", {
        model,
        responseLength: responseText.length,
        tokensUsed: response.usage?.total_tokens || 0,
        success: true,
        isEmpty: responseText.length === 0,
      });

      if (!responseText) {
        logger.logReasoning("OPENAI_EMPTY_RESPONSE_FALLBACK", {
          model,
          originalTextLength: text.length,
          reason: "Empty response from API",
        });
        return text;
      }

      return responseText;
    } catch (error) {
      logger.logReasoning("OPENAI_ERROR", {
        model,
        error: (error as Error).message,
        errorType: (error as Error).name,
      });
      throw error;
    } finally {
      this.isProcessing = false;
    }
  }

  private async processWithAnthropic(
    text: string,
    model: string,
    agentName: string | null = null,
    config: ReasoningConfig = {}
  ): Promise<string> {
    logger.logReasoning("ANTHROPIC_START", {
      model,
      agentName,
      environment: typeof window !== "undefined" ? "browser" : "node",
    });

    if (typeof window !== "undefined" && window.electronAPI) {
      const startTime = Date.now();

      logger.logReasoning("ANTHROPIC_IPC_CALL", {
        model,
        textLength: text.length,
      });

      const systemPrompt = this.resolveSystemPrompt(agentName, text, config);
      const result = await window.electronAPI.processAnthropicReasoning(text, model, agentName, {
        ...config,
        systemPrompt,
      });

      const processingTime = Date.now() - startTime;

      if (result.success) {
        logger.logReasoning("ANTHROPIC_SUCCESS", {
          model,
          processingTimeMs: processingTime,
          resultLength: result.text.length,
        });
        return result.text;
      } else {
        logger.logReasoning("ANTHROPIC_ERROR", {
          model,
          processingTimeMs: processingTime,
          error: result.error,
        });
        throw new Error(result.error);
      }
    } else {
      logger.logReasoning("ANTHROPIC_UNAVAILABLE", {
        reason: "Not in Electron environment",
      });
      throw new Error("Anthropic reasoning is not available in this environment");
    }
  }

  private async processWithLocal(
    text: string,
    model: string,
    agentName: string | null = null,
    config: ReasoningConfig = {}
  ): Promise<string> {
    logger.logReasoning("LOCAL_START", {
      model,
      agentName,
      environment: typeof window !== "undefined" ? "browser" : "node",
    });

    if (typeof window !== "undefined" && window.electronAPI) {
      const startTime = Date.now();

      logger.logReasoning("LOCAL_IPC_CALL", {
        model,
        textLength: text.length,
      });

      const systemPrompt = this.resolveSystemPrompt(agentName, text, config);
      const result = await window.electronAPI.processLocalReasoning(text, model, agentName, {
        ...config,
        systemPrompt,
      });

      const processingTime = Date.now() - startTime;

      if (result.success) {
        logger.logReasoning("LOCAL_SUCCESS", {
          model,
          processingTimeMs: processingTime,
          resultLength: result.text.length,
        });
        return result.text;
      } else {
        logger.logReasoning("LOCAL_ERROR", {
          model,
          processingTimeMs: processingTime,
          error: result.error,
        });
        throw new Error(result.error);
      }
    } else {
      logger.logReasoning("LOCAL_UNAVAILABLE", {
        reason: "Not in Electron environment",
      });
      throw new Error("Local reasoning is not available in this environment");
    }
  }

  private async processWithGemini(
    text: string,
    model: string,
    agentName: string | null = null,
    config: ReasoningConfig = {}
  ): Promise<string> {
    logger.logReasoning("GEMINI_START", {
      model,
      agentName,
      hasApiKey: false,
    });

    if (this.isProcessing) {
      throw new Error("Already processing a request");
    }

    const apiKey = await this.getApiKey("gemini");

    logger.logReasoning("GEMINI_API_KEY", {
      hasApiKey: !!apiKey,
      keyLength: apiKey?.length || 0,
    });

    this.isProcessing = true;

    try {
      const systemPrompt = this.resolveSystemPrompt(agentName, text, config);
      const userPrompt = text;

      const requestBody = {
        contents: [
          {
            parts: [
              {
                text: `${systemPrompt}\n\n${userPrompt}`,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: config.temperature || 0.3,
          maxOutputTokens:
            config.maxTokens ||
            Math.max(
              2000,
              this.calculateMaxTokens(
                text.length,
                TOKEN_LIMITS.MIN_TOKENS_GEMINI,
                TOKEN_LIMITS.MAX_TOKENS_GEMINI,
                TOKEN_LIMITS.TOKEN_MULTIPLIER
              )
            ),
        },
      };

      let response: any;
      try {
        response = await withRetry(async () => {
          const endpoint = `${API_ENDPOINTS.GEMINI}/models/${model}:generateContent`;
          logger.logReasoning("GEMINI_REQUEST", {
            endpoint,
            model,
            hasApiKey: !!apiKey,
            requestBody: JSON.stringify(requestBody).substring(0, 200),
          });

          try {
            const res = await this.performCloudReasoningRequest({
              endpoint,
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": apiKey,
              },
              body: JSON.stringify(requestBody),
              timeoutMs: 30000,
            });

            if (!res.ok) {
              const errorText = res.text;
              const errorData: any = res.json || { error: errorText || res.statusText };

              logger.logReasoning("GEMINI_API_ERROR_DETAIL", {
                status: res.status,
                statusText: res.statusText,
                error: errorData,
                errorMessage: errorData.error?.message || errorData.message || errorData.error,
                fullResponse: errorText.substring(0, 500),
              });

              const errorMessage =
                errorData.error?.message ||
                errorData.message ||
                errorData.error ||
                `Gemini API error: ${res.status}`;
              throw new Error(errorMessage);
            }

            const jsonResponse = res.json;

            logger.logReasoning("GEMINI_RAW_RESPONSE", {
              hasResponse: !!jsonResponse,
              responseKeys: jsonResponse ? Object.keys(jsonResponse) : [],
              hasCandidates: !!jsonResponse?.candidates,
              candidatesLength: jsonResponse?.candidates?.length || 0,
              fullResponse: JSON.stringify(jsonResponse).substring(0, 500),
            });

            return jsonResponse;
          } catch (error) {
            throw error;
          }
        }, createApiRetryStrategy());
      } catch (fetchError) {
        logger.logReasoning("GEMINI_FETCH_ERROR", {
          error: (fetchError as Error).message,
          stack: (fetchError as Error).stack,
        });
        throw fetchError;
      }

      if (!response.candidates || !response.candidates[0]) {
        logger.logReasoning("GEMINI_RESPONSE_ERROR", {
          model,
          response: JSON.stringify(response).substring(0, 500),
          hasCandidate: !!response.candidates,
          candidateCount: response.candidates?.length || 0,
        });
        throw new Error("Invalid response structure from Gemini API");
      }

      const candidate = response.candidates[0];
      if (!candidate.content?.parts?.[0]?.text) {
        logger.logReasoning("GEMINI_EMPTY_RESPONSE", {
          model,
          finishReason: candidate.finishReason,
          hasContent: !!candidate.content,
          hasParts: !!candidate.content?.parts,
          response: JSON.stringify(candidate).substring(0, 500),
        });

        if (candidate.finishReason === "MAX_TOKENS") {
          throw new Error(
            "Gemini reached token limit before generating response. Try a shorter input or increase max tokens."
          );
        }
        throw new Error("Gemini returned empty response");
      }

      const responseText = candidate.content.parts[0].text.trim();

      logger.logReasoning("GEMINI_RESPONSE", {
        model,
        responseLength: responseText.length,
        tokensUsed: response.usageMetadata?.totalTokenCount || 0,
        success: true,
      });

      return responseText;
    } catch (error) {
      logger.logReasoning("GEMINI_ERROR", {
        model,
        error: (error as Error).message,
        errorType: (error as Error).name,
      });
      throw error;
    } finally {
      this.isProcessing = false;
    }
  }

  private async processWithGroq(
    text: string,
    model: string,
    agentName: string | null = null,
    config: ReasoningConfig = {}
  ): Promise<string> {
    logger.logReasoning("GROQ_START", { model, agentName });

    if (this.isProcessing) {
      throw new Error("Already processing a request");
    }

    const apiKey = await this.getApiKey("groq");
    this.isProcessing = true;

    try {
      const endpoint = buildApiUrl(API_ENDPOINTS.GROQ_BASE, "/chat/completions");
      return await this.callChatCompletionsApi(
        endpoint,
        apiKey,
        model,
        text,
        agentName,
        config,
        "Groq"
      );
    } catch (error) {
      logger.logReasoning("GROQ_ERROR", {
        model,
        error: (error as Error).message,
        errorType: (error as Error).name,
      });
      throw error;
    } finally {
      this.isProcessing = false;
    }
  }

  private async processWithMouthpiece(
    text: string,
    model: string,
    agentName: string | null = null,
    config: ReasoningConfig = {}
  ): Promise<string> {
    logger.logReasoning("MOUTHPIECE_START", { model, agentName });

    if (this.isProcessing) {
      throw new Error("Already processing a request");
    }

    this.isProcessing = true;

    try {
      const customDictionary = this.getCustomDictionary();
      const language = this.getPreferredLanguage();
      const locale = this.getUiLanguage();
      const systemPrompt = this.resolveSystemPrompt(agentName, text, config);

      const result = await withSessionRefresh(async () => {
        const res = await (window as any).electronAPI.cloudReason(text, {
          agentName,
          customDictionary,
          customPrompt: this.getCustomPrompt(),
          systemPrompt,
          language,
          locale,
        });

        if (!res.success) {
          const err: any = new Error(res.error || "Mouthpiece cloud reasoning failed");
          err.code = res.code;
          throw err;
        }

        return res;
      });

      logger.logReasoning("MOUTHPIECE_SUCCESS", {
        model: result.model,
        provider: result.provider,
        resultLength: result.text.length,
      });

      return result.text;
    } catch (error) {
      logger.logReasoning("MOUTHPIECE_ERROR", {
        model,
        error: (error as Error).message,
      });
      throw error;
    } finally {
      this.isProcessing = false;
    }
  }

  private getCustomPrompt(): string | undefined {
    try {
      const raw = localStorage.getItem("customUnifiedPrompt");
      if (!raw) return undefined;
      const parsed = JSON.parse(raw);
      return typeof parsed === "string" ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      if (isCloudReasoningMode()) {
        logger.logReasoning("API_KEY_CHECK", { cloudReasoningMode: true });
        return true;
      }

      const settings = getSettings();
      const openaiKey = await window.electronAPI?.getOpenAIKey?.();
      const anthropicKey = await window.electronAPI?.getAnthropicKey?.();
      const geminiKey = await window.electronAPI?.getGeminiKey?.();
      const groqKey = await window.electronAPI?.getGroqKey?.();
      const bailianKey =
        (await window.electronAPI?.getBailianKey?.()) || settings.bailianApiKey || "";
      const isCustomProvider = settings.reasoningProvider === "custom";
      let customKey = "";
      if (isCustomProvider) {
        try {
          customKey = (await window.electronAPI?.getCustomReasoningKey?.()) || "";
        } catch (error) {
          logger.logReasoning("CUSTOM_KEY_AVAILABILITY_CHECK_FALLBACK", {
            error: (error as Error).message,
          });
        }

        if (!customKey.trim()) {
          customKey = settings.customReasoningApiKey || "";
        }
      }
      const customBaseUrl = (settings.cloudReasoningBaseUrl || "").trim();
      const customAvailable = isCustomProvider && !!customKey.trim() && !!customBaseUrl;
      const localAvailable = await window.electronAPI?.checkLocalReasoningAvailable?.();

      logger.logReasoning("API_KEY_CHECK", {
        hasOpenAI: !!openaiKey,
        hasAnthropic: !!anthropicKey,
        hasGemini: !!geminiKey,
        hasGroq: !!groqKey,
        hasBailian: !!bailianKey,
        isCustomProvider,
        hasCustom: !!customKey.trim(),
        hasCustomBaseUrl: !!customBaseUrl,
        hasLocal: !!localAvailable,
      });

      return !!(
        openaiKey ||
        anthropicKey ||
        geminiKey ||
        groqKey ||
        bailianKey ||
        customAvailable ||
        localAvailable
      );
    } catch (error) {
      logger.logReasoning("API_KEY_CHECK_ERROR", {
        error: (error as Error).message,
        stack: (error as Error).stack,
        name: (error as Error).name,
      });
      return false;
    }
  }

  clearApiKeyCache(
    provider?:
      | "openai"
      | "anthropic"
      | "gemini"
      | "groq"
      | "mistral"
      | "soniox"
      | "custom"
      | "bailian"
  ): void {
    if (provider) {
      if (provider !== "custom" && provider !== "bailian") {
        this.apiKeyCache.delete(provider);
      }
      logger.logReasoning("API_KEY_CACHE_CLEARED", { provider });
    } else {
      this.apiKeyCache.clear();
      logger.logReasoning("API_KEY_CACHE_CLEARED", { provider: "all" });
    }
  }

  destroy(): void {
    if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
      window.removeEventListener("api-key-changed", this.handleApiKeyChanged);
    }
    if (this.cacheCleanupStop) {
      this.cacheCleanupStop();
    }
  }
}

export default new ReasoningService();
