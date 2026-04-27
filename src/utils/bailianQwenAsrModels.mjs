export const BAILIAN_QWEN_ASR_BATCH_MODEL = "qwen3-asr-flash";
export const BAILIAN_QWEN_ASR_REALTIME_MODEL = "qwen3-asr-flash-realtime";

const BAILIAN_QWEN_ASR_BATCH_MODEL_RE = /^qwen3-asr-flash(?:-\d{4}-\d{2}-\d{2})?$/i;
const BAILIAN_QWEN_ASR_REALTIME_MODEL_RE = /^qwen3-asr-flash-realtime(?:-\d{4}-\d{2}-\d{2})?$/i;

export function normalizeBailianQwenAsrModelId(modelId) {
  const normalized = typeof modelId === "string" ? modelId.trim().toLowerCase() : "";
  if (!normalized) return "";
  if (BAILIAN_QWEN_ASR_REALTIME_MODEL_RE.test(normalized)) {
    return BAILIAN_QWEN_ASR_REALTIME_MODEL;
  }
  if (BAILIAN_QWEN_ASR_BATCH_MODEL_RE.test(normalized)) {
    return BAILIAN_QWEN_ASR_BATCH_MODEL;
  }
  return normalized;
}

export function getBailianQwenAsrMode(modelId) {
  const normalized = normalizeBailianQwenAsrModelId(modelId);
  if (normalized === BAILIAN_QWEN_ASR_REALTIME_MODEL) return "realtime";
  if (normalized === BAILIAN_QWEN_ASR_BATCH_MODEL) return "batch";
  return null;
}

export function isBailianQwenAsrModel(modelId) {
  return getBailianQwenAsrMode(modelId) !== null;
}

export function getBailianBatchTranscriptionModel(modelId) {
  const normalized = normalizeBailianQwenAsrModelId(modelId);
  return getBailianQwenAsrMode(normalized) === "batch" ? normalized : BAILIAN_QWEN_ASR_BATCH_MODEL;
}

export function getBailianRealtimeTranscriptionModel(modelId) {
  const normalized = normalizeBailianQwenAsrModelId(modelId);
  return getBailianQwenAsrMode(normalized) === "realtime"
    ? normalized
    : BAILIAN_QWEN_ASR_REALTIME_MODEL;
}
