const DISCOVERY_TIMEOUT_MS = 15000;
const ANTHROPIC_API_VERSION = "2023-06-01";
const DATE_SNAPSHOT_SUFFIX_RE = /-\d{4}-\d{2}-\d{2}$/;

export const MODEL_DISCOVERY_DEFAULT_BASE_URLS = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  groq: "https://api.groq.com/openai/v1",
  mistral: "https://api.mistral.ai/v1",
  deepgram: "https://api.deepgram.com/v1",
  soniox: "https://api.soniox.com/v1",
  bailian: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  custom: "",
};

export const MODEL_DISCOVERY_PROVIDER_CAPABILITIES = {
  openai: { supportsDiscovery: true, auth: "bearer", path: "/models" },
  anthropic: { supportsDiscovery: true, auth: "anthropic", path: "/models" },
  gemini: { supportsDiscovery: true, auth: "gemini", path: "/models" },
  groq: { supportsDiscovery: true, auth: "bearer", path: "/models" },
  mistral: { supportsDiscovery: true, auth: "bearer", path: "/models" },
  deepgram: { supportsDiscovery: true, auth: "deepgram-token", path: "/models" },
  soniox: { supportsDiscovery: true, auth: "bearer", path: "/models" },
  bailian: { supportsDiscovery: true, auth: "bearer", path: "/models" },
  custom: { supportsDiscovery: true, auth: "bearer", path: "/models" },
};

function normalizeBaseUrl(value) {
  if (!value || typeof value !== "string") return "";

  let normalized = value.trim();
  if (!normalized) return "";

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
}

function buildApiUrl(base, path) {
  const normalizedBase = normalizeBaseUrl(base);
  if (!path) return normalizedBase;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

function getProviderCapability(providerId) {
  return (
    MODEL_DISCOVERY_PROVIDER_CAPABILITIES[providerId] ||
    MODEL_DISCOVERY_PROVIDER_CAPABILITIES.custom
  );
}

function fingerprintSecret(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${value.length}:${(hash >>> 0).toString(36)}`;
}

export function getProviderModelDiscoveryBaseUrl(providerId, baseUrl) {
  return normalizeBaseUrl(baseUrl) || MODEL_DISCOVERY_DEFAULT_BASE_URLS[providerId] || "";
}

export function createProviderModelDiscoveryCacheKey({ providerId, baseUrl, apiKey } = {}) {
  const normalizedProvider = providerId || "custom";
  const discoveryBase = getProviderModelDiscoveryBaseUrl(normalizedProvider, baseUrl);
  const trimmedKey = typeof apiKey === "string" ? apiKey.trim() : "";
  const keyScope = trimmedKey ? `key:${fingerprintSecret(trimmedKey)}` : "public";
  return `${normalizedProvider}|${discoveryBase}|${keyScope}`;
}

export function createProviderModelDiscoveryRequest({ providerId, baseUrl, apiKey } = {}) {
  const normalizedProvider = providerId || "custom";
  const capability = getProviderCapability(normalizedProvider);
  const discoveryBase = getProviderModelDiscoveryBaseUrl(normalizedProvider, baseUrl);
  const endpoint = buildApiUrl(discoveryBase, capability.path);
  const trimmedKey = typeof apiKey === "string" ? apiKey.trim() : "";
  const headers = {};

  if (trimmedKey) {
    switch (capability.auth) {
      case "anthropic":
        headers["x-api-key"] = trimmedKey;
        headers["anthropic-version"] = ANTHROPIC_API_VERSION;
        break;
      case "gemini":
        headers["x-goog-api-key"] = trimmedKey;
        break;
      case "deepgram-token":
        headers.Authorization = `Token ${trimmedKey}`;
        break;
      default:
        headers.Authorization = `Bearer ${trimmedKey}`;
        break;
    }
  } else if (capability.auth === "anthropic") {
    headers["anthropic-version"] = ANTHROPIC_API_VERSION;
  }

  return {
    endpoint,
    method: "GET",
    headers,
    timeoutMs: DISCOVERY_TIMEOUT_MS,
  };
}

function getRawModels(providerId, payload) {
  if (!payload || typeof payload !== "object") return [];
  if (providerId === "deepgram" && Array.isArray(payload.stt)) return payload.stt;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.models)) return payload.models;
  if (Array.isArray(payload.stt)) return payload.stt;
  return [];
}

function stripGeminiModelPrefix(value) {
  return value.replace(/^models\//, "");
}

function normalizeModelValue(providerId, item) {
  const rawValue =
    item?.id ||
    item?.canonical_name ||
    item?.name ||
    item?.model ||
    item?.displayName ||
    item?.display_name;
  if (typeof rawValue !== "string") return "";
  return providerId === "gemini" ? stripGeminiModelPrefix(rawValue) : rawValue;
}

function normalizeModelLabel(providerId, item, value) {
  const rawLabel =
    item?.display_name ||
    item?.displayName ||
    item?.name ||
    item?.id ||
    item?.canonical_name ||
    value;
  if (typeof rawLabel !== "string" || !rawLabel.trim()) return value;
  return providerId === "gemini" ? rawLabel.replace(/^models\//, "") : rawLabel;
}

function buildDeepgramDescription(item) {
  const capabilities = [];
  if (item?.batch) capabilities.push("Batch");
  if (item?.streaming) capabilities.push("realtime");
  const languageList = Array.isArray(item?.languages) ? item.languages.filter(Boolean) : [];
  const languageSummary = languageList.slice(0, 4).join(", ");
  const suffix = languageSummary
    ? `${languageSummary}${languageList.length > 4 ? ` +${languageList.length - 4}` : ""}`
    : "";
  return [capabilities.join(" + "), suffix].filter(Boolean).join(" · ") || undefined;
}

function buildModelDescription(providerId, item) {
  if (typeof item?.description === "string" && item.description.trim()) {
    return item.description;
  }
  if (providerId === "deepgram") {
    return buildDeepgramDescription(item);
  }
  if (typeof item?.transcription_mode === "string") {
    return item.transcription_mode.replace(/_/g, " ");
  }
  return undefined;
}

function getOwnedBy(item) {
  if (typeof item?.owned_by === "string") return item.owned_by;
  if (typeof item?.ownedBy === "string") return item.ownedBy;
  return undefined;
}

function createModelOption(providerId, item, value, options = {}) {
  return {
    value,
    label: options.forceValueLabel ? value : normalizeModelLabel(providerId, item, value),
    description: buildModelDescription(providerId, item),
    ownedBy: getOwnedBy(item),
  };
}

function getBailianQwenTrunkValue(value) {
  return value.replace(DATE_SNAPSHOT_SUFFIX_RE, "");
}

function shouldIncludeModel({ providerId, purpose, item, value }) {
  const normalized = value.toLowerCase();

  if (providerId === "custom") return true;

  if (purpose === "reasoning") {
    if (providerId === "gemini") {
      const methods = Array.isArray(item?.supportedGenerationMethods)
        ? item.supportedGenerationMethods
        : [];
      return methods.includes("generateContent");
    }
    if (providerId === "deepgram" || providerId === "soniox") return false;
    return !/(whisper|transcribe|transcription|embedding|moderation|tts|audio|asr|rerank)/i.test(
      normalized
    );
  }

  if (providerId === "deepgram") return true;
  if (providerId === "soniox") return normalized.startsWith("stt-");
  if (providerId === "openai") return /(whisper|transcribe)/i.test(normalized);
  if (providerId === "groq") return /(whisper|transcribe|distil-whisper)/i.test(normalized);
  if (providerId === "mistral") return /(voxtral|transcrib|audio)/i.test(normalized);
  if (providerId === "bailian") {
    return (
      /(asr|paraformer|sensevoice|whisper)/i.test(normalized) &&
      !DATE_SNAPSHOT_SUFFIX_RE.test(normalized)
    );
  }

  return true;
}

export function normalizeProviderModelResponse({ providerId, purpose, payload } = {}) {
  const normalizedProvider = providerId || "custom";
  const rawModels = getRawModels(normalizedProvider, payload);
  const seen = new Set();
  const models = [];

  for (const item of rawModels) {
    const rawValue = normalizeModelValue(normalizedProvider, item);
    const value =
      normalizedProvider === "bailian" && purpose === "transcription"
        ? getBailianQwenTrunkValue(rawValue)
        : rawValue;
    if (!value || seen.has(value)) continue;
    if (!shouldIncludeModel({ providerId: normalizedProvider, purpose, item, value })) continue;

    seen.add(value);
    models.push(
      createModelOption(normalizedProvider, item, value, {
        forceValueLabel:
          normalizedProvider === "bailian" && purpose === "transcription" && rawValue !== value,
      })
    );
  }

  return models.sort((first, second) => first.label.localeCompare(second.label));
}

export function createModelDiscoveryErrorMessage(errorOrResponse) {
  if (!errorOrResponse) return "Unable to load models.";

  if (errorOrResponse instanceof Error) {
    return errorOrResponse.message || "Unable to load models.";
  }

  const status = Number(errorOrResponse.status);
  if (Number.isFinite(status) && status > 0) {
    const statusText =
      typeof errorOrResponse.statusText === "string" ? errorOrResponse.statusText.trim() : "";
    return `${status}${statusText ? ` ${statusText}` : ""}`;
  }

  return "Unable to load models.";
}
