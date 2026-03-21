export type InsertionIntent = "insert" | "replace_selection" | "append_after_selection";
export type InsertionOutcomeMode = "inserted" | "replaced" | "appended" | "copied" | "failed";

export interface InsertionTargetAppLike {
  appName?: string | null;
  processId?: number | null;
  platform?: string | null;
  source?: string | null;
  capturedAt?: string | null;
}

export interface InsertionRequest {
  intent: InsertionIntent;
  replaceSelectionExpected: boolean;
  preserveClipboard: boolean;
  allowFallbackCopy: boolean;
  fromStreaming: boolean;
  suppressDictationPanelRestore: boolean;
  targetApp: InsertionTargetAppLike | null;
}

const DEFAULT_INTENT: InsertionIntent = "insert";

export function normalizeInsertionIntent(value?: string | null): InsertionIntent {
  switch (value) {
    case "replace_selection":
    case "append_after_selection":
    case "insert":
      return value;
    default:
      return DEFAULT_INTENT;
  }
}

export function normalizeInsertionOutcomeMode(value?: string | null): InsertionOutcomeMode {
  switch (value) {
    case "replaced":
    case "appended":
    case "copied":
    case "failed":
    case "inserted":
      return value;
    default:
      return "inserted";
  }
}

function normalizeTargetApp(targetApp?: InsertionTargetAppLike | null): InsertionTargetAppLike | null {
  if (!targetApp || typeof targetApp !== "object") {
    return null;
  }

  return {
    appName: typeof targetApp.appName === "string" ? targetApp.appName : null,
    processId: Number.isInteger(targetApp.processId) ? targetApp.processId : null,
    platform: typeof targetApp.platform === "string" ? targetApp.platform : null,
    source: typeof targetApp.source === "string" ? targetApp.source : null,
    capturedAt: typeof targetApp.capturedAt === "string" ? targetApp.capturedAt : null,
  };
}

export function normalizeInsertionRequest(request: Partial<InsertionRequest> = {}): InsertionRequest {
  const intent = normalizeInsertionIntent(request.intent);

  return {
    intent,
    replaceSelectionExpected:
      request.replaceSelectionExpected === true || intent === "replace_selection",
    preserveClipboard: request.preserveClipboard !== false,
    allowFallbackCopy: request.allowFallbackCopy !== false,
    fromStreaming: request.fromStreaming === true,
    suppressDictationPanelRestore: request.suppressDictationPanelRestore === true,
    targetApp: normalizeTargetApp(request.targetApp),
  };
}

export function buildInsertionRequest(request: Partial<InsertionRequest> = {}): InsertionRequest {
  return normalizeInsertionRequest(request);
}
