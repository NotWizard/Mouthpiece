const toTrimmedString = (value) => (typeof value === "string" ? value.trim() : "");

export function getReasoningAvailabilityCacheKey(settings = {}) {
  return JSON.stringify({
    useReasoningModel: Boolean(settings.useReasoningModel),
    reasoningProvider: toTrimmedString(settings.reasoningProvider),
    reasoningModel: toTrimmedString(settings.reasoningModel),
    cloudReasoningMode: toTrimmedString(settings.cloudReasoningMode),
    isSignedIn: Boolean(settings.isSignedIn),
    cloudReasoningBaseUrl: toTrimmedString(settings.cloudReasoningBaseUrl),
    hasOpenAIKey: Boolean(toTrimmedString(settings.openaiApiKey)),
    hasAnthropicKey: Boolean(toTrimmedString(settings.anthropicApiKey)),
    hasGeminiKey: Boolean(toTrimmedString(settings.geminiApiKey)),
    hasGroqKey: Boolean(toTrimmedString(settings.groqApiKey)),
    hasBailianKey: Boolean(toTrimmedString(settings.bailianApiKey)),
    hasCustomReasoningKey: Boolean(toTrimmedString(settings.customReasoningApiKey)),
  });
}
