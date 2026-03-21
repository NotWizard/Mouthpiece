const ASR_SESSION_SCHEMA_VERSION = 1;

export const ASR_SESSION_EVENT_TYPES = Object.freeze([
  "session_started",
  "capture_ready",
  "speech_detected",
  "first_partial",
  "first_stable_partial",
  "final_ready",
  "paste_started",
  "paste_finished",
  "fallback_used",
  "permission_required",
  "inserted",
  "cancelled",
  "error",
]);

const EVENT_TYPE_SET = new Set(ASR_SESSION_EVENT_TYPES);

const FIRST_OCCURRENCE_METRIC_KEYS = Object.freeze({
  capture_ready: "captureReadyLatencyMs",
  speech_detected: "speechDetectedLatencyMs",
  first_partial: "firstPartialLatencyMs",
  first_stable_partial: "firstStablePartialLatencyMs",
  final_ready: "finalReadyLatencyMs",
  paste_started: "pasteStartedLatencyMs",
  paste_finished: "pasteFinishedLatencyMs",
  inserted: "insertedLatencyMs",
});

function createEmptyMetrics() {
  return {
    captureReadyLatencyMs: null,
    speechDetectedLatencyMs: null,
    firstPartialLatencyMs: null,
    firstStablePartialLatencyMs: null,
    finalReadyLatencyMs: null,
    pasteStartedLatencyMs: null,
    pasteFinishedLatencyMs: null,
    insertedLatencyMs: null,
    pasteRoundTripMs: null,
    totalLatencyMs: null,
  };
}

function normalizeNowInput(now) {
  if (typeof now === "function") {
    return normalizeNowInput(now());
  }
  if (now instanceof Date) {
    return now;
  }
  if (typeof now === "number" || typeof now === "string") {
    const date = new Date(now);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }
  return new Date();
}

function calculateRelativeMs(startedAtMs, atMs) {
  return Math.max(0, Math.round(atMs - startedAtMs));
}

function getLastEventType(timeline) {
  if (!Array.isArray(timeline?.events) || timeline.events.length === 0) {
    return null;
  }
  return timeline.events[timeline.events.length - 1]?.type ?? null;
}

function updateDerivedMetrics(timeline, event) {
  const metricKey = FIRST_OCCURRENCE_METRIC_KEYS[event.type];
  if (metricKey && timeline.metrics[metricKey] === null) {
    timeline.metrics[metricKey] = event.relativeMs;
  }

  if (
    event.type === "paste_finished" &&
    timeline.metrics.pasteStartedLatencyMs !== null &&
    timeline.metrics.pasteRoundTripMs === null
  ) {
    timeline.metrics.pasteRoundTripMs = Math.max(
      0,
      event.relativeMs - timeline.metrics.pasteStartedLatencyMs
    );
  }
}

function updateDerivedFlags(timeline, eventType) {
  if (eventType === "fallback_used") {
    timeline.flags.fallbackUsed = true;
  }
  if (eventType === "permission_required") {
    timeline.flags.permissionRequired = true;
  }
  if (eventType === "error") {
    timeline.flags.errorSeen = true;
  }
}

export function createAsrSessionId({
  now = new Date(),
  random = Math.random,
} = {}) {
  const date = normalizeNowInput(now);
  const timestamp = date
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14);
  const suffix = Math.floor((typeof random === "function" ? random() : Math.random()) * 1679616)
    .toString(36)
    .padStart(4, "0")
    .slice(0, 4);
  return `asr_${timestamp}_${suffix}`;
}

export function createAsrSessionTimeline({
  sessionId = createAsrSessionId(),
  mode = "batch",
  context = "dictation",
  provider = null,
  startedAtMs = 0,
  startedAtIso = new Date().toISOString(),
} = {}) {
  const timeline = {
    schemaVersion: ASR_SESSION_SCHEMA_VERSION,
    sessionId,
    mode,
    context,
    provider,
    status: "active",
    startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : 0,
    startedAtIso: normalizeNowInput(startedAtIso).toISOString(),
    completedAtMs: null,
    flags: {
      fallbackUsed: false,
      permissionRequired: false,
      errorSeen: false,
    },
    metrics: createEmptyMetrics(),
    events: [],
  };

  markAsrSessionEvent(
    timeline,
    "session_started",
    {
      mode,
      context,
      provider,
    },
    timeline.startedAtMs
  );

  return timeline;
}

export function hasAsrSessionEvent(timeline, eventType) {
  if (!timeline || !Array.isArray(timeline.events)) {
    return false;
  }
  return timeline.events.some((event) => event.type === eventType);
}

export function markAsrSessionEvent(timeline, eventType, data = {}, atMs = undefined) {
  if (!timeline || typeof timeline !== "object") {
    throw new Error("ASR session timeline is required");
  }
  if (!EVENT_TYPE_SET.has(eventType)) {
    throw new Error(`Unsupported ASR session event type: ${eventType}`);
  }

  const eventAtMs = Number.isFinite(atMs) ? atMs : timeline.startedAtMs;
  const event = {
    type: eventType,
    atMs: eventAtMs,
    relativeMs: calculateRelativeMs(timeline.startedAtMs, eventAtMs),
    data: data && typeof data === "object" ? { ...data } : {},
  };

  timeline.events.push(event);
  updateDerivedFlags(timeline, eventType);
  updateDerivedMetrics(timeline, event);

  if (eventType === "cancelled") {
    timeline.status = "cancelled";
  } else if (eventType === "inserted") {
    timeline.status = "inserted";
  } else if (eventType === "error") {
    timeline.status = "error";
  }

  return summarizeAsrSessionTimeline(timeline);
}

export function summarizeAsrSessionTimeline(timeline) {
  return {
    schemaVersion: timeline.schemaVersion,
    sessionId: timeline.sessionId,
    mode: timeline.mode,
    context: timeline.context,
    provider: timeline.provider,
    status: timeline.status,
    startedAtIso: timeline.startedAtIso,
    startedAtMs: timeline.startedAtMs,
    completedAtMs: timeline.completedAtMs,
    lastEventType: getLastEventType(timeline),
    flags: { ...timeline.flags },
    metrics: { ...timeline.metrics },
    events: timeline.events.map((event) => ({
      ...event,
      data: { ...event.data },
    })),
  };
}

export function finalizeAsrSessionTimeline(
  timeline,
  { status = undefined, completedAtMs = undefined } = {}
) {
  if (!timeline || typeof timeline !== "object") {
    throw new Error("ASR session timeline is required");
  }

  if (status) {
    timeline.status = status;
  }

  if (Number.isFinite(completedAtMs)) {
    timeline.completedAtMs = completedAtMs;
  } else if (timeline.events.length > 0) {
    timeline.completedAtMs = timeline.events[timeline.events.length - 1].atMs;
  } else {
    timeline.completedAtMs = timeline.startedAtMs;
  }

  timeline.metrics.totalLatencyMs = calculateRelativeMs(timeline.startedAtMs, timeline.completedAtMs);

  if (
    timeline.metrics.pasteStartedLatencyMs !== null &&
    timeline.metrics.pasteFinishedLatencyMs !== null
  ) {
    timeline.metrics.pasteRoundTripMs =
      timeline.metrics.pasteFinishedLatencyMs - timeline.metrics.pasteStartedLatencyMs;
  }

  return summarizeAsrSessionTimeline(timeline);
}
