const { ipcMain, app, shell, BrowserWindow } = require("electron");
const path = require("path");
const http = require("http");
const https = require("https");
const crypto = require("crypto");
const AppUtils = require("../utils");
const debugLogger = require("./debugLogger");
const GnomeShortcutManager = require("./gnomeShortcut");
const AssemblyAiStreaming = require("./assemblyAiStreaming");
const { i18nMain, changeLanguage } = require("./i18nMain");
const DeepgramStreaming = require("./deepgramStreaming");
const QwenRealtimeStreaming = require("./qwenRealtimeStreaming");
const SonioxStreaming = require("./sonioxStreaming");
const { buildSonioxAsyncPayload } = require("./sonioxShared");
const { shouldRestoreDictationPanelAfterPaste } = require("./pasteUiState");
const { resolveSensitiveAppPolicy } = require("../config/sensitiveAppPolicy.js");

const MISTRAL_TRANSCRIPTION_URL = "https://api.mistral.ai/v1/audio/transcriptions";
const SONIOX_API_BASE_URL = "https://api.soniox.com/v1";
const SONIOX_FILES_URL = `${SONIOX_API_BASE_URL}/files`;
const SONIOX_TRANSCRIPTIONS_URL = `${SONIOX_API_BASE_URL}/transcriptions`;
const SONIOX_ASYNC_POLL_INTERVAL_MS = 1000;
const SONIOX_ASYNC_TIMEOUT_MS = 120000;
const HTTP_REQUEST_TIMEOUT_MS = 120000;
const HTTP_TIMEOUT_ERROR_CODE = "REQUEST_TIMEOUT";

// Debounce delay: wait for user to stop typing before processing corrections
const AUTO_LEARN_DEBOUNCE_MS = 1500;

function createTimeoutError(timeoutMs) {
  const err = new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s`);
  err.code = HTTP_TIMEOUT_ERROR_CODE;
  err.timeoutMs = timeoutMs;
  return err;
}

function parseJsonSafely(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeInsertionIntent(value) {
  switch (value) {
    case "replace_selection":
    case "append_after_selection":
    case "insert":
      return value;
    default:
      return "insert";
  }
}

function normalizeInsertionOutcome(mode, success) {
  if (mode === "copied") return "copied";
  if (mode === "failed" || success === false) return "failed";
  if (mode === "replaced") return "replaced";
  if (mode === "appended") return "appended";
  return "inserted";
}

function normalizePasteTargetApp(targetApp, { targetPid } = {}) {
  if (!targetApp || typeof targetApp !== "object") {
    return {
      appName: null,
      processId: Number.isInteger(targetPid) ? targetPid : null,
      platform: process.platform,
      source: "renderer-fallback",
      capturedAt: null,
    };
  }

  return {
    appName: typeof targetApp.appName === "string" ? targetApp.appName : null,
    processId: Number.isInteger(targetApp.processId)
      ? targetApp.processId
      : Number.isInteger(targetPid)
        ? targetPid
        : null,
    platform: typeof targetApp.platform === "string" ? targetApp.platform : process.platform,
    source: typeof targetApp.source === "string" ? targetApp.source : "renderer-fallback",
    capturedAt: typeof targetApp.capturedAt === "string" ? targetApp.capturedAt : null,
  };
}

async function performProxyHttpRequest({
  endpoint,
  method = "GET",
  headers,
  body,
  timeoutMs = 30000,
}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(createTimeoutError(timeoutMs)), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method,
      headers,
      body,
      signal: controller.signal,
    });

    const text = await response.text();

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      text,
      json: parseJsonSafely(text),
    };
  } catch (error) {
    if (error?.name === "AbortError" || error?.code === HTTP_TIMEOUT_ERROR_CODE) {
      throw createTimeoutError(timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildMultipartBody(fileBuffer, fileName, contentType, fields = {}) {
  const boundary = `----Mouthpiece${Date.now()}`;
  const parts = [];

  parts.push(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`
  );
  parts.push(fileBuffer);
  parts.push("\r\n");

  for (const [name, value] of Object.entries(fields)) {
    if (value != null) {
      parts.push(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="${name}"\r\n\r\n` +
          `${value}\r\n`
      );
    }
  }

  parts.push(`--${boundary}--\r\n`);

  const bodyParts = parts.map((p) => (typeof p === "string" ? Buffer.from(p) : p));
  return { body: Buffer.concat(bodyParts), boundary };
}

function postMultipart(url, body, boundary, headers = {}, timeoutMs = HTTP_REQUEST_TIMEOUT_MS) {
  const httpModule = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      abortController.abort(createTimeoutError(timeoutMs));
    }, timeoutMs);

    const clearRequestTimeout = () => {
      clearTimeout(timeoutId);
    };

    const req = httpModule.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search || ""}`,
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length,
          ...headers,
        },
      },
      (res) => {
        let responseData = "";
        res.on("data", (chunk) => (responseData += chunk));
        res.on("end", () => {
          clearRequestTimeout();
          try {
            resolve({ statusCode: res.statusCode, data: JSON.parse(responseData) });
          } catch (e) {
            reject(new Error(`Invalid JSON response: ${responseData.slice(0, 200)}`));
          }
        });
      }
    );

    const abortHandler = () => {
      req.destroy(abortController.signal.reason || createTimeoutError(timeoutMs));
    };
    abortController.signal.addEventListener("abort", abortHandler, { once: true });

    req.on("error", (error) => {
      clearRequestTimeout();
      reject(error);
    });
    req.write(body);
    req.end();
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON response: ${text.slice(0, 200)}`);
  }
}

async function readSonioxResponse(response) {
  const payload = await readJsonResponse(response).catch(() => ({}));
  if (response.ok) {
    return payload;
  }

  const message =
    payload?.message ||
    payload?.error?.message ||
    `Soniox API Error: ${response.status} ${response.statusText}`;
  const error = new Error(message);
  error.status = response.status;
  error.payload = payload;
  throw error;
}

class IPCHandlers {
  constructor(managers) {
    this.environmentManager = managers.environmentManager;
    this.databaseManager = managers.databaseManager;
    this.clipboardManager = managers.clipboardManager;
    this.whisperManager = managers.whisperManager;
    this.parakeetManager = managers.parakeetManager;
    this.updateManager = managers.updateManager;
    this.windowManager = managers.windowManager;
    this.windowsKeyManager = managers.windowsKeyManager;
    this.textEditMonitor = managers.textEditMonitor;
    this.getTrayManager = managers.getTrayManager;
    this.whisperCudaManager = managers.whisperCudaManager;
    this.sessionId = crypto.randomUUID();
    this.assemblyAiStreaming = null;
    this.deepgramStreaming = null;
    this.bailianRealtimeStreaming = null;
    this.sonioxStreaming = null;
    this._autoLearnEnabled = true; // Default on, synced from renderer
    this._autoLearnDebounceTimer = null;
    this._autoLearnLatestData = null;
    this._lastPastePolicyContext = null;
    this._textEditHandler = null;
    this._setupTextEditMonitor();
    this.setupHandlers();

    if (this.whisperManager?.serverManager) {
      this.whisperManager.serverManager.on("cuda-fallback", () => {
        this.broadcastToWindows("cuda-fallback-notification", {});
      });
    }

    if (this.updateManager?.on) {
      this.updateManager.on("status-changed", (status) => {
        this.broadcastToWindows("update-status-changed", status);
      });
    }
  }

  _getDictionarySafe() {
    try {
      return this.databaseManager.getDictionary();
    } catch {
      return [];
    }
  }

  _cleanupTextEditMonitor() {
    if (this._autoLearnDebounceTimer) {
      clearTimeout(this._autoLearnDebounceTimer);
      this._autoLearnDebounceTimer = null;
    }
    this._autoLearnLatestData = null;
    if (this.textEditMonitor && this._textEditHandler) {
      this.textEditMonitor.removeListener("text-edited", this._textEditHandler);
      this._textEditHandler = null;
    }
  }

  _setupTextEditMonitor() {
    if (!this.textEditMonitor) return;

    this._textEditHandler = (data) => {
      if (
        !data ||
        typeof data.originalText !== "string" ||
        typeof data.newFieldValue !== "string"
      ) {
        debugLogger.debug("[AutoLearn] Invalid event payload, skipping");
        return;
      }

      const { originalText, newFieldValue } = data;
      const policyContext = this._lastPastePolicyContext || null;

      debugLogger.debug("[AutoLearn] text-edited event", {
        originalPreview: originalText.substring(0, 80),
        newValuePreview: newFieldValue.substring(0, 80),
        targetApp: policyContext?.targetApp?.appName || "",
      });

      this._autoLearnLatestData = { originalText, newFieldValue, policyContext };

      if (this._autoLearnDebounceTimer) {
        clearTimeout(this._autoLearnDebounceTimer);
      }

      this._autoLearnDebounceTimer = setTimeout(() => {
        this._processCorrections();
      }, AUTO_LEARN_DEBOUNCE_MS);
    };

    this.textEditMonitor.on("text-edited", this._textEditHandler);
  }

  _processCorrections() {
    this._autoLearnDebounceTimer = null;
    if (!this._autoLearnLatestData) return;
    if (!this._autoLearnEnabled) {
      debugLogger.debug("[AutoLearn] Disabled, skipping correction processing");
      this._autoLearnLatestData = null;
      return;
    }

    const { originalText, newFieldValue, policyContext } = this._autoLearnLatestData;
    this._autoLearnLatestData = null;

    if (policyContext?.sensitiveAppDecision?.blocksAutoLearn) {
      debugLogger.debug("[AutoLearn] Sensitive app policy skipped correction processing", {
        matchedRuleId: policyContext.sensitiveAppDecision.ruleId,
        action: policyContext.sensitiveAppDecision.action,
        appName: policyContext.targetApp?.appName || "",
      });
      return;
    }

    try {
      const { extractCorrectionSuggestions } = require("../utils/correctionLearner");
      const currentDict = this._getDictionarySafe();
      const corrections = extractCorrectionSuggestions(originalText, newFieldValue, currentDict);
      const normalizeKey = (value) =>
        String(value || "")
          .trim()
          .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
          .toLowerCase();
      const currentKeys = new Set(currentDict.map(normalizeKey).filter(Boolean));
      const dedupedCorrections = [];
      const dedupedKeys = new Set();
      for (const correction of corrections) {
        const cleaned = String(correction?.term || "").trim();
        const key = normalizeKey(cleaned);
        if (!cleaned || !key || !correction?.sourceTerm) continue;
        if (currentKeys.has(key) || dedupedKeys.has(key)) continue;
        dedupedCorrections.push({
          term: cleaned,
          sourceTerm: String(correction.sourceTerm || "").trim(),
          source: String(correction.source || "auto_learn_edit").trim() || "auto_learn_edit",
        });
        dedupedKeys.add(key);
      }

      debugLogger.debug("[AutoLearn] Corrections result", {
        corrections: dedupedCorrections,
        dictSize: currentDict.length,
      });

      if (dedupedCorrections.length > 0) {
        // Show the overlay so the toast is visible (it may have been hidden after dictation)
        this.windowManager.showDictationPanel();
        this.broadcastToWindows("corrections-learned", dedupedCorrections);
        debugLogger.debug("[AutoLearn] Saved corrections", { corrections: dedupedCorrections });
      }
    } catch (error) {
      debugLogger.debug("[AutoLearn] Error processing corrections", { error: error.message });
    }
  }

  _syncStartupEnv(setVars, clearVars = []) {
    let changed = false;
    for (const [key, value] of Object.entries(setVars)) {
      if (process.env[key] !== value) {
        process.env[key] = value;
        changed = true;
      }
    }
    for (const key of clearVars) {
      if (process.env[key]) {
        delete process.env[key];
        changed = true;
      }
    }
    if (changed) {
      debugLogger.debug("Synced startup env vars", {
        set: Object.keys(setVars),
        cleared: clearVars.filter((k) => !process.env[k]),
      });
      this.environmentManager.saveAllKeysToEnvFile().catch(() => {});
    }
  }

  setupHandlers() {
    ipcMain.handle("window-minimize", () => {
      if (this.windowManager.controlPanelWindow) {
        this.windowManager.controlPanelWindow.minimize();
      }
    });

    ipcMain.handle("window-maximize", () => {
      if (this.windowManager.controlPanelWindow) {
        if (this.windowManager.controlPanelWindow.isMaximized()) {
          this.windowManager.controlPanelWindow.unmaximize();
        } else {
          this.windowManager.controlPanelWindow.maximize();
        }
      }
    });

    ipcMain.handle("window-close", () => {
      if (this.windowManager.controlPanelWindow) {
        this.windowManager.controlPanelWindow.close();
      }
    });

    ipcMain.handle("window-is-maximized", () => {
      if (this.windowManager.controlPanelWindow) {
        return this.windowManager.controlPanelWindow.isMaximized();
      }
      return false;
    });

    ipcMain.handle("app-quit", () => {
      app.quit();
    });

    ipcMain.handle("hide-window", () => {
      this.windowManager.hideDictationPanel();
    });

    ipcMain.handle("show-dictation-panel", () => {
      this.windowManager.showDictationPanel();
    });

    ipcMain.handle("force-stop-dictation", () => {
      if (this.windowManager?.forceStopMacCompoundPush) {
        this.windowManager.forceStopMacCompoundPush("manual");
      }
      return { success: true };
    });

    ipcMain.handle("set-main-window-interactivity", (event, shouldCapture) => {
      this.windowManager.setMainWindowInteractivity(Boolean(shouldCapture));
      return { success: true };
    });

    ipcMain.handle("set-dictation-cancel-enabled", (event, enabled) => {
      this.windowManager.setDictationCancelEnabled(Boolean(enabled));
      return { success: true };
    });

    ipcMain.handle("resize-main-window", (event, sizeKey) => {
      return this.windowManager.resizeMainWindow(sizeKey);
    });

    ipcMain.handle("get-openai-key", async (event) => {
      return this.environmentManager.getOpenAIKey();
    });

    ipcMain.handle("save-openai-key", async (event, key) => {
      return this.environmentManager.saveOpenAIKey(key);
    });

    ipcMain.handle("create-production-env-file", async (event, apiKey) => {
      return this.environmentManager.createProductionEnvFile(apiKey);
    });

    ipcMain.handle("db-save-transcription", async (event, text) => {
      const result = this.databaseManager.saveTranscription(text);
      if (result?.success && result?.transcription) {
        setImmediate(() => {
          this.broadcastToWindows("transcription-added", result.transcription);
        });
      }
      return result;
    });

    ipcMain.handle("db-get-transcriptions", async (event, limit = 50) => {
      return this.databaseManager.getTranscriptions(limit);
    });

    ipcMain.handle("db-clear-transcriptions", async (event) => {
      const result = this.databaseManager.clearTranscriptions();
      if (result?.success) {
        setImmediate(() => {
          this.broadcastToWindows("transcriptions-cleared", {
            cleared: result.cleared,
          });
        });
      }
      return result;
    });

    ipcMain.handle("db-delete-transcription", async (event, id) => {
      const result = this.databaseManager.deleteTranscription(id);
      if (result?.success) {
        setImmediate(() => {
          this.broadcastToWindows("transcription-deleted", { id });
        });
      }
      return result;
    });

    // Dictionary handlers
    ipcMain.on("auto-learn-changed", (_event, enabled) => {
      this._autoLearnEnabled = !!enabled;
      if (!this._autoLearnEnabled) {
        if (this._autoLearnDebounceTimer) {
          clearTimeout(this._autoLearnDebounceTimer);
          this._autoLearnDebounceTimer = null;
        }
        this._autoLearnLatestData = null;
      }
      debugLogger.debug("[AutoLearn] Setting changed", { enabled: this._autoLearnEnabled });
    });

    ipcMain.handle("db-get-dictionary", async () => {
      return this.databaseManager.getDictionary();
    });

    ipcMain.handle("db-set-dictionary", async (event, words) => {
      if (!Array.isArray(words)) {
        throw new Error("words must be an array");
      }
      return this.databaseManager.setDictionary(words);
    });

    ipcMain.handle("undo-learned-corrections", async (_event, words) => {
      try {
        if (!Array.isArray(words) || words.length === 0) {
          return { success: false };
        }
        const validWords = words.filter((w) => typeof w === "string" && w.trim().length > 0);
        if (validWords.length === 0) {
          return { success: false };
        }
        const currentDict = this._getDictionarySafe();
        const removeSet = new Set(validWords.map((w) => w.toLowerCase()));
        const updatedDict = currentDict.filter((w) => !removeSet.has(w.toLowerCase()));
        const saveResult = this.databaseManager.setDictionary(updatedDict);
        if (saveResult?.success === false) {
          debugLogger.debug("[AutoLearn] Undo failed to save dictionary", {
            error: saveResult.error,
          });
          return { success: false };
        }
        this.broadcastToWindows("dictionary-updated", updatedDict);
        debugLogger.debug("[AutoLearn] Undo: removed words", { words: validWords });
        return { success: true };
      } catch (err) {
        debugLogger.debug("[AutoLearn] Undo failed", { error: err.message });
        return { success: false };
      }
    });

    ipcMain.handle("paste-text", async (event, text, options) => {
      const targetPid = Number.isInteger(this.textEditMonitor?.lastTargetPid)
        ? this.textEditMonitor.lastTargetPid
        : null;
      const normalizedOptions = {
        ...options,
        intent: normalizeInsertionIntent(options?.intent),
        replaceSelectionExpected:
          options?.replaceSelectionExpected === true || options?.intent === "replace_selection",
        preserveClipboard: options?.preserveClipboard !== false,
        allowFallbackCopy: options?.allowFallbackCopy !== false,
        targetApp: normalizePasteTargetApp(options?.targetApp, { targetPid }),
      };
      const privacyPreferences = {
        protectionsEnabled: options?.sensitiveAppProtectionEnabled !== false,
        allowCloudReasoning: options?.allowSensitiveAppCloudReasoning === true,
        allowAutoLearn: options?.allowSensitiveAppAutoLearn === true,
        allowPasteMonitoring: options?.allowSensitiveAppPasteMonitoring === true,
        allowInjection: options?.sensitiveAppBlockInsertion === false,
      };
      const sensitiveAppPolicy = resolveSensitiveAppPolicy({
        targetApp: normalizedOptions.targetApp,
        ...privacyPreferences,
      });

      // If the floating dictation panel currently has focus, dismiss it so the
      // paste keystroke lands in the user's target app instead of the overlay.
      const mainWindow = this.windowManager?.mainWindow;
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused()) {
        if (process.platform === "darwin") {
          // hide() forces macOS to activate the previous app; showInactive()
          // restores the overlay without stealing focus.
          mainWindow.hide();
          await new Promise((resolve) => setTimeout(resolve, 120));
          mainWindow.showInactive();
        } else {
          mainWindow.blur();
          await new Promise((resolve) => setTimeout(resolve, 80));
        }
      }
      const result = sensitiveAppPolicy.blocksInjection
        ? normalizedOptions.allowFallbackCopy !== false
          ? await this.clipboardManager.writeClipboard(text, event.sender).then((copyResult) => ({
              success: !!copyResult?.success,
              mode: copyResult?.success ? "copied" : "failed",
              outcomeMode: copyResult?.success ? "copied" : "failed",
              reason: copyResult?.success
                ? "sensitive_app_manual_paste_required"
                : "sensitive_app_injection_blocked",
              message: copyResult?.success
                ? "Sensitive app protection copied the text for manual paste instead of injecting it automatically."
                : "Sensitive app protection blocked automatic insertion in this app.",
              method: copyResult?.success ? "clipboard_only" : "blocked_by_policy",
              compatibilityProfileId: "sensitive-app",
              compatibilityFamily: "sensitive-app",
              feedbackCode: copyResult?.success
                ? "manual_paste_required"
                : "automatic_insertion_blocked",
              recoveryHint: copyResult?.success
                ? "manual_paste"
                : "disable_sensitive_app_blocking_if_you_really_need_auto_insert",
              manualAction: copyResult?.success ? "paste_manually" : "retry_elsewhere",
              retryCount: 0,
            }))
          : {
              success: false,
              mode: "failed",
              outcomeMode: "failed",
              reason: "sensitive_app_injection_blocked",
              message: "Sensitive app protection blocked automatic insertion in this app.",
              method: "blocked_by_policy",
              compatibilityProfileId: "sensitive-app",
              compatibilityFamily: "sensitive-app",
              feedbackCode: "automatic_insertion_blocked",
              recoveryHint: "disable_sensitive_app_blocking_if_you_really_need_auto_insert",
              manualAction: "retry_elsewhere",
              retryCount: 0,
            }
        : await this.clipboardManager.pasteText(text, {
            ...normalizedOptions,
            webContents: event.sender,
            targetPid,
          });
      const normalizedResult = {
        ...result,
        intent: normalizedOptions.intent,
        outcomeMode:
          result?.outcomeMode || normalizeInsertionOutcome(result?.mode, result?.success),
        monitorMode: result?.monitorMode || "standard",
        compatibilityProfileId: result?.compatibilityProfileId || "generic",
        compatibilityFamily: result?.compatibilityFamily || "generic",
        feedbackCode: result?.feedbackCode || null,
        recoveryHint: result?.recoveryHint || null,
        manualAction: result?.manualAction || null,
        retryCount: Number.isInteger(result?.retryCount) ? result.retryCount : 0,
        targetApp: normalizedOptions.targetApp,
        replaceSelectionExpected: normalizedOptions.replaceSelectionExpected,
        preserveClipboard: normalizedOptions.preserveClipboard,
        allowFallbackCopy: normalizedOptions.allowFallbackCopy,
        sensitiveAppPolicy,
      };
      debugLogger.info(
        "[PASTE_PROTOCOL] paste-text result",
        {
          mode: normalizedResult?.mode || "unknown",
          outcomeMode: normalizedResult?.outcomeMode || "unknown",
          intent: normalizedResult?.intent || "insert",
          success: !!normalizedResult?.success,
          reason: normalizedResult?.reason || "",
          method: normalizedResult?.method || "",
          platform: normalizedResult?.platform || process.platform,
          targetApp: normalizedResult?.targetApp?.appName || "",
          compatibilityProfileId: normalizedResult?.compatibilityProfileId || "generic",
          feedbackCode: normalizedResult?.feedbackCode || "",
          retryCount: normalizedResult?.retryCount || 0,
        },
        "clipboard"
      );

      if (shouldRestoreDictationPanelAfterPaste(normalizedResult, normalizedOptions)) {
        this.windowManager?.showDictationPanel?.();
      }

      this._lastPastePolicyContext = {
        targetApp: normalizedOptions.targetApp,
        sensitiveAppDecision: sensitiveAppPolicy,
        privacyPreferences,
      };

      debugLogger.debug("[AutoLearn] Paste completed", {
        autoLearnEnabled: this._autoLearnEnabled,
        hasMonitor: !!this.textEditMonitor,
        targetPid,
      });
      if (
        this.textEditMonitor &&
        this._autoLearnEnabled &&
        !sensitiveAppPolicy.blocksAutoLearn &&
        !sensitiveAppPolicy.blocksPasteMonitoring
      ) {
        setTimeout(() => {
          try {
            debugLogger.debug("[AutoLearn] Starting monitoring", {
              textPreview: text.substring(0, 80),
            });
            this.textEditMonitor.startMonitoring(text, 30000, {
              targetPid,
              intent: normalizedOptions.intent,
              monitorMode: normalizedResult.monitorMode,
            });
          } catch (err) {
            debugLogger.debug("[AutoLearn] Failed to start monitoring", { error: err.message });
          }
        }, 500);
      } else if (sensitiveAppPolicy.matched) {
        debugLogger.debug("[AutoLearn] Sensitive app policy skipped monitoring", {
          matchedRuleId: sensitiveAppPolicy.ruleId,
          action: sensitiveAppPolicy.action,
          appName: normalizedOptions.targetApp?.appName || "",
        });
      }
      return normalizedResult;
    });

    ipcMain.handle("check-accessibility-permission", async (event, options) => {
      return this.clipboardManager.checkAccessibilityPermissions(options);
    });

    ipcMain.handle("reset-accessibility-permissions", async () => {
      return this.clipboardManager.resetAccessibilityPermissions();
    });

    ipcMain.handle("read-clipboard", async (event) => {
      return this.clipboardManager.readClipboard();
    });

    ipcMain.handle("write-clipboard", async (event, text) => {
      return this.clipboardManager.writeClipboard(text, event.sender);
    });

    ipcMain.handle("check-paste-tools", async () => {
      return this.clipboardManager.checkPasteTools();
    });

    ipcMain.handle("get-target-app-info", async () => {
      const info = this.textEditMonitor?.getLastTargetAppInfo?.() || {};
      const hasMainProcessData = Boolean(info.appName) || Number.isInteger(info.processId);

      return {
        appName: info.appName || null,
        processId: Number.isInteger(info.processId) ? info.processId : null,
        platform: process.platform,
        source: hasMainProcessData ? "main-process" : "renderer-fallback",
        capturedAt: info.capturedAt || null,
      };
    });

    ipcMain.handle("transcribe-local-whisper", async (event, audioBlob, options = {}) => {
      debugLogger.log("transcribe-local-whisper called", {
        audioBlobType: typeof audioBlob,
        audioBlobSize: audioBlob?.byteLength || audioBlob?.length || 0,
        options,
      });

      try {
        const result = await this.whisperManager.transcribeLocalWhisper(audioBlob, options);

        debugLogger.log("Whisper result", {
          success: result.success,
          hasText: !!result.text,
          message: result.message,
          error: result.error,
        });

        // Check if no audio was detected and send appropriate event
        if (!result.success && result.message === "No audio detected") {
          debugLogger.log("Sending no-audio-detected event to renderer");
          event.sender.send("no-audio-detected");
        }

        return result;
      } catch (error) {
        debugLogger.error("Local Whisper transcription error", error);
        const errorMessage = error.message || "Unknown error";

        // Return specific error types for better user feedback
        if (errorMessage.includes("FFmpeg not found")) {
          return {
            success: false,
            error: "ffmpeg_not_found",
            message: "FFmpeg is missing. Please reinstall the app or install FFmpeg manually.",
          };
        }
        if (
          errorMessage.includes("FFmpeg conversion failed") ||
          errorMessage.includes("FFmpeg process error")
        ) {
          return {
            success: false,
            error: "ffmpeg_error",
            message: "Audio conversion failed. The recording may be corrupted.",
          };
        }
        if (
          errorMessage.includes("whisper.cpp not found") ||
          errorMessage.includes("whisper-cpp")
        ) {
          return {
            success: false,
            error: "whisper_not_found",
            message: "Whisper binary is missing. Please reinstall the app.",
          };
        }
        if (
          errorMessage.includes("Audio buffer is empty") ||
          errorMessage.includes("Audio data too small")
        ) {
          return {
            success: false,
            error: "no_audio_data",
            message: "No audio detected",
          };
        }
        if (errorMessage.includes("model") && errorMessage.includes("not downloaded")) {
          return {
            success: false,
            error: "model_not_found",
            message: errorMessage,
          };
        }

        throw error;
      }
    });

    ipcMain.handle("check-whisper-installation", async (event) => {
      return this.whisperManager.checkWhisperInstallation();
    });

    ipcMain.handle("get-audio-diagnostics", async () => {
      return this.whisperManager.getDiagnostics();
    });

    ipcMain.handle("download-whisper-model", async (event, modelName) => {
      try {
        const result = await this.whisperManager.downloadWhisperModel(modelName, (progressData) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send("whisper-download-progress", progressData);
          }
        });
        return result;
      } catch (error) {
        if (!event.sender.isDestroyed()) {
          event.sender.send("whisper-download-progress", {
            type: "error",
            model: modelName,
            error: error.message,
            code: error.code || "DOWNLOAD_FAILED",
          });
        }
        return {
          success: false,
          error: error.message,
          code: error.code || "DOWNLOAD_FAILED",
        };
      }
    });

    ipcMain.handle("check-model-status", async (event, modelName) => {
      return this.whisperManager.checkModelStatus(modelName);
    });

    ipcMain.handle("list-whisper-models", async (event) => {
      return this.whisperManager.listWhisperModels();
    });

    ipcMain.handle("delete-whisper-model", async (event, modelName) => {
      return this.whisperManager.deleteWhisperModel(modelName);
    });

    ipcMain.handle("delete-all-whisper-models", async () => {
      return this.whisperManager.deleteAllWhisperModels();
    });

    ipcMain.handle("cancel-whisper-download", async (event) => {
      return this.whisperManager.cancelDownload();
    });

    ipcMain.handle("whisper-server-start", async (event, modelName) => {
      const useCuda =
        process.env.WHISPER_CUDA_ENABLED === "true" && this.whisperCudaManager?.isDownloaded();
      return this.whisperManager.startServer(modelName, { useCuda });
    });

    ipcMain.handle("whisper-server-stop", async () => {
      return this.whisperManager.stopServer();
    });

    ipcMain.handle("whisper-server-status", async () => {
      return this.whisperManager.getServerStatus();
    });

    ipcMain.handle("detect-gpu", async () => {
      const { detectNvidiaGpu } = require("../utils/gpuDetection");
      return detectNvidiaGpu();
    });

    ipcMain.handle("get-cuda-whisper-status", async () => {
      const { detectNvidiaGpu } = require("../utils/gpuDetection");
      const gpuInfo = await detectNvidiaGpu();
      if (!this.whisperCudaManager) {
        return { downloaded: false, path: null, gpuInfo };
      }
      return {
        downloaded: this.whisperCudaManager.isDownloaded(),
        path: this.whisperCudaManager.getCudaBinaryPath(),
        gpuInfo,
      };
    });

    ipcMain.handle("download-cuda-whisper-binary", async (event) => {
      if (!this.whisperCudaManager) {
        return { success: false, error: "CUDA not supported on this platform" };
      }
      try {
        await this.whisperCudaManager.download((progress) => {
          if (progress.type === "progress" && !event.sender.isDestroyed()) {
            event.sender.send("cuda-download-progress", {
              downloadedBytes: progress.downloaded_bytes,
              totalBytes: progress.total_bytes,
              percentage: progress.percentage,
            });
          }
        });
        this._syncStartupEnv({ WHISPER_CUDA_ENABLED: "true" });
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("cancel-cuda-whisper-download", async () => {
      if (!this.whisperCudaManager) return { success: false };
      return this.whisperCudaManager.cancelDownload();
    });

    ipcMain.handle("delete-cuda-whisper-binary", async () => {
      if (!this.whisperCudaManager) return { success: false };
      const result = await this.whisperCudaManager.delete();
      if (result.success) {
        this._syncStartupEnv({}, ["WHISPER_CUDA_ENABLED"]);
      }
      return result;
    });

    ipcMain.handle("check-ffmpeg-availability", async (event) => {
      return this.whisperManager.checkFFmpegAvailability();
    });

    ipcMain.handle("transcribe-local-parakeet", async (event, audioBlob, options = {}) => {
      debugLogger.log("transcribe-local-parakeet called", {
        audioBlobType: typeof audioBlob,
        audioBlobSize: audioBlob?.byteLength || audioBlob?.length || 0,
        options,
      });

      try {
        const result = await this.parakeetManager.transcribeLocalParakeet(audioBlob, options);

        debugLogger.log("Parakeet result", {
          success: result.success,
          hasText: !!result.text,
          message: result.message,
          error: result.error,
        });

        if (!result.success && result.message === "No audio detected") {
          debugLogger.log("Sending no-audio-detected event to renderer");
          event.sender.send("no-audio-detected");
        }

        return result;
      } catch (error) {
        debugLogger.error("Local Parakeet transcription error", error);
        const errorMessage = error.message || "Unknown error";

        if (errorMessage.includes("sherpa-onnx") && errorMessage.includes("not found")) {
          return {
            success: false,
            error: "parakeet_not_found",
            message: "Parakeet binary is missing. Please reinstall the app.",
          };
        }
        if (errorMessage.includes("model") && errorMessage.includes("not downloaded")) {
          return {
            success: false,
            error: "model_not_found",
            message: errorMessage,
          };
        }

        throw error;
      }
    });

    ipcMain.handle("check-parakeet-installation", async () => {
      return this.parakeetManager.checkInstallation();
    });

    ipcMain.handle("download-parakeet-model", async (event, modelName) => {
      try {
        const result = await this.parakeetManager.downloadParakeetModel(
          modelName,
          (progressData) => {
            if (!event.sender.isDestroyed()) {
              event.sender.send("parakeet-download-progress", progressData);
            }
          }
        );
        return result;
      } catch (error) {
        if (!event.sender.isDestroyed()) {
          event.sender.send("parakeet-download-progress", {
            type: "error",
            model: modelName,
            error: error.message,
            code: error.code || "DOWNLOAD_FAILED",
          });
        }
        return {
          success: false,
          error: error.message,
          code: error.code || "DOWNLOAD_FAILED",
        };
      }
    });

    ipcMain.handle("check-parakeet-model-status", async (_event, modelName) => {
      return this.parakeetManager.checkModelStatus(modelName);
    });

    ipcMain.handle("list-parakeet-models", async () => {
      return this.parakeetManager.listParakeetModels();
    });

    ipcMain.handle("delete-parakeet-model", async (_event, modelName) => {
      return this.parakeetManager.deleteParakeetModel(modelName);
    });

    ipcMain.handle("delete-all-parakeet-models", async () => {
      return this.parakeetManager.deleteAllParakeetModels();
    });

    ipcMain.handle("cancel-parakeet-download", async () => {
      return this.parakeetManager.cancelDownload();
    });

    ipcMain.handle("get-parakeet-diagnostics", async () => {
      return this.parakeetManager.getDiagnostics();
    });

    ipcMain.handle("parakeet-server-start", async (event, modelName) => {
      const result = await this.parakeetManager.startServer(modelName);
      process.env.LOCAL_TRANSCRIPTION_PROVIDER = "nvidia";
      process.env.PARAKEET_MODEL = modelName;
      await this.environmentManager.saveAllKeysToEnvFile();
      return result;
    });

    ipcMain.handle("parakeet-server-stop", async () => {
      const result = await this.parakeetManager.stopServer();
      delete process.env.LOCAL_TRANSCRIPTION_PROVIDER;
      delete process.env.PARAKEET_MODEL;
      await this.environmentManager.saveAllKeysToEnvFile();
      return result;
    });

    ipcMain.handle("parakeet-server-status", async () => {
      return this.parakeetManager.getServerStatus();
    });

    ipcMain.handle("cleanup-app", async (event) => {
      AppUtils.cleanup(this.windowManager.mainWindow);
      return { success: true, message: "Cleanup completed successfully" };
    });

    ipcMain.handle("update-hotkey", async (event, hotkey) => {
      return await this.windowManager.updateHotkey(hotkey);
    });

    ipcMain.handle("set-hotkey-listening-mode", async (event, enabled, newHotkey = null) => {
      this.windowManager.setHotkeyListeningMode(enabled);
      const hotkeyManager = this.windowManager.hotkeyManager;

      // When exiting capture mode with a new hotkey, use that to avoid reading stale state
      const effectiveHotkey = !enabled && newHotkey ? newHotkey : hotkeyManager.getCurrentHotkey();

      const {
        isGlobeLikeHotkey,
        isModifierOnlyHotkey,
        isRightSideModifier,
      } = require("./hotkeyManager");
      const usesNativeListener = (hotkey) =>
        !hotkey ||
        isGlobeLikeHotkey(hotkey) ||
        isModifierOnlyHotkey(hotkey) ||
        isRightSideModifier(hotkey);

      if (enabled) {
        // Entering capture mode - unregister globalShortcut so it doesn't consume key events
        const currentHotkey = hotkeyManager.getCurrentHotkey();
        if (currentHotkey && !usesNativeListener(currentHotkey)) {
          debugLogger.log(
            `[IPC] Unregistering globalShortcut "${currentHotkey}" for hotkey capture mode`
          );
          const { globalShortcut } = require("electron");
          globalShortcut.unregister(currentHotkey);
        }

        // On Windows, stop the Windows key listener
        if (process.platform === "win32" && this.windowsKeyManager) {
          debugLogger.log("[IPC] Stopping Windows key listener for hotkey capture mode");
          this.windowsKeyManager.stop();
        }

        // On GNOME Wayland, unregister the keybinding during capture
        if (hotkeyManager.isUsingGnome() && hotkeyManager.gnomeManager) {
          debugLogger.log("[IPC] Unregistering GNOME keybinding for hotkey capture mode");
          await hotkeyManager.gnomeManager.unregisterKeybinding().catch((err) => {
            debugLogger.warn("[IPC] Failed to unregister GNOME keybinding:", err.message);
          });
        }
      } else {
        // Exiting capture mode - re-register globalShortcut if not already registered
        if (effectiveHotkey && !usesNativeListener(effectiveHotkey)) {
          const { globalShortcut } = require("electron");
          const accelerator = effectiveHotkey.startsWith("Fn+")
            ? effectiveHotkey.slice(3)
            : effectiveHotkey;
          if (!globalShortcut.isRegistered(accelerator)) {
            debugLogger.log(
              `[IPC] Re-registering globalShortcut "${accelerator}" after capture mode`
            );
            const callback = this.windowManager.createHotkeyCallback();
            const registered = globalShortcut.register(accelerator, callback);
            if (!registered) {
              debugLogger.warn(
                `[IPC] Failed to re-register globalShortcut "${accelerator}" after capture mode`
              );
            }
          }
        }

        if (process.platform === "win32" && this.windowsKeyManager) {
          debugLogger.log(`[IPC] Exiting hotkey capture mode, hotkey="${effectiveHotkey}"`);
          const needsListener = effectiveHotkey && !isGlobeLikeHotkey(effectiveHotkey);
          if (needsListener) {
            debugLogger.log(`[IPC] Restarting Windows key listener for hotkey: ${effectiveHotkey}`);
            this.windowsKeyManager.start(effectiveHotkey);
          }
        }

        // On GNOME Wayland, re-register the keybinding with the effective hotkey
        if (hotkeyManager.isUsingGnome() && hotkeyManager.gnomeManager && effectiveHotkey) {
          const gnomeHotkey = GnomeShortcutManager.convertToGnomeFormat(effectiveHotkey);
          debugLogger.log(
            `[IPC] Re-registering GNOME keybinding "${gnomeHotkey}" after capture mode`
          );
          const success = await hotkeyManager.gnomeManager.registerKeybinding(gnomeHotkey);
          if (success) {
            hotkeyManager.currentHotkey = effectiveHotkey;
          }
        }
      }

      return { success: true };
    });

    ipcMain.handle("get-hotkey-mode-info", async () => {
      return {
        isUsingGnome: this.windowManager.isUsingGnomeHotkeys(),
      };
    });

    ipcMain.handle("start-window-drag", async (event) => {
      return await this.windowManager.startWindowDrag();
    });

    ipcMain.handle("stop-window-drag", async (event) => {
      return await this.windowManager.stopWindowDrag();
    });

    ipcMain.handle("open-external", async (event, url) => {
      try {
        await shell.openExternal(url);
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("get-auto-start-enabled", async () => {
      try {
        const loginSettings = app.getLoginItemSettings();
        return loginSettings.openAtLogin;
      } catch (error) {
        debugLogger.error("Error getting auto-start status:", error);
        return false;
      }
    });

    ipcMain.handle("set-auto-start-enabled", async (event, enabled) => {
      try {
        app.setLoginItemSettings({
          openAtLogin: enabled,
          openAsHidden: true, // Start minimized to tray
        });
        debugLogger.debug("Auto-start setting updated", { enabled });
        return { success: true };
      } catch (error) {
        debugLogger.error("Error setting auto-start:", error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("model-get-all", async () => {
      try {
        debugLogger.debug("model-get-all called", undefined, "ipc");
        const modelManager = require("./modelManagerBridge").default;
        const models = await modelManager.getModelsWithStatus();
        debugLogger.debug("Returning models", { count: models.length }, "ipc");
        return models;
      } catch (error) {
        debugLogger.error("Error in model-get-all:", error);
        throw error;
      }
    });

    ipcMain.handle("model-check", async (_, modelId) => {
      const modelManager = require("./modelManagerBridge").default;
      return modelManager.isModelDownloaded(modelId);
    });

    ipcMain.handle("model-download", async (event, modelId) => {
      try {
        const modelManager = require("./modelManagerBridge").default;
        const result = await modelManager.downloadModel(
          modelId,
          (progress, downloadedSize, totalSize) => {
            if (!event.sender.isDestroyed()) {
              event.sender.send("model-download-progress", {
                modelId,
                progress,
                downloadedSize,
                totalSize,
              });
            }
          }
        );
        return { success: true, path: result };
      } catch (error) {
        return {
          success: false,
          error: error.message,
          code: error.code,
          details: error.details,
        };
      }
    });

    ipcMain.handle("model-delete", async (event, modelId) => {
      try {
        const modelManager = require("./modelManagerBridge").default;
        await modelManager.deleteModel(modelId);
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error.message,
          code: error.code,
          details: error.details,
        };
      }
    });

    ipcMain.handle("model-delete-all", async () => {
      try {
        const modelManager = require("./modelManagerBridge").default;
        await modelManager.deleteAllModels();
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error.message,
          code: error.code,
          details: error.details,
        };
      }
    });

    ipcMain.handle("model-cancel-download", async (event, modelId) => {
      try {
        const modelManager = require("./modelManagerBridge").default;
        const cancelled = modelManager.cancelDownload(modelId);
        return { success: cancelled };
      } catch (error) {
        return {
          success: false,
          error: error.message,
        };
      }
    });

    ipcMain.handle("model-check-runtime", async (event) => {
      try {
        const modelManager = require("./modelManagerBridge").default;
        await modelManager.ensureLlamaCpp();
        return { available: true };
      } catch (error) {
        return {
          available: false,
          error: error.message,
          code: error.code,
          details: error.details,
        };
      }
    });

    ipcMain.handle("get-anthropic-key", async (event) => {
      return this.environmentManager.getAnthropicKey();
    });

    ipcMain.handle("get-gemini-key", async (event) => {
      return this.environmentManager.getGeminiKey();
    });

    ipcMain.handle("save-gemini-key", async (event, key) => {
      return this.environmentManager.saveGeminiKey(key);
    });

    ipcMain.handle("get-groq-key", async (event) => {
      return this.environmentManager.getGroqKey();
    });

    ipcMain.handle("save-groq-key", async (event, key) => {
      return this.environmentManager.saveGroqKey(key);
    });

    ipcMain.handle("get-mistral-key", async () => {
      return this.environmentManager.getMistralKey();
    });

    ipcMain.handle("save-mistral-key", async (event, key) => {
      return this.environmentManager.saveMistralKey(key);
    });

    ipcMain.handle("get-soniox-key", async () => {
      return this.environmentManager.getSonioxKey();
    });

    ipcMain.handle("save-soniox-key", async (event, key) => {
      return this.environmentManager.saveSonioxKey(key);
    });

    ipcMain.handle(
      "proxy-mistral-transcription",
      async (event, { audioBuffer, model, language, contextBias }) => {
        const apiKey = this.environmentManager.getMistralKey();
        if (!apiKey) {
          throw new Error("Mistral API key not configured");
        }

        const formData = new FormData();
        const audioBlob = new Blob([Buffer.from(audioBuffer)], { type: "audio/webm" });
        formData.append("file", audioBlob, "audio.webm");
        formData.append("model", model || "voxtral-mini-latest");
        if (language && language !== "auto") {
          formData.append("language", language);
        }
        if (contextBias && contextBias.length > 0) {
          for (const token of contextBias) {
            formData.append("context_bias", token);
          }
        }

        const response = await fetch(MISTRAL_TRANSCRIPTION_URL, {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
          },
          body: formData,
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Mistral API Error: ${response.status} ${errorText}`);
        }

        return await response.json();
      }
    );

    ipcMain.handle(
      "proxy-soniox-transcription",
      async (
        event,
        {
          audioBuffer,
          mimeType = "audio/webm",
          fileName = "audio.webm",
          model,
          language,
          contextBias,
        }
      ) => {
        const apiKey = this.environmentManager.getSonioxKey();
        if (!apiKey) {
          throw new Error("Soniox API key not configured");
        }

        const headers = {
          Authorization: `Bearer ${apiKey}`,
        };

        let uploadedFileId = null;
        let transcriptionId = null;

        const deleteSonioxResource = async (url) => {
          if (!url) return;
          try {
            await fetch(url, {
              method: "DELETE",
              headers,
            });
          } catch {
            // Best effort cleanup only.
          }
        };

        try {
          const uploadForm = new FormData();
          const audioBlob = new Blob([Buffer.from(audioBuffer)], { type: mimeType });
          uploadForm.append("file", audioBlob, fileName);

          const uploadResponse = await fetch(SONIOX_FILES_URL, {
            method: "POST",
            headers,
            body: uploadForm,
          });
          const uploadData = await readSonioxResponse(uploadResponse);
          uploadedFileId = uploadData?.id || null;
          if (!uploadedFileId) {
            throw new Error("Soniox file upload did not return a file id");
          }

          const transcriptionPayload = {
            ...buildSonioxAsyncPayload({
              model,
              language,
              keyterms: contextBias,
            }),
            file_id: uploadedFileId,
          };

          const createResponse = await fetch(SONIOX_TRANSCRIPTIONS_URL, {
            method: "POST",
            headers: {
              ...headers,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(transcriptionPayload),
          });
          const createdTranscription = await readSonioxResponse(createResponse);
          transcriptionId = createdTranscription?.id || null;
          if (!transcriptionId) {
            throw new Error("Soniox transcription request did not return an id");
          }

          const deadline = Date.now() + SONIOX_ASYNC_TIMEOUT_MS;
          let transcription = createdTranscription;

          while (Date.now() < deadline) {
            if (transcription?.status === "completed") {
              break;
            }

            if (transcription?.status === "error") {
              throw new Error(transcription?.error_message || "Soniox transcription failed");
            }

            await sleep(SONIOX_ASYNC_POLL_INTERVAL_MS);
            const statusResponse = await fetch(`${SONIOX_TRANSCRIPTIONS_URL}/${transcriptionId}`, {
              headers,
            });
            transcription = await readSonioxResponse(statusResponse);
          }

          if (transcription?.status !== "completed") {
            throw new Error("Soniox transcription timed out");
          }

          const transcriptResponse = await fetch(
            `${SONIOX_TRANSCRIPTIONS_URL}/${transcriptionId}/transcript`,
            { headers }
          );
          const transcript = await readSonioxResponse(transcriptResponse);

          return {
            text: transcript?.text || "",
            tokens: Array.isArray(transcript?.tokens) ? transcript.tokens : [],
            model: transcriptionPayload.model,
          };
        } finally {
          if (transcriptionId) {
            await deleteSonioxResource(`${SONIOX_TRANSCRIPTIONS_URL}/${transcriptionId}`);
          }
          if (uploadedFileId) {
            await deleteSonioxResource(`${SONIOX_FILES_URL}/${uploadedFileId}`);
          }
        }
      }
    );

    ipcMain.handle("get-custom-transcription-key", async () => {
      return this.environmentManager.getCustomTranscriptionKey();
    });

    ipcMain.handle("save-custom-transcription-key", async (event, key) => {
      return this.environmentManager.saveCustomTranscriptionKey(key);
    });

    ipcMain.handle("get-bailian-key", async () => {
      return this.environmentManager.getBailianKey();
    });

    ipcMain.handle("save-bailian-key", async (event, key) => {
      return this.environmentManager.saveBailianKey(key);
    });

    ipcMain.handle("get-custom-reasoning-key", async () => {
      return this.environmentManager.getCustomReasoningKey();
    });

    ipcMain.handle("save-custom-reasoning-key", async (event, key) => {
      return this.environmentManager.saveCustomReasoningKey(key);
    });

    ipcMain.handle("get-dictation-key", async () => {
      return this.environmentManager.getDictationKey();
    });

    ipcMain.handle("save-dictation-key", async (event, key) => {
      return this.environmentManager.saveDictationKey(key);
    });

    ipcMain.handle("save-anthropic-key", async (event, key) => {
      return this.environmentManager.saveAnthropicKey(key);
    });

    ipcMain.handle("get-deepgram-key", async () => {
      return this.environmentManager.getDeepgramKey();
    });

    ipcMain.handle("save-deepgram-key", async (event, key) => {
      return this.environmentManager.saveDeepgramKey(key);
    });

    ipcMain.handle("get-ui-language", async () => {
      return this.environmentManager.getUiLanguage();
    });

    ipcMain.handle("save-ui-language", async (event, language) => {
      return this.environmentManager.saveUiLanguage(language);
    });

    ipcMain.handle("set-ui-language", async (event, language) => {
      const result = this.environmentManager.saveUiLanguage(language);
      process.env.UI_LANGUAGE = result.language;
      changeLanguage(result.language);
      this.windowManager?.refreshLocalizedUi?.();
      this.getTrayManager?.()?.updateTrayMenu?.();
      return { success: true, language: result.language };
    });

    ipcMain.handle("save-all-keys-to-env", async () => {
      return this.environmentManager.saveAllKeysToEnvFile();
    });

    ipcMain.handle("sync-startup-preferences", async (event, prefs) => {
      const setVars = {};
      const clearVars = [];

      if (prefs.useLocalWhisper && prefs.model) {
        // Local mode with model selected - set provider and model for pre-warming
        setVars.LOCAL_TRANSCRIPTION_PROVIDER = prefs.localTranscriptionProvider;
        if (prefs.localTranscriptionProvider === "nvidia") {
          setVars.PARAKEET_MODEL = prefs.model;
          clearVars.push("LOCAL_WHISPER_MODEL");
          this.whisperManager.stopServer().catch((err) => {
            debugLogger.error("Failed to stop whisper-server on provider switch", {
              error: err.message,
            });
          });
        } else {
          setVars.LOCAL_WHISPER_MODEL = prefs.model;
          clearVars.push("PARAKEET_MODEL");
          this.parakeetManager.stopServer().catch((err) => {
            debugLogger.error("Failed to stop parakeet-server on provider switch", {
              error: err.message,
            });
          });
        }
      } else if (prefs.useLocalWhisper) {
        // Local mode enabled but no model selected - clear pre-warming vars
        clearVars.push("LOCAL_TRANSCRIPTION_PROVIDER", "PARAKEET_MODEL", "LOCAL_WHISPER_MODEL");
      } else {
        // Cloud mode - stop local servers to free RAM
        clearVars.push("LOCAL_TRANSCRIPTION_PROVIDER", "PARAKEET_MODEL", "LOCAL_WHISPER_MODEL");
        this.whisperManager.stopServer().catch((err) => {
          debugLogger.error("Failed to stop whisper-server on cloud switch", {
            error: err.message,
          });
        });
        this.parakeetManager.stopServer().catch((err) => {
          debugLogger.error("Failed to stop parakeet-server on cloud switch", {
            error: err.message,
          });
        });
      }

      if (prefs.reasoningProvider === "local" && prefs.reasoningModel) {
        setVars.REASONING_PROVIDER = "local";
        setVars.LOCAL_REASONING_MODEL = prefs.reasoningModel;
      } else if (prefs.reasoningProvider && prefs.reasoningProvider !== "local") {
        clearVars.push("REASONING_PROVIDER", "LOCAL_REASONING_MODEL");
        const modelManager = require("./modelManagerBridge").default;
        modelManager.stopServer().catch((err) => {
          debugLogger.error("Failed to stop llama-server on provider switch", {
            error: err.message,
          });
        });
      }

      this._syncStartupEnv(setVars, clearVars);
    });

    ipcMain.handle("process-local-reasoning", async (event, text, modelId, _agentName, config) => {
      try {
        const LocalReasoningService = require("../services/localReasoningBridge").default;
        const result = await LocalReasoningService.processText(text, modelId, config);
        return { success: true, text: result };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("process-cloud-reasoning-request", async (event, request = {}) => {
      const endpoint = typeof request.endpoint === "string" ? request.endpoint.trim() : "";
      if (!endpoint) {
        throw new Error("Cloud reasoning request endpoint is required");
      }

      return performProxyHttpRequest({
        endpoint,
        method: typeof request.method === "string" ? request.method.toUpperCase() : "POST",
        headers:
          request.headers && typeof request.headers === "object" ? request.headers : undefined,
        body: request.body,
        timeoutMs:
          typeof request.timeoutMs === "number" && request.timeoutMs > 0
            ? request.timeoutMs
            : 30000,
      });
    });

    ipcMain.handle(
      "process-anthropic-reasoning",
      async (event, text, modelId, _agentName, config) => {
        try {
          const apiKey = this.environmentManager.getAnthropicKey();

          if (!apiKey) {
            throw new Error("Anthropic API key not configured");
          }

          const systemPrompt = config?.systemPrompt || "";
          const userPrompt = text;

          if (!modelId) {
            throw new Error("No model specified for Anthropic API call");
          }

          const requestBody = {
            model: modelId,
            messages: [{ role: "user", content: userPrompt }],
            system: systemPrompt,
            max_tokens: config?.maxTokens || Math.max(100, Math.min(text.length * 2, 4096)),
            temperature: config?.temperature || 0.3,
          };

          const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-API-Key": apiKey,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify(requestBody),
          });

          if (!response.ok) {
            const errorText = await response.text();
            let errorData = { error: response.statusText };
            try {
              errorData = JSON.parse(errorText);
            } catch {
              errorData = { error: errorText || response.statusText };
            }
            throw new Error(
              errorData.error?.message ||
                errorData.error ||
                `Anthropic API error: ${response.status}`
            );
          }

          const data = await response.json();
          return { success: true, text: data.content[0].text.trim() };
        } catch (error) {
          debugLogger.error("Anthropic reasoning error:", error);
          return { success: false, error: error.message };
        }
      }
    );

    ipcMain.handle("check-local-reasoning-available", async () => {
      try {
        const LocalReasoningService = require("../services/localReasoningBridge").default;
        return await LocalReasoningService.isAvailable();
      } catch (error) {
        return false;
      }
    });

    ipcMain.handle("llama-cpp-check", async () => {
      try {
        const llamaCppInstaller = require("./llamaCppInstaller").default;
        const isInstalled = await llamaCppInstaller.isInstalled();
        const version = isInstalled ? await llamaCppInstaller.getVersion() : null;
        return { isInstalled, version };
      } catch (error) {
        return { isInstalled: false, error: error.message };
      }
    });

    ipcMain.handle("llama-cpp-install", async () => {
      try {
        const llamaCppInstaller = require("./llamaCppInstaller").default;
        const result = await llamaCppInstaller.install();
        return result;
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("llama-cpp-uninstall", async () => {
      try {
        const llamaCppInstaller = require("./llamaCppInstaller").default;
        const result = await llamaCppInstaller.uninstall();
        return result;
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("llama-server-start", async (event, modelId) => {
      try {
        const modelManager = require("./modelManagerBridge").default;
        const modelInfo = modelManager.findModelById(modelId);
        if (!modelInfo) {
          return { success: false, error: `Model "${modelId}" not found` };
        }

        const modelPath = require("path").join(modelManager.modelsDir, modelInfo.model.fileName);

        await modelManager.serverManager.start(modelPath, {
          contextSize: modelInfo.model.contextLength || 4096,
          threads: 4,
          gpuLayers: 99,
        });
        modelManager.currentServerModelId = modelId;

        this.environmentManager.saveAllKeysToEnvFile().catch(() => {});
        return { success: true, port: modelManager.serverManager.port };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("llama-server-stop", async () => {
      try {
        const modelManager = require("./modelManagerBridge").default;
        await modelManager.stopServer();
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("llama-server-status", async () => {
      try {
        const modelManager = require("./modelManagerBridge").default;
        return modelManager.getServerStatus();
      } catch (error) {
        return { available: false, running: false, error: error.message };
      }
    });

    ipcMain.handle("llama-gpu-reset", async () => {
      try {
        const modelManager = require("./modelManagerBridge").default;
        const previousModelId = modelManager.currentServerModelId;
        modelManager.serverManager.resetGpuDetection();
        await modelManager.stopServer();

        // Restart server with previous model so Vulkan binary is picked up
        if (previousModelId) {
          modelManager.prewarmServer(previousModelId).catch(() => {});
        }

        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("detect-vulkan-gpu", async () => {
      try {
        const { detectVulkanGpu } = require("../utils/vulkanDetection");
        return await detectVulkanGpu();
      } catch (error) {
        return { available: false, error: error.message };
      }
    });

    ipcMain.handle("get-llama-vulkan-status", async () => {
      try {
        if (!this._llamaVulkanManager) {
          const LlamaVulkanManager = require("./llamaVulkanManager");
          this._llamaVulkanManager = new LlamaVulkanManager();
        }
        return this._llamaVulkanManager.getStatus();
      } catch (error) {
        return { supported: false, downloaded: false, error: error.message };
      }
    });

    ipcMain.handle("download-llama-vulkan-binary", async (event) => {
      try {
        if (!this._llamaVulkanManager) {
          const LlamaVulkanManager = require("./llamaVulkanManager");
          this._llamaVulkanManager = new LlamaVulkanManager();
        }

        const result = await this._llamaVulkanManager.download((downloaded, total) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send("llama-vulkan-download-progress", {
              downloaded,
              total,
              percentage: total > 0 ? Math.round((downloaded / total) * 100) : 0,
            });
          }
        });

        if (result.success) {
          process.env.LLAMA_VULKAN_ENABLED = "true";
          delete process.env.LLAMA_GPU_BACKEND;
          const modelManager = require("./modelManagerBridge").default;
          modelManager.serverManager.cachedServerBinaryPaths = null;
          this.environmentManager.saveAllKeysToEnvFile().catch(() => {});
        }

        return result;
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("cancel-llama-vulkan-download", async () => {
      if (this._llamaVulkanManager) {
        return { success: this._llamaVulkanManager.cancelDownload() };
      }
      return { success: false };
    });

    ipcMain.handle("delete-llama-vulkan-binary", async () => {
      try {
        if (!this._llamaVulkanManager) {
          const LlamaVulkanManager = require("./llamaVulkanManager");
          this._llamaVulkanManager = new LlamaVulkanManager();
        }

        const modelManager = require("./modelManagerBridge").default;
        if (modelManager.serverManager.activeBackend === "vulkan") {
          await modelManager.stopServer();
        }

        const result = await this._llamaVulkanManager.deleteBinary();

        delete process.env.LLAMA_VULKAN_ENABLED;
        delete process.env.LLAMA_GPU_BACKEND;
        modelManager.serverManager.cachedServerBinaryPaths = null;
        this.environmentManager.saveAllKeysToEnvFile().catch(() => {});

        return result;
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("get-log-level", async () => {
      return debugLogger.getLevel();
    });

    ipcMain.handle("app-log", async (event, entry) => {
      debugLogger.logEntry(entry);
      return { success: true };
    });

    const SYSTEM_SETTINGS_URLS = {
      darwin: {
        microphone: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
        sound: "x-apple.systempreferences:com.apple.preference.sound?input",
        accessibility:
          "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
      },
      win32: {
        microphone: "ms-settings:privacy-microphone",
        sound: "ms-settings:sound",
      },
    };

    const openSystemSettings = async (settingType) => {
      const platform = process.platform;
      const urls = SYSTEM_SETTINGS_URLS[platform];
      const url = urls?.[settingType];

      if (!url) {
        // Platform doesn't support this settings URL
        const messages = {
          microphone: i18nMain.t("systemSettings.microphone"),
          sound: i18nMain.t("systemSettings.sound"),
          accessibility: i18nMain.t("systemSettings.accessibility"),
        };
        return {
          success: false,
          error:
            messages[settingType] || `${settingType} settings are not available on this platform.`,
        };
      }

      try {
        await shell.openExternal(url);
        return { success: true };
      } catch (error) {
        debugLogger.error(`Failed to open ${settingType} settings:`, error);
        return { success: false, error: error.message };
      }
    };

    ipcMain.handle("open-microphone-settings", () => openSystemSettings("microphone"));
    ipcMain.handle("open-sound-input-settings", () => openSystemSettings("sound"));
    ipcMain.handle("open-accessibility-settings", () => openSystemSettings("accessibility"));

    ipcMain.handle("request-microphone-access", async () => {
      if (process.platform !== "darwin") {
        return { granted: true };
      }
      const { systemPreferences } = require("electron");
      const granted = await systemPreferences.askForMediaAccess("microphone");
      return { granted };
    });

    // Auth: clear all session cookies for sign-out.
    // This clears every cookie in the renderer session rather than targeting
    // individual auth cookies, which is acceptable because the app only sets
    // cookies for Neon Auth. Avoids CSRF/Origin header issues that occur when
    // the renderer tries to call the server-side sign-out endpoint directly.
    ipcMain.handle("auth-clear-session", async (event) => {
      try {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win) {
          await win.webContents.session.clearStorageData({ storages: ["cookies"] });
        }
        return { success: true };
      } catch (error) {
        debugLogger.error("Failed to clear auth session:", error);
        return { success: false, error: error.message };
      }
    });

    // In production, VITE_* env vars aren't available in the main process because
    // Vite only inlines them into the renderer bundle at build time. Load the
    // runtime-env.json that the Vite build writes to src/dist/ as a fallback.
    const runtimeEnv = (() => {
      const fs = require("fs");
      const envPath = path.join(__dirname, "..", "dist", "runtime-env.json");
      try {
        if (fs.existsSync(envPath)) return JSON.parse(fs.readFileSync(envPath, "utf8"));
      } catch {}
      return {};
    })();

    const getOauthProtocol = () =>
      process.env.MOUTHPIECE_PROTOCOL ||
      process.env.VITE_MOUTHPIECE_PROTOCOL ||
      process.env.OPENWHISPR_PROTOCOL ||
      process.env.VITE_OPENWHISPR_PROTOCOL ||
      runtimeEnv.VITE_MOUTHPIECE_PROTOCOL ||
      runtimeEnv.VITE_OPENWHISPR_PROTOCOL ||
      "";

    const getApiUrl = () =>
      process.env.MOUTHPIECE_API_URL ||
      process.env.VITE_MOUTHPIECE_API_URL ||
      process.env.OPENWHISPR_API_URL ||
      process.env.VITE_OPENWHISPR_API_URL ||
      runtimeEnv.VITE_MOUTHPIECE_API_URL ||
      runtimeEnv.VITE_OPENWHISPR_API_URL ||
      "";

    const getAuthUrl = () =>
      process.env.NEON_AUTH_URL ||
      process.env.VITE_NEON_AUTH_URL ||
      runtimeEnv.VITE_NEON_AUTH_URL ||
      "";

    const getAuthBridgeUrl = () => {
      const configured =
        process.env.MOUTHPIECE_AUTH_BRIDGE_URL ||
        process.env.VITE_MOUTHPIECE_AUTH_BRIDGE_URL ||
        process.env.OPENWHISPR_AUTH_BRIDGE_URL ||
        process.env.VITE_OPENWHISPR_AUTH_BRIDGE_URL ||
        runtimeEnv.VITE_MOUTHPIECE_AUTH_BRIDGE_URL ||
        runtimeEnv.VITE_OPENWHISPR_AUTH_BRIDGE_URL ||
        "";

      if (configured) {
        return configured;
      }

      const rawPort = (
        process.env.MOUTHPIECE_AUTH_BRIDGE_PORT ||
        process.env.OPENWHISPR_AUTH_BRIDGE_PORT ||
        ""
      ).trim();
      const parsedPort = Number(rawPort);
      const port =
        Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65535 ? parsedPort : 5199;

      return `http://127.0.0.1:${port}/oauth/callback`;
    };

    const getOAuthCallbackUrl = () =>
      process.env.MOUTHPIECE_OAUTH_CALLBACK_URL ||
      process.env.VITE_MOUTHPIECE_OAUTH_CALLBACK_URL ||
      process.env.OPENWHISPR_OAUTH_CALLBACK_URL ||
      process.env.VITE_OPENWHISPR_OAUTH_CALLBACK_URL ||
      runtimeEnv.VITE_MOUTHPIECE_OAUTH_CALLBACK_URL ||
      runtimeEnv.VITE_OPENWHISPR_OAUTH_CALLBACK_URL ||
      "";

    const buildRuntimeConfig = () => ({
      apiUrl: getApiUrl(),
      authUrl: getAuthUrl(),
      enableMouthpieceCloud:
        String(
          process.env.VITE_ENABLE_MOUTHPIECE_CLOUD ||
            process.env.OPENWHISPR_ENABLE_MOUTHPIECE_CLOUD ||
            ""
        )
          .trim()
          .toLowerCase() === "true",
      oauthProtocol: getOauthProtocol(),
      oauthAuthBridgeUrl: getAuthBridgeUrl(),
      oauthCallbackUrl: getOAuthCallbackUrl(),
    });

    ipcMain.on("get-runtime-config-sync", (event) => {
      event.returnValue = buildRuntimeConfig();
    });

    ipcMain.handle("get-runtime-config", async () => buildRuntimeConfig());

    const getSessionCookiesFromWindow = async (win) => {
      const scopedUrls = [getAuthUrl(), getApiUrl()].filter(Boolean);
      const cookiesByName = new Map();

      for (const url of scopedUrls) {
        try {
          const scopedCookies = await win.webContents.session.cookies.get({ url });
          for (const cookie of scopedCookies) {
            if (!cookiesByName.has(cookie.name)) {
              cookiesByName.set(cookie.name, cookie.value);
            }
          }
        } catch (error) {
          debugLogger.warn("Failed to read scoped auth cookies", {
            url,
            error: error.message,
          });
        }
      }

      // Fallback for older sessions where cookies are not URL-scoped as expected.
      if (cookiesByName.size === 0) {
        const allCookies = await win.webContents.session.cookies.get({});
        for (const cookie of allCookies) {
          if (!cookiesByName.has(cookie.name)) {
            cookiesByName.set(cookie.name, cookie.value);
          }
        }
      }

      const cookieHeader = [...cookiesByName.entries()]
        .map(([name, value]) => `${name}=${value}`)
        .join("; ");

      debugLogger.debug(
        "Resolved auth cookies for cloud request",
        {
          cookieCount: cookiesByName.size,
          scopedUrls,
        },
        "auth"
      );

      return cookieHeader;
    };

    const getSessionCookies = async (event) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return "";
      return getSessionCookiesFromWindow(win);
    };

    ipcMain.handle("proxy-runtime-api-request", async (event, request = {}) => {
      const target = typeof request.target === "string" ? request.target : "api";
      const endpoint =
        target === "auth"
          ? getAuthUrl()
          : target === "api"
            ? getApiUrl()
            : typeof request.endpoint === "string"
              ? request.endpoint.trim()
              : "";

      if (!endpoint) {
        throw new Error(
          target === "auth"
            ? "Auth URL not configured"
            : target === "api"
              ? "Mouthpiece API URL not configured"
              : "Proxy endpoint is required"
        );
      }

      const url = new URL(endpoint);
      if (typeof request.path === "string" && request.path.trim()) {
        const normalizedPath = request.path.startsWith("/") ? request.path : `/${request.path}`;
        url.pathname = normalizedPath;
      }

      const query =
        request.query && typeof request.query === "object" ? Object.entries(request.query) : [];
      for (const [key, value] of query) {
        if (value === undefined || value === null) continue;
        url.searchParams.set(key, String(value));
      }

      const headers =
        request.headers && typeof request.headers === "object" ? { ...request.headers } : {};

      if (request.includeCookies) {
        const cookieHeader = await getSessionCookies(event);
        if (!cookieHeader) {
          throw new Error("No session cookies available");
        }
        headers.Cookie = cookieHeader;
      }

      return performProxyHttpRequest({
        endpoint: url.toString(),
        method: typeof request.method === "string" ? request.method.toUpperCase() : "GET",
        headers,
        body: request.body,
        timeoutMs:
          typeof request.timeoutMs === "number" && request.timeoutMs > 0
            ? request.timeoutMs
            : 30000,
      });
    });

    ipcMain.handle("cloud-transcribe", async (event, audioBuffer, opts = {}) => {
      try {
        const apiUrl = getApiUrl();
        if (!apiUrl) throw new Error("Mouthpiece API URL not configured");

        const cookieHeader = await getSessionCookies(event);
        if (!cookieHeader) throw new Error("No session cookies available");

        const audioData = Buffer.from(audioBuffer);
        const { body, boundary } = buildMultipartBody(audioData, "audio.webm", "audio/webm", {
          language: opts.language,
          prompt: opts.prompt,
          sendLogs: opts.sendLogs,
          clientType: "desktop",
          appVersion: app.getVersion(),
          clientVersion: app.getVersion(),
          sessionId: this.sessionId,
        });

        debugLogger.debug(
          "Cloud transcribe request",
          { audioSize: audioData.length, bodySize: body.length },
          "cloud-api"
        );

        const url = new URL(`${apiUrl}/api/transcribe`);
        const data = await postMultipart(url, body, boundary, { Cookie: cookieHeader });

        debugLogger.debug(
          "Cloud transcribe response",
          { statusCode: data.statusCode },
          "cloud-api"
        );

        if (data.statusCode === 401) {
          return { success: false, error: "Session expired", code: "AUTH_EXPIRED" };
        }
        if (data.statusCode === 429) {
          return {
            success: false,
            error: "Daily word limit reached",
            code: "LIMIT_REACHED",
          };
        }
        if (data.statusCode !== 200) {
          throw new Error(data.data?.error || `API error: ${data.statusCode}`);
        }

        return {
          success: true,
          text: data.data.text,
          sttProvider: data.data.sttProvider,
          sttModel: data.data.sttModel,
          sttProcessingMs: data.data.sttProcessingMs,
          sttWordCount: data.data.sttWordCount,
          sttLanguage: data.data.sttLanguage,
          audioDurationMs: data.data.audioDurationMs,
        };
      } catch (error) {
        debugLogger.error("Cloud transcription error", { error: error.message }, "cloud-api");
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("cloud-reason", async (event, text, opts = {}) => {
      try {
        const apiUrl = getApiUrl();
        if (!apiUrl) throw new Error("Mouthpiece API URL not configured");

        const cookieHeader = await getSessionCookies(event);
        if (!cookieHeader) throw new Error("No session cookies available");

        debugLogger.debug(
          "Cloud reason request",
          {
            model: opts.model || "(default)",
            agentName: opts.agentName || "(none)",
            textLength: text?.length || 0,
          },
          "cloud-api"
        );

        const response = await fetch(`${apiUrl}/api/reason`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: cookieHeader,
          },
          body: JSON.stringify({
            text,
            model: opts.model,
            agentName: opts.agentName,
            customDictionary: opts.customDictionary,
            customPrompt: opts.customPrompt,
            systemPrompt: opts.systemPrompt,
            language: opts.language,
            locale: opts.locale,
            sessionId: this.sessionId,
            clientType: "desktop",
            appVersion: app.getVersion(),
            clientVersion: app.getVersion(),
            sttProvider: opts.sttProvider,
            sttModel: opts.sttModel,
            sttProcessingMs: opts.sttProcessingMs,
            sttWordCount: opts.sttWordCount,
            sttLanguage: opts.sttLanguage,
            audioDurationMs: opts.audioDurationMs,
            audioSizeBytes: opts.audioSizeBytes,
            audioFormat: opts.audioFormat,
            clientTotalMs: opts.clientTotalMs,
          }),
        });

        if (!response.ok) {
          if (response.status === 401) {
            return { success: false, error: "Session expired", code: "AUTH_EXPIRED" };
          }
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `API error: ${response.status}`);
        }

        const data = await response.json();
        debugLogger.debug(
          "Cloud reason response",
          {
            model: data.model,
            provider: data.provider,
            resultLength: data.text?.length || 0,
          },
          "cloud-api"
        );
        return { success: true, text: data.text, model: data.model, provider: data.provider };
      } catch (error) {
        debugLogger.error("Cloud reasoning error:", error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle(
      "cloud-streaming-usage",
      async (event, text, audioDurationSeconds, opts = {}) => {
        try {
          const apiUrl = getApiUrl();
          if (!apiUrl) throw new Error("Mouthpiece API URL not configured");

          const cookieHeader = await getSessionCookies(event);
          if (!cookieHeader) throw new Error("No session cookies available");

          const response = await fetch(`${apiUrl}/api/streaming-usage`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Cookie: cookieHeader,
            },
            body: JSON.stringify({
              text,
              audioDurationSeconds,
              sessionId: this.sessionId,
              clientType: "desktop",
              appVersion: app.getVersion(),
              clientVersion: app.getVersion(),
              sttProvider: opts.sttProvider,
              sttModel: opts.sttModel,
              sttProcessingMs: opts.sttProcessingMs,
              sttLanguage: opts.sttLanguage,
              audioSizeBytes: opts.audioSizeBytes,
              audioFormat: opts.audioFormat,
              clientTotalMs: opts.clientTotalMs,
              sendLogs: opts.sendLogs,
            }),
          });

          if (response.status === 401) {
            return { success: false, error: "Session expired", code: "AUTH_EXPIRED" };
          }
          if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
          }

          const data = await response.json();
          return { success: true, ...data };
        } catch (error) {
          debugLogger.error("Cloud streaming usage error", { error: error.message }, "cloud-api");
          return { success: false, error: error.message };
        }
      }
    );

    ipcMain.handle("get-stt-config", async (event) => {
      const apiUrl = getApiUrl();
      if (!apiUrl) {
        return null;
      }

      try {
        const cookieHeader = await getSessionCookies(event);
        if (!cookieHeader) {
          return null;
        }

        const response = await fetch(`${apiUrl}/api/stt-config`, {
          headers: { Cookie: cookieHeader },
        });

        if (response.status === 401) {
          return null;
        }

        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();
        const { notes: _notes, ...sttConfig } = data || {};
        return { success: true, ...sttConfig };
      } catch (error) {
        debugLogger.error("STT config fetch error:", error);
        return null;
      }
    });

    ipcMain.handle("get-referral-stats", async (event) => {
      try {
        const apiUrl = getApiUrl();
        if (!apiUrl) {
          throw new Error("Mouthpiece API URL not configured");
        }

        const cookieHeader = await getSessionCookies(event);
        if (!cookieHeader) {
          throw new Error("No session cookies available");
        }

        const response = await fetch(`${apiUrl}/api/referrals/stats`, {
          headers: {
            Cookie: cookieHeader,
          },
        });

        if (!response.ok) {
          if (response.status === 401) {
            throw new Error("Unauthorized - please sign in");
          }
          throw new Error(`Failed to fetch referral stats: ${response.status}`);
        }

        const data = await response.json();
        return data;
      } catch (error) {
        debugLogger.error("Error fetching referral stats:", error);
        throw error;
      }
    });

    ipcMain.handle("send-referral-invite", async (event, email) => {
      try {
        const apiUrl = getApiUrl();
        if (!apiUrl) {
          throw new Error("Mouthpiece API URL not configured");
        }

        const cookieHeader = await getSessionCookies(event);
        if (!cookieHeader) {
          throw new Error("No session cookies available");
        }

        const response = await fetch(`${apiUrl}/api/referrals/invite`, {
          method: "POST",
          headers: {
            Cookie: cookieHeader,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ email }),
        });

        if (!response.ok) {
          let errorMessage = `Failed to send invite: ${response.status}`;
          try {
            const errorData = await response.json();
            if (errorData.error) errorMessage = errorData.error;
          } catch (_) {}
          throw new Error(errorMessage);
        }

        const data = await response.json();
        return data;
      } catch (error) {
        debugLogger.error("Error sending referral invite:", error);
        throw error;
      }
    });

    ipcMain.handle("get-referral-invites", async (event) => {
      try {
        const apiUrl = getApiUrl();
        if (!apiUrl) {
          throw new Error("Mouthpiece API URL not configured");
        }

        const cookieHeader = await getSessionCookies(event);
        if (!cookieHeader) {
          throw new Error("No session cookies available");
        }

        const response = await fetch(`${apiUrl}/api/referrals/invites`, {
          headers: {
            Cookie: cookieHeader,
          },
        });

        if (!response.ok) {
          if (response.status === 401) {
            throw new Error("Unauthorized - please sign in");
          }
          throw new Error(`Failed to fetch referral invites: ${response.status}`);
        }

        const data = await response.json();
        return data;
      } catch (error) {
        debugLogger.error("Error fetching referral invites:", error);
        throw error;
      }
    });

    ipcMain.handle("open-whisper-models-folder", async () => {
      try {
        const modelsDir = this.whisperManager.getModelsDir();
        await shell.openPath(modelsDir);
        return { success: true };
      } catch (error) {
        debugLogger.error("Failed to open whisper models folder:", error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("get-debug-state", async () => {
      try {
        return {
          enabled: debugLogger.isEnabled(),
          logPath: debugLogger.getLogPath(),
          logLevel: debugLogger.getLevel(),
        };
      } catch (error) {
        debugLogger.error("Failed to get debug state:", error);
        return { enabled: false, logPath: null, logLevel: "info" };
      }
    });

    ipcMain.handle("set-debug-logging", async (event, enabled) => {
      try {
        const path = require("path");
        const fs = require("fs");
        const envPath = path.join(app.getPath("userData"), ".env");

        // Read current .env content
        let envContent = "";
        if (fs.existsSync(envPath)) {
          envContent = fs.readFileSync(envPath, "utf8");
        }

        // Parse lines - support both new and legacy variable names
        const lines = envContent.split("\n");
        const newLogLevelIndex = lines.findIndex((line) =>
          line.trim().startsWith("MOUTHPIECE_LOG_LEVEL=")
        );
        const legacyLogLevelIndex = lines.findIndex((line) =>
          line.trim().startsWith("OPENWHISPR_LOG_LEVEL=")
        );

        if (enabled) {
          // Set to debug - prefer new variable name
          if (newLogLevelIndex !== -1) {
            lines[newLogLevelIndex] = "MOUTHPIECE_LOG_LEVEL=debug";
          } else if (legacyLogLevelIndex !== -1) {
            lines[legacyLogLevelIndex] = "OPENWHISPR_LOG_LEVEL=debug";
          } else {
            // Add new line
            if (lines.length > 0 && lines[lines.length - 1] !== "") {
              lines.push("");
            }
            lines.push("# Debug logging setting");
            lines.push("MOUTHPIECE_LOG_LEVEL=debug");
          }
        } else {
          // Remove or set to info - prefer new variable name
          if (newLogLevelIndex !== -1) {
            lines[newLogLevelIndex] = "MOUTHPIECE_LOG_LEVEL=info";
          } else if (legacyLogLevelIndex !== -1) {
            lines[legacyLogLevelIndex] = "OPENWHISPR_LOG_LEVEL=info";
          }
        }

        // Write back
        fs.writeFileSync(envPath, lines.join("\n"), "utf8");

        // Update environment variable - prefer new variable name
        process.env.MOUTHPIECE_LOG_LEVEL = enabled ? "debug" : "info";
        process.env.OPENWHISPR_LOG_LEVEL = enabled ? "debug" : "info";

        // Refresh logger state
        debugLogger.refreshLogLevel();

        return {
          success: true,
          enabled: debugLogger.isEnabled(),
          logPath: debugLogger.getLogPath(),
        };
      } catch (error) {
        debugLogger.error("Failed to set debug logging:", error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("open-logs-folder", async () => {
      try {
        const logsDir = path.join(app.getPath("userData"), "logs");
        await shell.openPath(logsDir);
        return { success: true };
      } catch (error) {
        debugLogger.error("Failed to open logs folder:", error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("get-app-version", async () => {
      return { version: app.getVersion() };
    });

    ipcMain.handle("get-update-status", async () => {
      return (
        this.updateManager?.getStatus?.() || {
          status: "unsupported",
          supported: false,
          checkingEnabled: false,
          updateInfo: null,
          error: null,
          progressPercent: null,
        }
      );
    });

    ipcMain.handle("check-for-updates", async () => {
      if (!this.updateManager?.checkForUpdates) {
        return (
          this.updateManager?.getStatus?.() || {
            status: "unsupported",
            supported: false,
            checkingEnabled: false,
            updateInfo: null,
            error: null,
            progressPercent: null,
          }
        );
      }

      await this.updateManager.checkForUpdates();
      return this.updateManager.getStatus();
    });

    ipcMain.handle("install-update", async () => {
      if (!this.updateManager?.installUpdate) {
        return { success: false, error: "Updater is not available." };
      }
      return this.updateManager.installUpdate();
    });

    const fetchStreamingToken = async (event) => {
      const apiUrl = getApiUrl();
      if (!apiUrl) {
        throw new Error("Mouthpiece API URL not configured");
      }

      const cookieHeader = await getSessionCookies(event);
      if (!cookieHeader) {
        throw new Error("No session cookies available");
      }

      const tokenResponse = await fetch(`${apiUrl}/api/streaming-token`, {
        method: "POST",
        headers: {
          Cookie: cookieHeader,
        },
      });

      if (!tokenResponse.ok) {
        if (tokenResponse.status === 401) {
          const err = new Error("Session expired");
          err.code = "AUTH_EXPIRED";
          throw err;
        }
        const errorData = await tokenResponse.json().catch(() => ({}));
        throw new Error(
          errorData.error || `Failed to get streaming token: ${tokenResponse.status}`
        );
      }

      const { token } = await tokenResponse.json();
      if (!token) {
        throw new Error("No token received from API");
      }

      return token;
    };

    ipcMain.handle("assemblyai-streaming-warmup", async (event, options = {}) => {
      try {
        const apiUrl = getApiUrl();
        if (!apiUrl) {
          return { success: false, error: "API not configured", code: "NO_API" };
        }

        if (!this.assemblyAiStreaming) {
          this.assemblyAiStreaming = new AssemblyAiStreaming();
        }

        if (this.assemblyAiStreaming.hasWarmConnection()) {
          debugLogger.debug("AssemblyAI connection already warm", {}, "streaming");
          return { success: true, alreadyWarm: true };
        }

        let token = this.assemblyAiStreaming.getCachedToken();
        if (!token) {
          debugLogger.debug("Fetching new streaming token for warmup", {}, "streaming");
          token = await fetchStreamingToken(event);
        }

        await this.assemblyAiStreaming.warmup({ ...options, token });
        debugLogger.debug("AssemblyAI connection warmed up", {}, "streaming");

        return { success: true };
      } catch (error) {
        debugLogger.error("AssemblyAI warmup error", { error: error.message });
        if (error.code === "AUTH_EXPIRED") {
          return { success: false, error: "Session expired", code: "AUTH_EXPIRED" };
        }
        return { success: false, error: error.message };
      }
    });

    let streamingStartInProgress = false;

    ipcMain.handle("assemblyai-streaming-start", async (event, options = {}) => {
      if (streamingStartInProgress) {
        debugLogger.debug("Streaming start already in progress, ignoring", {}, "streaming");
        return { success: false, error: "Operation in progress", code: "START_IN_PROGRESS" };
      }

      streamingStartInProgress = true;
      try {
        const apiUrl = getApiUrl();
        if (!apiUrl) {
          return { success: false, error: "API not configured", code: "NO_API" };
        }

        const win = BrowserWindow.fromWebContents(event.sender);

        if (!this.assemblyAiStreaming) {
          this.assemblyAiStreaming = new AssemblyAiStreaming();
        }

        // Clean up any stale active connection (shouldn't happen normally)
        if (this.assemblyAiStreaming.isConnected) {
          debugLogger.debug(
            "AssemblyAI cleaning up stale connection before start",
            {},
            "streaming"
          );
          await this.assemblyAiStreaming.disconnect(false);
        }

        const hasWarm = this.assemblyAiStreaming.hasWarmConnection();
        debugLogger.debug(
          "AssemblyAI streaming start",
          { hasWarmConnection: hasWarm },
          "streaming"
        );

        let token = this.assemblyAiStreaming.getCachedToken();
        if (!token) {
          debugLogger.debug("Fetching streaming token from API", {}, "streaming");
          token = await fetchStreamingToken(event);
          this.assemblyAiStreaming.cacheToken(token);
        } else {
          debugLogger.debug("Using cached streaming token", {}, "streaming");
        }

        // Set up callbacks to forward events to renderer
        this.assemblyAiStreaming.onPartialTranscript = (text) => {
          if (win && !win.isDestroyed()) {
            win.webContents.send("assemblyai-partial-transcript", text);
          }
        };

        this.assemblyAiStreaming.onFinalTranscript = (text) => {
          if (win && !win.isDestroyed()) {
            win.webContents.send("assemblyai-final-transcript", text);
          }
        };

        this.assemblyAiStreaming.onError = (error) => {
          if (win && !win.isDestroyed()) {
            win.webContents.send("assemblyai-error", error.message);
          }
        };

        this.assemblyAiStreaming.onSessionEnd = (data) => {
          if (win && !win.isDestroyed()) {
            win.webContents.send("assemblyai-session-end", data);
          }
        };

        await this.assemblyAiStreaming.connect({ ...options, token });
        debugLogger.debug("AssemblyAI streaming started", {}, "streaming");

        return {
          success: true,
          usedWarmConnection: this.assemblyAiStreaming.hasWarmConnection() === false,
        };
      } catch (error) {
        debugLogger.error("AssemblyAI streaming start error", { error: error.message });
        if (error.code === "AUTH_EXPIRED") {
          return { success: false, error: "Session expired", code: "AUTH_EXPIRED" };
        }
        return { success: false, error: error.message };
      } finally {
        streamingStartInProgress = false;
      }
    });

    ipcMain.on("assemblyai-streaming-send", (event, audioBuffer) => {
      try {
        if (!this.assemblyAiStreaming) return;
        const buffer = Buffer.from(audioBuffer);
        this.assemblyAiStreaming.sendAudio(buffer);
      } catch (error) {
        debugLogger.error("AssemblyAI streaming send error", { error: error.message });
      }
    });

    ipcMain.on("assemblyai-streaming-force-endpoint", () => {
      this.assemblyAiStreaming?.forceEndpoint();
    });

    ipcMain.handle("assemblyai-streaming-stop", async (_event, graceful = true) => {
      try {
        let result = { text: "" };
        if (this.assemblyAiStreaming) {
          result = await this.assemblyAiStreaming.disconnect(Boolean(graceful));
          this.assemblyAiStreaming.cleanupAll();
          this.assemblyAiStreaming = null;
        }

        return { success: true, text: result?.text || "" };
      } catch (error) {
        debugLogger.error("AssemblyAI streaming stop error", { error: error.message });
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("assemblyai-streaming-status", async () => {
      if (!this.assemblyAiStreaming) {
        return { isConnected: false, sessionId: null };
      }
      return this.assemblyAiStreaming.getStatus();
    });

    ipcMain.handle("soniox-streaming-warmup", async (_event, options = {}) => {
      try {
        const apiKey = this.environmentManager.getSonioxKey();
        if (!apiKey) {
          return { success: false, error: "Soniox API key not configured", code: "NO_API_KEY" };
        }

        if (!this.sonioxStreaming) {
          this.sonioxStreaming = new SonioxStreaming();
        }

        if (this.sonioxStreaming.hasWarmConnection()) {
          return { success: true, alreadyWarm: true };
        }

        await this.sonioxStreaming.warmup({ ...options, apiKey });
        return { success: true };
      } catch (error) {
        debugLogger.error("Soniox warmup error", { error: error.message }, "streaming");
        return { success: false, error: error.message };
      }
    });

    let sonioxStreamingStartInProgress = false;

    ipcMain.handle("soniox-streaming-start", async (event, options = {}) => {
      if (sonioxStreamingStartInProgress) {
        return { success: false, error: "Operation in progress", code: "START_IN_PROGRESS" };
      }

      sonioxStreamingStartInProgress = true;

      try {
        const apiKey = this.environmentManager.getSonioxKey();
        if (!apiKey) {
          return { success: false, error: "Soniox API key not configured", code: "NO_API_KEY" };
        }

        const win = BrowserWindow.fromWebContents(event.sender);

        if (!this.sonioxStreaming) {
          this.sonioxStreaming = new SonioxStreaming();
        }

        const hasWarm = this.sonioxStreaming.hasWarmConnection();

        this.sonioxStreaming.onPartialTranscript = (text) => {
          if (win && !win.isDestroyed()) {
            win.webContents.send("soniox-partial-transcript", text);
          }
        };

        this.sonioxStreaming.onFinalTranscript = (text) => {
          if (win && !win.isDestroyed()) {
            win.webContents.send("soniox-final-transcript", text);
          }
        };

        this.sonioxStreaming.onError = (error) => {
          if (win && !win.isDestroyed()) {
            win.webContents.send("soniox-error", error.message);
          }
        };

        this.sonioxStreaming.onSessionEnd = (data) => {
          if (win && !win.isDestroyed()) {
            win.webContents.send("soniox-session-end", data);
          }
        };

        await this.sonioxStreaming.connect({ ...options, apiKey });
        return { success: true, usedWarmConnection: hasWarm };
      } catch (error) {
        debugLogger.error("Soniox streaming start error", { error: error.message }, "streaming");
        return { success: false, error: error.message };
      } finally {
        sonioxStreamingStartInProgress = false;
      }
    });

    ipcMain.on("soniox-streaming-send", (_event, audioBuffer) => {
      try {
        if (!this.sonioxStreaming) return;
        const buffer = Buffer.from(audioBuffer);
        this.sonioxStreaming.sendAudio(buffer);
      } catch (error) {
        debugLogger.error("Soniox streaming send error", { error: error.message }, "streaming");
      }
    });

    ipcMain.on("soniox-streaming-finalize", () => {
      this.sonioxStreaming?.finalize();
    });

    ipcMain.handle("soniox-streaming-stop", async (_event, graceful = true) => {
      try {
        let result = { text: "", model: "stt-rt-v4", audioBytesSent: 0 };
        if (this.sonioxStreaming) {
          result = await this.sonioxStreaming.disconnect(Boolean(graceful));
          this.sonioxStreaming = null;
        }

        return {
          success: true,
          text: result?.text || "",
          model: result?.model || "stt-rt-v4",
          audioBytesSent: result?.audioBytesSent || 0,
        };
      } catch (error) {
        debugLogger.error("Soniox streaming stop error", { error: error.message }, "streaming");
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("soniox-streaming-status", async () => {
      if (!this.sonioxStreaming) {
        return { isConnected: false, sessionId: null };
      }
      return this.sonioxStreaming.getStatus();
    });

    ipcMain.handle("bailian-realtime-warmup", async (_event, options = {}) => {
      try {
        const apiKey = this.environmentManager.getBailianKey();
        if (!apiKey) {
          return {
            success: false,
            error: "Alibaba Bailian API key not configured",
            code: "NO_API_KEY",
          };
        }

        if (!this.bailianRealtimeStreaming) {
          this.bailianRealtimeStreaming = new QwenRealtimeStreaming();
        }

        if (this.bailianRealtimeStreaming.hasWarmConnection()) {
          return { success: true, alreadyWarm: true };
        }

        await this.bailianRealtimeStreaming.warmup({ ...options, apiKey });
        return { success: true };
      } catch (error) {
        debugLogger.error("Bailian realtime warmup error", { error: error.message }, "streaming");
        return { success: false, error: error.message };
      }
    });

    let bailianRealtimeStartInProgress = false;

    ipcMain.handle("bailian-realtime-start", async (event, options = {}) => {
      if (bailianRealtimeStartInProgress) {
        return { success: false, error: "Operation in progress", code: "START_IN_PROGRESS" };
      }

      bailianRealtimeStartInProgress = true;

      try {
        const apiKey = this.environmentManager.getBailianKey();
        if (!apiKey) {
          return {
            success: false,
            error: "Alibaba Bailian API key not configured",
            code: "NO_API_KEY",
          };
        }

        const win = BrowserWindow.fromWebContents(event.sender);

        if (!this.bailianRealtimeStreaming) {
          this.bailianRealtimeStreaming = new QwenRealtimeStreaming();
        }

        const hasWarm = this.bailianRealtimeStreaming.hasWarmConnection();

        this.bailianRealtimeStreaming.onPartialTranscript = (text) => {
          if (win && !win.isDestroyed()) {
            win.webContents.send("bailian-realtime-partial-transcript", text);
          }
        };

        this.bailianRealtimeStreaming.onFinalTranscript = (text) => {
          if (win && !win.isDestroyed()) {
            win.webContents.send("bailian-realtime-final-transcript", text);
          }
        };

        this.bailianRealtimeStreaming.onError = (error) => {
          if (win && !win.isDestroyed()) {
            win.webContents.send("bailian-realtime-error", error.message);
          }
        };

        this.bailianRealtimeStreaming.onSpeechStarted = (data) => {
          if (win && !win.isDestroyed()) {
            win.webContents.send("bailian-realtime-speech-started", data);
          }
        };

        this.bailianRealtimeStreaming.onSessionEnd = (data) => {
          if (win && !win.isDestroyed()) {
            win.webContents.send("bailian-realtime-session-end", data);
          }
        };

        await this.bailianRealtimeStreaming.connect({ ...options, apiKey });
        return { success: true, usedWarmConnection: hasWarm };
      } catch (error) {
        debugLogger.error("Bailian realtime start error", { error: error.message }, "streaming");
        return { success: false, error: error.message };
      } finally {
        bailianRealtimeStartInProgress = false;
      }
    });

    ipcMain.on("bailian-realtime-send", (_event, audioBuffer) => {
      try {
        if (!this.bailianRealtimeStreaming) return;
        const buffer = Buffer.from(audioBuffer);
        this.bailianRealtimeStreaming.sendAudio(buffer);
      } catch (error) {
        debugLogger.error("Bailian realtime send error", { error: error.message }, "streaming");
      }
    });

    ipcMain.on("bailian-realtime-finalize", () => {
      this.bailianRealtimeStreaming?.finalize();
    });

    ipcMain.handle("bailian-realtime-stop", async (_event, graceful = true) => {
      try {
        let result = {
          text: "",
          model: "qwen3-asr-flash-realtime",
          audioBytesSent: 0,
        };
        if (this.bailianRealtimeStreaming) {
          result = await this.bailianRealtimeStreaming.disconnect(Boolean(graceful));
          this.bailianRealtimeStreaming = null;
        }

        return {
          success: true,
          text: result?.text || "",
          model: result?.model || "qwen3-asr-flash-realtime",
          audioBytesSent: result?.audioBytesSent || 0,
        };
      } catch (error) {
        debugLogger.error("Bailian realtime stop error", { error: error.message }, "streaming");
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("bailian-realtime-status", async () => {
      if (!this.bailianRealtimeStreaming) {
        return { isConnected: false, sessionId: null };
      }
      return this.bailianRealtimeStreaming.getStatus();
    });

    let deepgramTokenWindowId = null;

    const fetchDeepgramStreamingTokenFromWindow = async (windowId) => {
      const apiUrl = getApiUrl();
      if (!apiUrl) throw new Error("Mouthpiece API URL not configured");

      const win = BrowserWindow.fromId(windowId);
      if (!win || win.isDestroyed()) throw new Error("Window not available for token refresh");

      const cookieHeader = await getSessionCookiesFromWindow(win);
      if (!cookieHeader) throw new Error("No session cookies available");

      const tokenResponse = await fetch(`${apiUrl}/api/deepgram-streaming-token`, {
        method: "POST",
        headers: { Cookie: cookieHeader },
      });

      if (!tokenResponse.ok) {
        if (tokenResponse.status === 401) {
          const err = new Error("Session expired");
          err.code = "AUTH_EXPIRED";
          throw err;
        }
        throw new Error(`Failed to get Deepgram streaming token: ${tokenResponse.status}`);
      }

      const { token } = await tokenResponse.json();
      if (!token) throw new Error("No token received from API");
      return token;
    };

    const fetchDeepgramStreamingToken = async (event) => {
      const apiUrl = getApiUrl();
      if (!apiUrl) {
        throw new Error("Mouthpiece API URL not configured");
      }

      const cookieHeader = await getSessionCookies(event);
      if (!cookieHeader) {
        throw new Error("No session cookies available");
      }

      const tokenResponse = await fetch(`${apiUrl}/api/deepgram-streaming-token`, {
        method: "POST",
        headers: {
          Cookie: cookieHeader,
        },
      });

      if (!tokenResponse.ok) {
        if (tokenResponse.status === 401) {
          const err = new Error("Session expired");
          err.code = "AUTH_EXPIRED";
          throw err;
        }
        const errorData = await tokenResponse.json().catch(() => ({}));
        throw new Error(
          errorData.error || `Failed to get Deepgram streaming token: ${tokenResponse.status}`
        );
      }

      const { token } = await tokenResponse.json();
      if (!token) {
        throw new Error("No token received from API");
      }

      return token;
    };

    const resolveDeepgramStreamingCredentials = async (event, options = {}) => {
      const authMode = options.authMode === "apiKey" ? "apiKey" : "token";

      if (authMode === "apiKey") {
        const apiKey = this.environmentManager.getDeepgramKey();
        if (!apiKey) {
          throw new Error("Deepgram API key not configured");
        }
        return { token: apiKey, authMode };
      }

      const token = await fetchDeepgramStreamingToken(event);
      return { token, authMode };
    };

    ipcMain.handle("deepgram-streaming-warmup", async (event, options = {}) => {
      try {
        const authMode = options.authMode === "apiKey" ? "apiKey" : "token";
        const apiUrl = getApiUrl();
        if (authMode !== "apiKey" && !apiUrl) {
          return { success: false, error: "API not configured", code: "NO_API" };
        }

        const win = BrowserWindow.fromWebContents(event.sender);
        if (win && !win.isDestroyed()) {
          deepgramTokenWindowId = win.id;
        }

        if (!this.deepgramStreaming) {
          this.deepgramStreaming = new DeepgramStreaming();
        }

        if (authMode === "apiKey") {
          this.deepgramStreaming.setTokenRefreshFn(null);
        } else {
          this.deepgramStreaming.setTokenRefreshFn(async () => {
            if (!deepgramTokenWindowId) throw new Error("No window reference");
            return fetchDeepgramStreamingTokenFromWindow(deepgramTokenWindowId);
          });
        }

        if (this.deepgramStreaming.hasWarmConnection()) {
          debugLogger.debug("Deepgram connection already warm", {}, "streaming");
          return { success: true, alreadyWarm: true };
        }

        let token =
          this.deepgramStreaming.cachedAuthMode === authMode
            ? this.deepgramStreaming.getCachedToken()
            : null;
        if (!token) {
          debugLogger.debug(
            "Fetching Deepgram streaming credentials for warmup",
            { authMode },
            "streaming"
          );
          ({ token } = await resolveDeepgramStreamingCredentials(event, options));
        }

        this.deepgramStreaming.cacheToken(token, authMode);
        await this.deepgramStreaming.warmup({ ...options, token, authMode });
        debugLogger.debug("Deepgram connection warmed up", {}, "streaming");

        return { success: true };
      } catch (error) {
        debugLogger.error("Deepgram warmup error", { error: error.message });
        if (error.code === "AUTH_EXPIRED") {
          return { success: false, error: "Session expired", code: "AUTH_EXPIRED" };
        }
        return { success: false, error: error.message };
      }
    });

    let deepgramStreamingStartInProgress = false;

    ipcMain.handle("deepgram-streaming-start", async (event, options = {}) => {
      if (deepgramStreamingStartInProgress) {
        debugLogger.debug(
          "Deepgram streaming start already in progress, ignoring",
          {},
          "streaming"
        );
        return { success: false, error: "Operation in progress", code: "START_IN_PROGRESS" };
      }

      deepgramStreamingStartInProgress = true;
      try {
        const authMode = options.authMode === "apiKey" ? "apiKey" : "token";
        const apiUrl = getApiUrl();
        if (authMode !== "apiKey" && !apiUrl) {
          return { success: false, error: "API not configured", code: "NO_API" };
        }

        const win = BrowserWindow.fromWebContents(event.sender);
        if (win && !win.isDestroyed()) {
          deepgramTokenWindowId = win.id;
        }

        if (!this.deepgramStreaming) {
          this.deepgramStreaming = new DeepgramStreaming();
        }

        if (authMode === "apiKey") {
          this.deepgramStreaming.setTokenRefreshFn(null);
        } else {
          this.deepgramStreaming.setTokenRefreshFn(async () => {
            if (!deepgramTokenWindowId) throw new Error("No window reference");
            return fetchDeepgramStreamingTokenFromWindow(deepgramTokenWindowId);
          });
        }

        if (this.deepgramStreaming.isConnected) {
          debugLogger.debug("Deepgram cleaning up stale connection before start", {}, "streaming");
          await this.deepgramStreaming.disconnect(false);
        }

        const hasWarm = this.deepgramStreaming.hasWarmConnection();
        debugLogger.debug("Deepgram streaming start", { hasWarmConnection: hasWarm }, "streaming");

        let token =
          this.deepgramStreaming.cachedAuthMode === authMode
            ? this.deepgramStreaming.getCachedToken()
            : null;
        if (!token) {
          debugLogger.debug("Fetching Deepgram streaming credentials", { authMode }, "streaming");
          ({ token } = await resolveDeepgramStreamingCredentials(event, options));
          this.deepgramStreaming.cacheToken(token, authMode);
        } else {
          debugLogger.debug("Using cached Deepgram streaming token", {}, "streaming");
        }

        this.deepgramStreaming.onPartialTranscript = (text) => {
          if (win && !win.isDestroyed()) {
            win.webContents.send("deepgram-partial-transcript", text);
          }
        };

        this.deepgramStreaming.onFinalTranscript = (text) => {
          if (win && !win.isDestroyed()) {
            win.webContents.send("deepgram-final-transcript", text);
          }
        };

        this.deepgramStreaming.onError = (error) => {
          if (win && !win.isDestroyed()) {
            win.webContents.send("deepgram-error", error.message);
          }
        };

        this.deepgramStreaming.onSessionEnd = (data) => {
          if (win && !win.isDestroyed()) {
            win.webContents.send("deepgram-session-end", data);
          }
        };

        await this.deepgramStreaming.connect({ ...options, token, authMode });
        debugLogger.debug("Deepgram streaming started", {}, "streaming");

        return {
          success: true,
          usedWarmConnection: hasWarm,
        };
      } catch (error) {
        debugLogger.error("Deepgram streaming start error", { error: error.message });
        if (error.code === "AUTH_EXPIRED") {
          return { success: false, error: "Session expired", code: "AUTH_EXPIRED" };
        }
        return { success: false, error: error.message };
      } finally {
        deepgramStreamingStartInProgress = false;
      }
    });

    ipcMain.on("deepgram-streaming-send", (event, audioBuffer) => {
      try {
        if (!this.deepgramStreaming) return;
        const buffer = Buffer.from(audioBuffer);
        this.deepgramStreaming.sendAudio(buffer);
      } catch (error) {
        debugLogger.error("Deepgram streaming send error", { error: error.message });
      }
    });

    ipcMain.on("deepgram-streaming-finalize", () => {
      this.deepgramStreaming?.finalize();
    });

    ipcMain.handle("deepgram-streaming-stop", async (_event, graceful = true) => {
      try {
        const model = this.deepgramStreaming?.currentModel || "nova-3";
        const audioBytesSent = this.deepgramStreaming?.audioBytesSent || 0;
        let result = { text: "" };
        if (this.deepgramStreaming) {
          result = await this.deepgramStreaming.disconnect(Boolean(graceful));
        }

        return { success: true, text: result?.text || "", model, audioBytesSent };
      } catch (error) {
        debugLogger.error("Deepgram streaming stop error", { error: error.message });
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("deepgram-streaming-status", async () => {
      if (!this.deepgramStreaming) {
        return { isConnected: false, sessionId: null };
      }
      return this.deepgramStreaming.getStatus();
    });
  }

  broadcastToWindows(channel, payload) {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, payload);
      }
    });
  }
}

module.exports = IPCHandlers;
