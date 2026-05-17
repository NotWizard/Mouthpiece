"use strict";

function computeReasoningEnvUpdate(prefs = {}) {
  const provider = typeof prefs.reasoningProvider === "string" ? prefs.reasoningProvider : "";
  const model = typeof prefs.reasoningModel === "string" ? prefs.reasoningModel : "";

  if (!provider) {
    return {
      setVars: {},
      clearVars: ["REASONING_PROVIDER", "LOCAL_REASONING_MODEL"],
      stopLlamaServer: true,
    };
  }

  if (provider === "local") {
    const setVars = { REASONING_PROVIDER: "local" };
    const clearVars = [];
    if (model) {
      setVars.LOCAL_REASONING_MODEL = model;
    } else {
      clearVars.push("LOCAL_REASONING_MODEL");
    }
    return { setVars, clearVars, stopLlamaServer: false };
  }

  return {
    setVars: { REASONING_PROVIDER: provider },
    clearVars: ["LOCAL_REASONING_MODEL"],
    stopLlamaServer: true,
  };
}

module.exports = { computeReasoningEnvUpdate };
