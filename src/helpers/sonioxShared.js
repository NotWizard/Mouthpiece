const SONIOX_ASYNC_MODEL = "stt-async-v4";
const SONIOX_REALTIME_MODEL = "stt-rt-v4";
const SONIOX_FIN_TOKEN = "<fin>";

const normalizeTokenText = (text) => (typeof text === "string" ? text : "");

const normalizeTranscriptText = (text) => text.replace(/\s+/g, " ").trim();

const buildTokenSignature = (token, index = 0) => {
  const start = Number.isFinite(token?.start_ms) ? token.start_ms : `na-${index}`;
  const end = Number.isFinite(token?.end_ms) ? token.end_ms : `na-${index}`;
  const text = normalizeTokenText(token?.text);
  return `${start}:${end}:${text}`;
};

const joinTokenTexts = (tokens = []) =>
  normalizeTranscriptText(tokens.map((token) => normalizeTokenText(token?.text)).join(""));

const createContextTerms = (keyterms = []) =>
  keyterms
    .map((term) => (typeof term === "string" ? term.trim() : ""))
    .filter(Boolean)
    .slice(0, 100);

const createInitialSonioxTranscriptState = () => ({
  stableTokenKeys: new Set(),
  stableTokens: [],
  finalText: "",
  unstableText: "",
  liveText: "",
  sawFin: false,
});

const hasSonioxFinalizeToken = (tokens = []) =>
  Array.isArray(tokens) &&
  tokens.some(
    (token) => normalizeTokenText(token?.text) === SONIOX_FIN_TOKEN && token?.is_final === true
  );

/**
 * @typedef {object} SelectSonioxModelOptions
 * @property {string} [requestedModel]
 * @property {boolean} [realtimeEnabled]
 */

/**
 * @param {SelectSonioxModelOptions} [options]
 */
const selectSonioxModel = ({ requestedModel, realtimeEnabled = false } = {}) => {
  if (realtimeEnabled) {
    return requestedModel === SONIOX_REALTIME_MODEL ? requestedModel : SONIOX_REALTIME_MODEL;
  }

  return requestedModel === SONIOX_ASYNC_MODEL ? requestedModel : SONIOX_ASYNC_MODEL;
};

const buildSonioxRealtimeConfig = ({
  apiKey,
  model,
  realtimeEnabled = true,
  sampleRate = 16000,
  numChannels = 1,
  language,
  keyterms = [],
} = {}) => {
  if (!apiKey) {
    throw new Error("Soniox realtime config requires an API key");
  }

  const config = {
    api_key: apiKey,
    model: selectSonioxModel({ requestedModel: model, realtimeEnabled }),
    audio_format: "pcm_s16le",
    sample_rate: sampleRate,
    num_channels: numChannels,
    enable_endpoint_detection: true,
  };

  if (language && language !== "auto") {
    config.language_hints = [language];
    config.enable_language_identification = true;
  }

  const terms = createContextTerms(keyterms);
  if (terms.length > 0) {
    config.context = { terms };
  }

  return config;
};

const buildSonioxAsyncPayload = ({ model, language, keyterms = [] } = {}) => {
  const payload = {
    model: selectSonioxModel({ requestedModel: model, realtimeEnabled: false }),
  };

  if (language && language !== "auto") {
    payload.language_hints = [language];
    payload.enable_language_identification = true;
  }

  const terms = createContextTerms(keyterms);
  if (terms.length > 0) {
    payload.context = { terms };
  }

  return payload;
};

const accumulateSonioxTokens = (state = createInitialSonioxTranscriptState(), tokens = []) => {
  const nextState = {
    stableTokenKeys: new Set(state.stableTokenKeys || []),
    stableTokens: [...(state.stableTokens || [])],
    finalText: state.finalText || "",
    unstableText: "",
    liveText: state.liveText || state.finalText || "",
    sawFin: Boolean(state.sawFin),
  };

  const unstableTokens = [];
  const unstableTokenKeys = new Set();

  for (const token of Array.isArray(tokens) ? tokens : []) {
    const text = normalizeTokenText(token?.text);
    if (!text) continue;

    if (text === SONIOX_FIN_TOKEN) {
      nextState.sawFin = nextState.sawFin || token?.is_final === true;
      continue;
    }

    const signature = buildTokenSignature(
      token,
      nextState.stableTokens.length + unstableTokens.length
    );

    if (token?.is_final) {
      if (!nextState.stableTokenKeys.has(signature)) {
        nextState.stableTokenKeys.add(signature);
        nextState.stableTokens.push(token);
      }
      continue;
    }

    if (!nextState.stableTokenKeys.has(signature) && !unstableTokenKeys.has(signature)) {
      unstableTokenKeys.add(signature);
      unstableTokens.push(token);
    }
  }

  nextState.finalText = joinTokenTexts(nextState.stableTokens);
  nextState.unstableText = joinTokenTexts(unstableTokens);
  nextState.liveText = normalizeTranscriptText(
    [nextState.finalText, nextState.unstableText].filter(Boolean).join(" ")
  );

  return nextState;
};

module.exports = {
  SONIOX_ASYNC_MODEL,
  SONIOX_REALTIME_MODEL,
  SONIOX_FIN_TOKEN,
  buildSonioxAsyncPayload,
  buildSonioxRealtimeConfig,
  createInitialSonioxTranscriptState,
  selectSonioxModel,
  accumulateSonioxTokens,
  hasSonioxFinalizeToken,
};
