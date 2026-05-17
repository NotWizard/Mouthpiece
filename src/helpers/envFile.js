"use strict";

const KV_LINE_RE = /^\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*=(.*)$/;

function isCommentLine(line) {
  return /^\s*#/.test(line);
}

function isBlankLine(line) {
  return /^\s*$/.test(line);
}

function parseLine(line) {
  if (isCommentLine(line)) return { kind: "comment", text: line };
  if (isBlankLine(line)) return { kind: "blank", text: line };
  const match = KV_LINE_RE.exec(line);
  if (!match) return { kind: "other", text: line };
  return { kind: "kv", key: match[1], rawValue: match[2], text: line };
}

function formatKv(key, value) {
  return `${key}=${value}`;
}

function mergeEnvFile({ existingContent = "", processEnv = {}, persistedKeys = [] } = {}) {
  const persistedSet = new Set(persistedKeys);
  const lines = existingContent.split(/\r?\n/);
  const trailingBlank = lines.length > 0 && lines[lines.length - 1] === "" ? lines.pop() : null;

  const seenPersisted = new Set();
  const out = [];

  for (const raw of lines) {
    const parsed = parseLine(raw);
    if (parsed.kind === "kv" && persistedSet.has(parsed.key)) {
      seenPersisted.add(parsed.key);
      const value = processEnv[parsed.key];
      if (value === undefined || value === null || value === "") {
        // Skip the line — clearing this persisted key
        continue;
      }
      out.push(formatKv(parsed.key, value));
    } else {
      out.push(raw);
    }
  }

  for (const key of persistedKeys) {
    if (seenPersisted.has(key)) continue;
    const value = processEnv[key];
    if (value === undefined || value === null || value === "") continue;
    out.push(formatKv(key, value));
  }

  let result = out.join("\n");
  if (trailingBlank !== null || result.length > 0) {
    if (!result.endsWith("\n")) result += "\n";
  }
  return result;
}

module.exports = { mergeEnvFile };
