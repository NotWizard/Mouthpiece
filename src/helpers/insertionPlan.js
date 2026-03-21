function normalizeIntent(intent) {
  switch (intent) {
    case "replace_selection":
    case "append_after_selection":
    case "insert":
      return intent;
    default:
      return "insert";
  }
}

function getIntentOutcomeMode(intent) {
  switch (intent) {
    case "replace_selection":
      return "replaced";
    case "append_after_selection":
      return "appended";
    case "insert":
    default:
      return "inserted";
  }
}

function getMonitorPlan(intent, primaryActionType) {
  if (primaryActionType !== "auto_paste") {
    return {
      mode: "disabled",
      reason: "clipboard_only",
    };
  }

  if (intent === "append_after_selection") {
    return {
      mode: "disabled",
      reason: "append_intent",
    };
  }

  if (intent === "replace_selection") {
    return {
      mode: "selection_sensitive",
      reason: "replace_selection",
    };
  }

  return {
    mode: "standard",
    reason: "post_insert_learning",
  };
}

function createInsertionPlan({ platform, request = {}, capabilities = {} } = {}) {
  const intent = normalizeIntent(request.intent);
  const autoPasteViable = capabilities.autoPasteViable !== false;
  const primaryAction = autoPasteViable
    ? {
        type: "auto_paste",
        reason: "platform_supported",
      }
    : {
        type: "clipboard_only",
        reason: capabilities.autoPasteReason || "auto_paste_unavailable",
      };

  return {
    platform: platform || process.platform,
    intent,
    replaceSelectionExpected:
      request.replaceSelectionExpected === true || intent === "replace_selection",
    preserveClipboard: request.preserveClipboard !== false,
    allowFallbackCopy: request.allowFallbackCopy !== false,
    primaryAction,
    fallbackAction:
      request.allowFallbackCopy === false
        ? { type: "none", reason: "fallback_disabled" }
        : { type: "clipboard_only", reason: "manual_recovery_available" },
    monitor: getMonitorPlan(intent, primaryAction.type),
    expectedOutcomeMode:
      primaryAction.type === "clipboard_only" ? "copied" : getIntentOutcomeMode(intent),
  };
}

function resolveInsertionOutcomeMode({ plan, mode, success }) {
  if (mode === "copied") return "copied";
  if (mode === "failed" || success === false) return "failed";
  if (plan?.expectedOutcomeMode) {
    return plan.expectedOutcomeMode;
  }
  return "inserted";
}

module.exports = {
  createInsertionPlan,
  resolveInsertionOutcomeMode,
};
