const DASHSCOPE_TRANSCRIPTION_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const BAILIAN_TRANSCRIPTION_DEFAULT_MODEL = "qwen3-asr-flash";

const toTrimmedString = (value) => (typeof value === "string" ? value.trim() : "");

const normalizeBaseUrl = (value) => {
  const trimmed = toTrimmedString(value);
  if (!trimmed) return "";

  let normalized = trimmed.replace(/\/+$/, "");
  const suffixReplacements = [
    [/\/v1\/chat\/completions$/i, "/v1"],
    [/\/chat\/completions$/i, ""],
    [/\/v1\/responses$/i, "/v1"],
    [/\/responses$/i, ""],
    [/\/v1\/models$/i, "/v1"],
    [/\/models$/i, ""],
    [/\/v1\/audio\/transcriptions$/i, "/v1"],
    [/\/audio\/transcriptions$/i, ""],
    [/\/v1\/audio\/translations$/i, "/v1"],
    [/\/audio\/translations$/i, ""],
  ];

  for (const [pattern, replacement] of suffixReplacements) {
    if (pattern.test(normalized)) {
      normalized = normalized.replace(pattern, replacement).replace(/\/+$/, "");
    }
  }

  return normalized.replace(/\/+$/, "");
};

export function isDashScopeTranscriptionBaseUrl(value) {
  return normalizeBaseUrl(value) === DASHSCOPE_TRANSCRIPTION_BASE_URL;
}

export function normalizeCloudTranscriptionProviderSettings(settings = {}) {
  const cloudTranscriptionProvider =
    toTrimmedString(settings.cloudTranscriptionProvider) || "openai";
  const cloudTranscriptionBaseUrl = toTrimmedString(settings.cloudTranscriptionBaseUrl);
  const cloudTranscriptionModel = toTrimmedString(settings.cloudTranscriptionModel);
  const customTranscriptionApiKey = toTrimmedString(settings.customTranscriptionApiKey);
  const bailianApiKey = toTrimmedString(settings.bailianApiKey);

  const didPromoteCustomDashScope =
    cloudTranscriptionProvider === "custom" &&
    isDashScopeTranscriptionBaseUrl(cloudTranscriptionBaseUrl);

  const normalizedProvider = didPromoteCustomDashScope ? "bailian" : cloudTranscriptionProvider;
  const normalizedModel =
    normalizedProvider === "bailian"
      ? cloudTranscriptionModel || BAILIAN_TRANSCRIPTION_DEFAULT_MODEL
      : cloudTranscriptionModel;
  const normalizedBailianApiKey =
    normalizedProvider === "bailian" && !bailianApiKey ? customTranscriptionApiKey : bailianApiKey;

  return {
    cloudTranscriptionProvider: normalizedProvider,
    cloudTranscriptionBaseUrl,
    cloudTranscriptionModel: normalizedModel,
    bailianApiKey: normalizedBailianApiKey,
    didPromoteCustomDashScope,
  };
}

export {
  DASHSCOPE_TRANSCRIPTION_BASE_URL,
  BAILIAN_TRANSCRIPTION_DEFAULT_MODEL,
};
