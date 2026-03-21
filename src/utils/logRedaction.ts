const REDACTED = "[REDACTED]";

const SENSITIVE_KEY_RE =
  /(api[_-]?key|authorization|token|secret|password|clipboard|transcript|prompt|text|payload|fieldvalue|originaltext|newfieldvalue)/i;
const OPENAI_KEY_RE = /\bsk-[A-Za-z0-9_-]{12,}\b/g;
const BEARER_TOKEN_RE = /\bBearer\s+[A-Za-z0-9._-]+\b/gi;

function redactSensitiveString(value: string, label = "value"): string {
  if (!value) return value;
  return `[REDACTED:${label}:${value.length}]`;
}

export function redactLogValue(value: unknown, keyPath = ""): unknown {
  if (value == null) {
    return value;
  }

  if (typeof value === "string") {
    if (SENSITIVE_KEY_RE.test(keyPath)) {
      return redactSensitiveString(value, keyPath || "text");
    }

    return value.replace(OPENAI_KEY_RE, REDACTED).replace(BEARER_TOKEN_RE, "Bearer [REDACTED]");
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactLogValue(item, keyPath));
  }

  if (typeof value === "object") {
    return redactLogMeta(value as Record<string, unknown>, keyPath);
  }

  return value;
}

export function redactLogMeta(
  meta: Record<string, unknown> | unknown,
  parentKey = ""
): Record<string, unknown> | unknown {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    return redactLogValue(meta, parentKey);
  }

  const redactedEntries = Object.entries(meta).map(([key, value]) => {
    const nextKey = parentKey ? `${parentKey}.${key}` : key;
    return [key, redactLogValue(value, nextKey)];
  });

  return Object.fromEntries(redactedEntries);
}

export function redactLogEntry(entry: {
  level?: string;
  message?: string;
  meta?: unknown;
  scope?: string;
  source?: string;
}) {
  return {
    ...entry,
    meta: redactLogMeta(entry.meta),
  };
}
