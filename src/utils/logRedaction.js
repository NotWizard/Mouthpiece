const TEXT_VALUE_KEY_RE =
  /(?:text|transcript|prompt|clipboard|body|payload|original|edited|field)/i;
const SECRET_KEY_RE =
  /(?:^|[-_])(?:api[-_]?key|authorization|auth[-_]?token|token|secret|password)(?:$|[-_])/i;
const SECRET_VALUE_RE =
  /\b(?:Bearer\s+[A-Za-z0-9._-]{8,}|sk-[A-Za-z0-9._-]{6,}|dg-[A-Za-z0-9._-]{6,}|AIza[0-9A-Za-z_-]{12,})\b/g;

const REDACTED_TEXT = "[REDACTED_TEXT]";
const REDACTED_SECRET = "[REDACTED_SECRET]";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function shouldRedactTextForKey(key) {
  return TEXT_VALUE_KEY_RE.test(String(key || ""));
}

function shouldRedactSecretForKey(key) {
  return SECRET_KEY_RE.test(String(key || ""));
}

function redactLogMessage(message) {
  if (typeof message !== "string" || !message) {
    return message;
  }

  return message.replace(SECRET_VALUE_RE, REDACTED_SECRET);
}

function redactStringValue(value, key) {
  if (shouldRedactSecretForKey(key)) {
    return REDACTED_SECRET;
  }

  if (shouldRedactTextForKey(key)) {
    return REDACTED_TEXT;
  }

  return redactLogMessage(value);
}

function redactLogValue(value, key = "", depth = 0) {
  if (depth > 6) {
    return "[REDACTED_DEPTH_LIMIT]";
  }

  if (typeof value === "string") {
    return redactStringValue(value, key);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactLogValue(entry, key, depth + 1));
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactLogValue(entryValue, entryKey, depth + 1),
      ])
    );
  }

  return value;
}

function redactLogMeta(meta) {
  if (meta === undefined) {
    return meta;
  }

  return redactLogValue(meta);
}

function redactLogEntry(entry = {}) {
  return {
    ...entry,
    message: redactLogMessage(entry.message),
    meta: redactLogMeta(entry.meta),
  };
}

module.exports = {
  REDACTED_TEXT,
  REDACTED_SECRET,
  redactLogEntry,
  redactLogMessage,
  redactLogMeta,
  redactLogValue,
};

module.exports.default = module.exports;
