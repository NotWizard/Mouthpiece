type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

const LOG_LEVELS: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

const normalizeLevel = (value?: string | null): LogLevel | null => {
  if (!value) return null;
  const lower = value.toLowerCase();
  return lower in LOG_LEVELS ? (lower as LogLevel) : null;
};

const defaultLevel: LogLevel = "info";

// Cached synchronously so the hot path (audioManager calls these ~120× per
// dictation) doesn't pay the awaited resolveLogLevel + awaited IPC cost on
// every call. The cache is seeded with the conservative default and
// upgraded asynchronously once main returns the configured level — calls
// during the brief startup window simply use the default, which matches
// the previous async behaviour for the first few entries anyway.
let cachedLevel: LogLevel = defaultLevel;

const refetchLogLevelFromMain = () => {
  if (typeof window !== "undefined" && window.electronAPI?.getLogLevel) {
    Promise.resolve(window.electronAPI.getLogLevel())
      .then((level) => {
        const normalized = normalizeLevel(level);
        if (normalized) cachedLevel = normalized;
      })
      .catch(() => {});
  }
};
refetchLogLevelFromMain();

const shouldLog = (level: LogLevel) => LOG_LEVELS[level] >= LOG_LEVELS[cachedLevel];

const logToConsole = (level: LogLevel, message: string, meta?: any, scope?: string) => {
  const levelTag = `[${level.toUpperCase()}]`;
  const scopeTag = scope ? `[${scope}]` : "";
  const consoleFn =
    level === "error" || level === "fatal"
      ? console.error
      : level === "warn"
        ? console.warn
        : console.log;
  if (meta !== undefined) {
    consoleFn(`${levelTag}${scopeTag} ${message}`, meta);
  } else {
    consoleFn(`${levelTag}${scopeTag} ${message}`);
  }
};

const log = (level: LogLevel, message: string, meta?: any, scope?: string) => {
  if (!shouldLog(level)) return;

  // Always write to console first so DevTools / dev runs see the entry
  // without waiting on the main-process round-trip. Then fire-and-forget
  // the IPC forward so the on-disk debug log still captures the entry,
  // but the caller (and the microtask queue) is never blocked on it.
  logToConsole(level, String(message), meta, scope);

  if (typeof window !== "undefined" && window.electronAPI?.log) {
    Promise.resolve(
      window.electronAPI.log({
        level,
        message: String(message),
        meta,
        scope,
        source: "renderer",
      })
    ).catch(() => {});
  }
};

const logger = {
  trace: (message: string, meta?: any, scope?: string) => log("trace", message, meta, scope),
  debug: (message: string, meta?: any, scope?: string) => log("debug", message, meta, scope),
  info: (message: string, meta?: any, scope?: string) => log("info", message, meta, scope),
  warn: (message: string, meta?: any, scope?: string) => log("warn", message, meta, scope),
  error: (message: string, meta?: any, scope?: string) => log("error", message, meta, scope),
  fatal: (message: string, meta?: any, scope?: string) => log("fatal", message, meta, scope),
  logReasoning: (stage: string, details?: any) => log("debug", stage, details, "reasoning"),
  refreshLogLevel: () => {
    cachedLevel = defaultLevel;
    refetchLogLevelFromMain();
  },
};

export default logger;
