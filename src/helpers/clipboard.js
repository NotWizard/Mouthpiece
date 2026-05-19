const { clipboard, systemPreferences } = require("electron");
const { spawn, spawnSync } = require("child_process");
const { killProcess } = require("../utils/process");
const path = require("path");
const fs = require("fs");
const { buildMacOSAccessibilityResetCommand } = require("./accessibilityRepair");
const { resolveMacOSAccessibilityMode } = require("./macOSAccessibilityMode");
const { createFastPasteCache } = require("./fastPasteCache");
const debugLogger = require("./debugLogger");
const { createInsertionPlan, resolveInsertionOutcomeMode } = require("./insertionPlan");
const {
  resolveInsertionCompatibilityProfile,
} = require("../config/insertionCompatibilityProfiles.js");

const CACHE_TTL_MS = 30000;

// isTrustedAccessibilityClient() is a cheap synchronous syscall, so the cache
// only exists to debounce the dialog shown on denial.
const ACCESSIBILITY_CHECK_TTL_MS = 5000;

const PASTE_DELAYS = {
  darwin: 120,
  win32_fast: 10,
  win32_nircmd: 30,
  win32_pwsh: 40,
};

const RESTORE_DELAYS = {
  darwin: 450,
  win32_nircmd: 80,
  win32_pwsh: 80,
};

const WINDOWS_FOCUS_PROBE_SCRIPT = `
try {
  Add-Type -AssemblyName UIAutomationClient | Out-Null
  $el = [System.Windows.Automation.AutomationElement]::FocusedElement
  if ($null -eq $el) {
    [pscustomobject]@{ ok = $false; reason = "no_focused_element" } | ConvertTo-Json -Compress
    exit 0
  }

  $textPatternRef = $null
  $valuePatternRef = $null
  $hasTextPattern = $el.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$textPatternRef)
  $hasValuePattern = $el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePatternRef)

  $windowClass = ""
  $windowName = ""
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $node = $el
  for ($i = 0; $i -lt 20 -and $null -ne $node; $i++) {
    if ($node.Current.ControlType.ProgrammaticName -eq "ControlType.Window") {
      $windowClass = $node.Current.ClassName
      $windowName = $node.Current.Name
      break
    }
    $node = $walker.GetParent($node)
  }

  [pscustomobject]@{
    ok = $true
    processId = [int]$el.Current.ProcessId
    controlType = $el.Current.ControlType.ProgrammaticName
    className = $el.Current.ClassName
    automationId = $el.Current.AutomationId
    hasKeyboardFocus = $el.Current.HasKeyboardFocus
    isEnabled = $el.Current.IsEnabled
    isOffscreen = $el.Current.IsOffscreen
    hasTextPattern = $hasTextPattern
    hasValuePattern = $hasValuePattern
    windowClass = $windowClass
    windowName = $windowName
  } | ConvertTo-Json -Compress
} catch {
  [pscustomobject]@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
}
`;

function buildPasteResult({
  success,
  mode,
  message,
  reason,
  method,
  platform,
  outcomeMode,
  monitorMode,
  compatibilityProfileId,
  compatibilityFamily,
  feedbackCode,
  recoveryHint,
  manualAction,
  retryCount,
}) {
  return {
    success,
    mode,
    ...(message ? { message } : {}),
    ...(reason ? { reason } : {}),
    ...(method ? { method } : {}),
    ...(platform ? { platform } : {}),
    ...(outcomeMode ? { outcomeMode } : {}),
    ...(monitorMode ? { monitorMode } : {}),
    ...(compatibilityProfileId ? { compatibilityProfileId } : {}),
    ...(compatibilityFamily ? { compatibilityFamily } : {}),
    ...(feedbackCode ? { feedbackCode } : {}),
    ...(recoveryHint ? { recoveryHint } : {}),
    ...(manualAction ? { manualAction } : {}),
    ...(Number.isInteger(retryCount) ? { retryCount } : {}),
  };
}

function inferPasteFailureReason(error, clipboardWritten) {
  const code = typeof error?.code === "string" ? error.code.toLowerCase() : "";
  if (code.includes("accessibility")) return "accessibility_permission_required";
  if (code.includes("timeout")) return "paste_timeout";
  if (code.includes("simulation")) return "paste_simulation_failed";

  const message = String(error?.message || "").toLowerCase();
  if (message.includes("accessibility")) return "accessibility_permission_required";
  if (message.includes("timed out")) return "paste_timeout";
  if (
    message.includes("automatic pasting requires") ||
    message.includes("please install")
  ) {
    return "paste_tool_unavailable";
  }
  if (
    message.includes("clipboard copied") ||
    message.includes("copied to clipboard") ||
    message.includes("paste simulation failed")
  ) {
    return "paste_simulation_failed";
  }

  return clipboardWritten ? "paste_simulation_failed" : "clipboard_write_failed";
}

class ClipboardManager {
  constructor() {
    this.accessibilityCache = { value: null, expiresAt: 0 };
    this.commandAvailabilityCache = new Map();
    this.nircmdPath = null;
    this.nircmdChecked = false;
    this.fastPastePath = null;
    this.fastPasteChecked = false;
    this.winFastPastePath = null;
    this.winFastPasteChecked = false;
    // Negative-cache (TTL) is separate from binary-path resolution: a runtime
    // failure (e.g. CGEvent denied because Accessibility was revoked) marks the
    // helper unavailable for a short window so we fall through to osascript,
    // but the resolved binary path stays cached so we can retry after TTL.
    this.fastPasteCache = createFastPasteCache();
  }

  async attemptAutoPaste(runPaste, { attempts = 1, retryDelayMs = 0, onRetry } = {}) {
    let lastError = null;

    for (let attempt = 1; attempt <= Math.max(1, attempts); attempt += 1) {
      try {
        await runPaste(attempt);
        return attempt;
      } catch (error) {
        lastError = error;
        if (attempt >= attempts) {
          break;
        }

        if (typeof onRetry === "function") {
          await onRetry(attempt, error);
        }

        if (retryDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        }
      }
    }

    throw lastError || new Error("Auto paste failed");
  }

  getNircmdPath() {
    if (this.nircmdChecked) {
      return this.nircmdPath;
    }

    this.nircmdChecked = true;

    if (process.platform !== "win32") {
      return null;
    }

    const possiblePaths = [
      path.join(process.resourcesPath, "bin", "nircmd.exe"),
      path.join(__dirname, "..", "..", "resources", "bin", "nircmd.exe"),
      path.join(process.cwd(), "resources", "bin", "nircmd.exe"),
    ];

    for (const nircmdPath of possiblePaths) {
      try {
        if (fs.existsSync(nircmdPath)) {
          this.safeLog(`✅ Found nircmd.exe at: ${nircmdPath}`);
          this.nircmdPath = nircmdPath;
          return nircmdPath;
        }
      } catch (error) {}
    }

    this.safeLog("⚠️ nircmd.exe not found, will use PowerShell fallback");
    return null;
  }

  getNircmdStatus() {
    if (process.platform !== "win32") {
      return { available: false, reason: "Not Windows" };
    }
    const nircmdPath = this.getNircmdPath();
    return {
      available: !!nircmdPath,
      path: nircmdPath,
    };
  }

  _resolveNativeBinary(binaryName, platform, cacheKeyChecked, cacheKeyPath) {
    if (this[cacheKeyChecked]) {
      return this[cacheKeyPath];
    }
    this[cacheKeyChecked] = true;

    if (process.platform !== platform) {
      return null;
    }

    const candidates = new Set([
      path.join(__dirname, "..", "..", "resources", "bin", binaryName),
      path.join(__dirname, "..", "..", "resources", binaryName),
    ]);

    if (process.resourcesPath) {
      [
        path.join(process.resourcesPath, binaryName),
        path.join(process.resourcesPath, "bin", binaryName),
        path.join(process.resourcesPath, "resources", binaryName),
        path.join(process.resourcesPath, "resources", "bin", binaryName),
        path.join(process.resourcesPath, "app.asar.unpacked", "resources", binaryName),
        path.join(process.resourcesPath, "app.asar.unpacked", "resources", "bin", binaryName),
      ].forEach((candidate) => candidates.add(candidate));
    }

    for (const candidate of candidates) {
      try {
        const stats = fs.statSync(candidate);
        if (stats.isFile()) {
          try {
            fs.accessSync(candidate, fs.constants.X_OK);
          } catch {
            fs.chmodSync(candidate, 0o755);
          }
          this[cacheKeyPath] = candidate;
          return candidate;
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  resolveFastPasteBinary() {
    return this._resolveNativeBinary(
      "macos-fast-paste",
      "darwin",
      "fastPasteChecked",
      "fastPastePath"
    );
  }

  resolveWindowsFastPasteBinary() {
    return this._resolveNativeBinary(
      "windows-fast-paste.exe",
      "win32",
      "winFastPasteChecked",
      "winFastPastePath"
    );
  }

  safeLog(...args) {
    if (process.env.NODE_ENV === "development") {
      try {
        console.log(...args);
      } catch (error) {
        // Silently ignore EPIPE errors in logging
        if (error.code !== "EPIPE") {
          process.stderr.write(`Log error: ${error.message}\n`);
        }
      }
    }
  }

  commandExists(cmd) {
    const now = Date.now();
    const cached = this.commandAvailabilityCache.get(cmd);
    if (cached && now < cached.expiresAt) {
      return cached.exists;
    }
    try {
      const res = spawnSync("sh", ["-c", `command -v ${cmd}`], {
        stdio: "ignore",
      });
      const exists = res.status === 0;
      this.commandAvailabilityCache.set(cmd, {
        exists,
        expiresAt: now + CACHE_TTL_MS,
      });
      return exists;
    } catch {
      this.commandAvailabilityCache.set(cmd, {
        exists: false,
        expiresAt: now + CACHE_TTL_MS,
      });
      return false;
    }
  }

  probeWindowsPasteTarget() {
    if (process.platform !== "win32") {
      return null;
    }

    try {
      const result = spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-WindowStyle",
          "Hidden",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          WINDOWS_FOCUS_PROBE_SCRIPT,
        ],
        {
          windowsHide: true,
          timeout: 1500,
          encoding: "utf8",
        }
      );

      const stdout = (result.stdout || "").trim();
      if (!stdout) {
        return null;
      }

      const parsed = JSON.parse(stdout);
      if (!parsed?.ok) {
        this.safeLog("⚠️ Windows focus probe unavailable", parsed);
        return null;
      }

      const controlType = String(parsed.controlType || "");
      const processId = Number(parsed.processId);
      const className = String(parsed.className || "").toLowerCase();
      const windowClass = String(parsed.windowClass || "").toLowerCase();
      const hasTextPattern = !!parsed.hasTextPattern;
      const hasValuePattern = !!parsed.hasValuePattern;
      const isEnabled = parsed.isEnabled !== false;
      const hasFocus = parsed.hasKeyboardFocus !== false;
      const focusProcessId = Number.isInteger(processId) && processId > 0 ? processId : null;

      const definitelyNonTextControlTypes = new Set([
        "ControlType.Button",
        "ControlType.CheckBox",
        "ControlType.RadioButton",
        "ControlType.Image",
        "ControlType.ListItem",
        "ControlType.TreeItem",
        "ControlType.MenuItem",
        "ControlType.ToolBar",
        "ControlType.TabItem",
        "ControlType.Hyperlink",
      ]);

      const definitelyNonTextClasses = [
        "syslistview32",
        "workerw",
        "progman",
        "shell_traywnd",
        "mstasklistwclass",
      ];

      const classLooksNonText = definitelyNonTextClasses.some(
        (token) => className.includes(token) || windowClass.includes(token)
      );
      const controlLooksNonText =
        definitelyNonTextControlTypes.has(controlType) && !hasTextPattern && !hasValuePattern;
      // Some apps expose focus as a top-level window/container (custom input
      // controls, embedded editors). Treat these as "unknown" instead of
      // immediately downgrading to clipboard-only.
      const isTopLevelContainer =
        controlType === "ControlType.Window" || controlType === "ControlType.Pane";
      const noEditablePattern =
        !hasTextPattern &&
        !hasValuePattern &&
        controlType !== "ControlType.Edit" &&
        controlType !== "ControlType.Document";
      const ambiguousContainerTarget = isTopLevelContainer && !classLooksNonText;
      const shouldSkipForLikelyNonText =
        classLooksNonText ||
        controlLooksNonText ||
        (noEditablePattern && !ambiguousContainerTarget);

      debugLogger.debug(
        "Windows focus probe",
        {
          controlType,
          className: parsed.className || "",
          windowClass: parsed.windowClass || "",
          hasTextPattern,
          hasValuePattern,
          isEnabled,
          hasFocus,
          processId: focusProcessId,
          isTopLevelContainer,
          ambiguousContainerTarget,
        },
        "clipboard"
      );

      if (shouldSkipForLikelyNonText && isEnabled && hasFocus) {
        return {
          shouldSkipAutoPaste: true,
          reason: "target_not_text_input",
          processId: focusProcessId,
          details: {
            controlType,
            className: parsed.className || "",
            windowClass: parsed.windowClass || "",
            hasTextPattern,
            hasValuePattern,
            processId: focusProcessId,
          },
        };
      }

      return {
        shouldSkipAutoPaste: false,
        processId: focusProcessId,
        details: {
          controlType,
          className: parsed.className || "",
          windowClass: parsed.windowClass || "",
          hasTextPattern,
          hasValuePattern,
          processId: focusProcessId,
        },
      };
    } catch (error) {
      this.safeLog("⚠️ Windows focus probe failed", error?.message || error);
      return null;
    }
  }

  async pasteText(text, options = {}) {
    const startTime = Date.now();
    const platform = process.platform;
    let method = "unknown";
    let clipboardWritten = false;
    const compatibilityProfile = resolveInsertionCompatibilityProfile({
      platform,
      intent: options.intent,
      targetApp: options.targetApp,
    });
    let insertionPlan = createInsertionPlan({
      platform,
      request: {
        ...options,
        allowFallbackCopy:
          compatibilityProfile.fallback.allowClipboardCopy && options.allowFallbackCopy !== false,
      },
    });
    let retryCount = 0;

    const buildCompatibilityMeta = (resultMode) => ({
      compatibilityProfileId: compatibilityProfile.id,
      compatibilityFamily: compatibilityProfile.family,
      feedbackCode:
        resultMode === "pasted" ? undefined : compatibilityProfile.fallback.feedbackCode,
      recoveryHint:
        resultMode === "pasted" ? undefined : compatibilityProfile.fallback.recoveryHint,
      manualAction:
        resultMode === "pasted" ? undefined : compatibilityProfile.fallback.manualAction,
      retryCount,
    });

    try {
      const originalClipboard = clipboard.readText();
      this.safeLog(
        "💾 Saved original clipboard content:",
        originalClipboard.substring(0, 50) + "..."
      );

      clipboard.writeText(text);
      clipboardWritten = true;
      this.safeLog("📋 Text copied to clipboard:", text.substring(0, 50) + "...");

      if (platform === "darwin") {
        method = this.resolveFastPasteBinary() ? "cgevent" : "applescript";
        this.safeLog("🔍 Checking accessibility permissions for paste operation...");
        const hasPermissions = await this.checkAccessibilityPermissions();

        if (!hasPermissions) {
          this.safeLog("⚠️ No accessibility permissions - text copied to clipboard only");
          const errorMsg =
            "Accessibility permissions required for automatic pasting. Text has been copied to clipboard - please paste manually with Cmd+V.";
          throw new Error(errorMsg);
        }

        this.safeLog("✅ Permissions granted, attempting to paste...");
        retryCount = await this.attemptAutoPaste(
          () => this.pasteMacOS(originalClipboard, options),
          {
            attempts: compatibilityProfile.retry.autoPasteAttempts,
            retryDelayMs: compatibilityProfile.retry.retryDelayMs,
            onRetry: async (_attempt, error) => {
              this.safeLog("⚠️ Paste attempt failed, retrying with compatibility profile", {
                compatibilityProfileId: compatibilityProfile.id,
                error: error?.message || String(error),
              });
              clipboard.writeText(text);
            },
          }
        );
      } else if (platform === "win32") {
        const focusProbe = this.probeWindowsPasteTarget();
        if (focusProbe?.shouldSkipAutoPaste) {
          insertionPlan = createInsertionPlan({
            platform,
            request: options,
            capabilities: {
              autoPasteViable: false,
              autoPasteReason: focusProbe.reason || "focus_not_editable",
            },
          });
          method = "clipboard";
          this.safeLog("⚠️ Windows target is not text-editable, skipping auto paste", focusProbe);
          debugLogger.info(
            "Windows paste downgraded to clipboard-only",
            {
              reason: focusProbe.reason,
              ...focusProbe.details,
            },
            "clipboard"
          );
          return buildPasteResult({
            success: false,
            mode: "copied",
            message:
              "No editable text field detected. Text copied to clipboard; paste manually with Ctrl+V.",
            reason: focusProbe.reason,
            method,
            platform,
            outcomeMode: resolveInsertionOutcomeMode({
              plan: insertionPlan,
              mode: "copied",
              success: false,
            }),
            monitorMode: insertionPlan.monitor.mode,
            ...buildCompatibilityMeta("copied"),
          });
        }

        const winFastPaste = this.resolveWindowsFastPasteBinary();
        const requestedTargetPid =
          Number.isInteger(options?.targetPid) && options.targetPid > 0 ? options.targetPid : null;
        const focusedTargetPid =
          Number.isInteger(focusProbe?.processId) && focusProbe.processId > 0
            ? focusProbe.processId
            : null;
        const hasMatchingTargetPid =
          requestedTargetPid !== null &&
          focusedTargetPid !== null &&
          requestedTargetPid === focusedTargetPid;
        if (winFastPaste) {
          method = "sendinput";
        } else {
          const nircmdPath = this.getNircmdPath();
          method = nircmdPath ? "nircmd" : "powershell";
        }
        const preserveClipboardForManualFallback =
          method === "powershell" || (method === "nircmd" && !hasMatchingTargetPid);

        await this.pasteWindows(originalClipboard, {
          preserveClipboard: preserveClipboardForManualFallback,
        });

        if (
          method === "nircmd" &&
          !hasMatchingTargetPid &&
          compatibilityProfile.fallback.downgradeUnverifiedAutoPaste
        ) {
          insertionPlan = createInsertionPlan({
            platform,
            request: options,
            capabilities: {
              autoPasteViable: false,
              autoPasteReason: "paste_unverified_nircmd",
            },
          });
          debugLogger.info(
            "Windows paste treated as clipboard fallback (unverified nircmd sendkeypress)",
            {
              reason: "paste_unverified_nircmd",
              requestedTargetPid,
              focusedTargetPid,
            },
            "clipboard"
          );
          return buildPasteResult({
            success: false,
            mode: "copied",
            message:
              "Text copied to clipboard. Auto-paste via nircmd could not be verified; press Ctrl+V manually.",
            reason: "paste_unverified_nircmd",
            method,
            platform,
            outcomeMode: resolveInsertionOutcomeMode({
              plan: insertionPlan,
              mode: "copied",
              success: false,
            }),
            monitorMode: insertionPlan.monitor.mode,
            ...buildCompatibilityMeta("copied"),
          });
        }

        // PowerShell SendKeys often exits 0 even when the target app did not
        // accept the paste. Treat it as clipboard fallback so UI stays visible.
        if (method === "powershell" && compatibilityProfile.fallback.downgradeUnverifiedAutoPaste) {
          insertionPlan = createInsertionPlan({
            platform,
            request: options,
            capabilities: {
              autoPasteViable: false,
              autoPasteReason: "paste_unverified_powershell",
            },
          });
          debugLogger.info(
            "Windows paste treated as clipboard fallback (unverified powershell sendkeys)",
            {
              reason: "paste_unverified_powershell",
            },
            "clipboard"
          );
          return buildPasteResult({
            success: false,
            mode: "copied",
            message:
              "Text copied to clipboard. Auto-paste via PowerShell is unverified; press Ctrl+V manually.",
            reason: "paste_unverified_powershell",
            method,
            platform,
            outcomeMode: resolveInsertionOutcomeMode({
              plan: insertionPlan,
              mode: "copied",
              success: false,
            }),
            monitorMode: insertionPlan.monitor.mode,
            ...buildCompatibilityMeta("copied"),
          });
        }
      }

      this.safeLog("✅ Paste operation complete", {
        platform,
        method,
        elapsedMs: Date.now() - startTime,
        textLength: text.length,
        compatibilityProfileId: compatibilityProfile.id,
        retryCount,
      });
      return buildPasteResult({
        success: true,
        mode: "pasted",
        method,
        platform,
        outcomeMode: resolveInsertionOutcomeMode({
          plan: insertionPlan,
          mode: "pasted",
          success: true,
        }),
        monitorMode: insertionPlan.monitor.mode,
        ...buildCompatibilityMeta("pasted"),
      });
    } catch (error) {
      const message =
        error?.message ??
        (typeof error?.toString === "function" ? error.toString() : String(error));
      const mode = clipboardWritten ? "copied" : "failed";
      const reason = inferPasteFailureReason(error, clipboardWritten);

      this.safeLog(
        clipboardWritten
          ? "⚠️ Paste automation failed, clipboard preserved"
          : "❌ Paste operation failed",
        {
          platform,
          method,
          mode,
          reason,
          clipboardWritten,
          elapsedMs: Date.now() - startTime,
          error: message,
          compatibilityProfileId: compatibilityProfile.id,
          retryCount,
        }
      );
      return buildPasteResult({
        success: false,
        mode,
        message,
        reason,
        method,
        platform,
        outcomeMode: resolveInsertionOutcomeMode({
          plan: insertionPlan,
          mode,
          success: false,
        }),
        monitorMode: insertionPlan.monitor.mode,
        ...buildCompatibilityMeta(mode),
      });
    }
  }

  async pasteMacOS(originalClipboard, options = {}) {
    const { useNativePasteHelper } = resolveMacOSAccessibilityMode();
    const fastPasteBinary = this.resolveFastPasteBinary();
    const useFastPaste =
      useNativePasteHelper && !!fastPasteBinary && !this.fastPasteCache.isUnavailable();
    const shouldRestoreClipboard = !options?.preserveClipboard;
    const pasteDelay = options.fromStreaming ? (useFastPaste ? 15 : 50) : PASTE_DELAYS.darwin;

    return new Promise((resolve, reject) => {
      setTimeout(() => {
        const pasteProcess = useFastPaste
          ? spawn(fastPasteBinary)
          : spawn("osascript", [
              "-e",
              'tell application "System Events" to key code 9 using command down',
            ]);

        let errorOutput = "";
        let hasTimedOut = false;

        pasteProcess.stderr.on("data", (data) => {
          errorOutput += data.toString();
        });

        pasteProcess.on("close", (code) => {
          if (hasTimedOut) return;
          clearTimeout(timeoutId);
          pasteProcess.removeAllListeners();

          if (code === 0) {
            this.safeLog(`Text pasted successfully via ${useFastPaste ? "CGEvent" : "osascript"}`);
            if (shouldRestoreClipboard) {
              setTimeout(() => {
                clipboard.writeText(originalClipboard);
                this.safeLog("🔄 Clipboard restored");
              }, RESTORE_DELAYS.darwin);
            } else {
              this.safeLog("📋 Clipboard preserved with pasted text");
            }
            resolve();
          } else if (useFastPaste) {
            this.safeLog(
              code === 2
                ? "CGEvent binary lacks accessibility trust, falling back to osascript"
                : `CGEvent paste failed (code ${code}), falling back to osascript`
            );
            this.fastPasteCache.markUnavailable();
            this.pasteMacOSWithOsascript(originalClipboard, options).then(resolve).catch(reject);
          } else {
            this.accessibilityCache = { value: null, expiresAt: 0 };
            const errorMsg = `Paste failed (code ${code}). Text is copied to clipboard - please paste manually with Cmd+V.`;
            reject(new Error(errorMsg));
          }
        });

        pasteProcess.on("error", (error) => {
          if (hasTimedOut) return;
          clearTimeout(timeoutId);
          pasteProcess.removeAllListeners();

          if (useFastPaste) {
            this.safeLog("CGEvent paste error, falling back to osascript");
            this.fastPasteCache.markUnavailable();
            this.pasteMacOSWithOsascript(originalClipboard, options).then(resolve).catch(reject);
          } else {
            const errorMsg = `Paste command failed: ${error.message}. Text is copied to clipboard - please paste manually with Cmd+V.`;
            reject(new Error(errorMsg));
          }
        });

        const timeoutId = setTimeout(() => {
          hasTimedOut = true;
          killProcess(pasteProcess, "SIGKILL");
          pasteProcess.removeAllListeners();
          const errorMsg =
            "Paste operation timed out. Text is copied to clipboard - please paste manually with Cmd+V.";
          reject(new Error(errorMsg));
        }, 3000);
      }, pasteDelay);
    });
  }

  async pasteMacOSWithOsascript(originalClipboard, options = {}) {
    return new Promise((resolve, reject) => {
      const shouldRestoreClipboard = !options?.preserveClipboard;
      const pasteProcess = spawn("osascript", [
        "-e",
        'tell application "System Events" to key code 9 using command down',
      ]);

      let hasTimedOut = false;

      pasteProcess.on("close", (code) => {
        if (hasTimedOut) return;
        clearTimeout(timeoutId);
        pasteProcess.removeAllListeners();

        if (code === 0) {
          this.safeLog("Text pasted successfully via osascript fallback");
          if (shouldRestoreClipboard) {
            setTimeout(() => {
              clipboard.writeText(originalClipboard);
              this.safeLog("🔄 Clipboard restored");
            }, RESTORE_DELAYS.darwin);
          } else {
            this.safeLog("📋 Clipboard preserved with pasted text");
          }
          resolve();
        } else {
          this.accessibilityCache = { value: null, expiresAt: 0 };
          const errorMsg = `Paste failed (code ${code}). Text is copied to clipboard - please paste manually with Cmd+V.`;
          reject(new Error(errorMsg));
        }
      });

      pasteProcess.on("error", (error) => {
        if (hasTimedOut) return;
        clearTimeout(timeoutId);
        pasteProcess.removeAllListeners();
        const errorMsg = `Paste command failed: ${error.message}. Text is copied to clipboard - please paste manually with Cmd+V.`;
        reject(new Error(errorMsg));
      });

      const timeoutId = setTimeout(() => {
        hasTimedOut = true;
        killProcess(pasteProcess, "SIGKILL");
        pasteProcess.removeAllListeners();
        reject(
          new Error(
            "Paste operation timed out. Text is copied to clipboard - please paste manually with Cmd+V."
          )
        );
      }, 3000);
    });
  }

  async pasteWindows(originalClipboard, options = {}) {
    const fastPastePath = this.resolveWindowsFastPasteBinary();

    if (fastPastePath) {
      return this.pasteWithFastPaste(fastPastePath, originalClipboard, options);
    }

    return this.pasteWithNircmdOrPowerShell(originalClipboard, options);
  }

  async pasteWithFastPaste(fastPastePath, originalClipboard, options = {}) {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        let hasTimedOut = false;
        const startTime = Date.now();
        const shouldRestoreClipboard = !options?.preserveClipboard;

        this.safeLog("⚡ Windows fast-paste starting");

        const pasteProcess = spawn(fastPastePath, [], {
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        });

        let stdoutData = "";
        let stderrData = "";

        pasteProcess.stdout.on("data", (data) => {
          stdoutData += data.toString();
        });

        pasteProcess.stderr.on("data", (data) => {
          stderrData += data.toString();
        });

        pasteProcess.on("close", (code) => {
          if (hasTimedOut) return;
          clearTimeout(timeoutId);

          const elapsed = Date.now() - startTime;
          const output = stdoutData.trim();

          if (code === 0) {
            this.safeLog("✅ Windows fast-paste success", {
              elapsedMs: elapsed,
              output,
            });
            if (shouldRestoreClipboard) {
              setTimeout(() => {
                clipboard.writeText(originalClipboard);
                this.safeLog("🔄 Clipboard restored");
              }, RESTORE_DELAYS.win32_nircmd);
            } else {
              this.safeLog("📋 Clipboard preserved with pasted text");
            }
            resolve();
          } else {
            this.safeLog(
              `❌ Windows fast-paste failed (code ${code}), falling back to nircmd/PowerShell`,
              { elapsedMs: elapsed, stderr: stderrData.trim() }
            );
            this.pasteWithNircmdOrPowerShell(originalClipboard, options)
              .then(resolve)
              .catch(reject);
          }
        });

        pasteProcess.on("error", (error) => {
          if (hasTimedOut) return;
          clearTimeout(timeoutId);
          this.safeLog("❌ Windows fast-paste error, falling back to nircmd/PowerShell", {
            elapsedMs: Date.now() - startTime,
            error: error.message,
          });
          this.pasteWithNircmdOrPowerShell(originalClipboard, options).then(resolve).catch(reject);
        });

        const timeoutId = setTimeout(() => {
          hasTimedOut = true;
          this.safeLog("⏱️ Windows fast-paste timeout, falling back to nircmd/PowerShell");
          killProcess(pasteProcess, "SIGKILL");
          pasteProcess.removeAllListeners();
          this.pasteWithNircmdOrPowerShell(originalClipboard, options).then(resolve).catch(reject);
        }, 2000);
      }, PASTE_DELAYS.win32_fast);
    });
  }

  async pasteWithNircmdOrPowerShell(originalClipboard, options = {}) {
    const nircmdPath = this.getNircmdPath();
    if (nircmdPath) {
      return this.pasteWithNircmd(nircmdPath, originalClipboard, options);
    }
    return this.pasteWithPowerShell(originalClipboard, options);
  }

  async pasteWithNircmd(nircmdPath, originalClipboard, options = {}) {
    return new Promise((resolve, reject) => {
      const pasteDelay = PASTE_DELAYS.win32_nircmd;
      const restoreDelay = RESTORE_DELAYS.win32_nircmd;
      const shouldRestoreClipboard = !options?.preserveClipboard;

      setTimeout(() => {
        let hasTimedOut = false;
        const startTime = Date.now();

        this.safeLog(`⚡ nircmd paste starting (delay: ${pasteDelay}ms)`);

        const pasteProcess = spawn(nircmdPath, ["sendkeypress", "ctrl+v"]);

        let errorOutput = "";

        pasteProcess.stderr.on("data", (data) => {
          errorOutput += data.toString();
        });

        pasteProcess.on("close", (code) => {
          if (hasTimedOut) return;
          clearTimeout(timeoutId);

          const elapsed = Date.now() - startTime;

          if (code === 0) {
            this.safeLog(`✅ nircmd paste success`, {
              elapsedMs: elapsed,
              restoreDelayMs: restoreDelay,
              restoredClipboard: shouldRestoreClipboard,
            });
            if (shouldRestoreClipboard) {
              setTimeout(() => {
                clipboard.writeText(originalClipboard);
                this.safeLog("🔄 Clipboard restored");
              }, restoreDelay);
            } else {
              this.safeLog("📋 Clipboard preserved for manual paste fallback");
            }
            resolve();
          } else {
            this.safeLog(`❌ nircmd failed (code ${code}), falling back to PowerShell`, {
              elapsedMs: elapsed,
              stderr: errorOutput,
            });
            this.pasteWithPowerShell(originalClipboard, options).then(resolve).catch(reject);
          }
        });

        pasteProcess.on("error", (error) => {
          if (hasTimedOut) return;
          clearTimeout(timeoutId);
          const elapsed = Date.now() - startTime;
          this.safeLog(`❌ nircmd error, falling back to PowerShell`, {
            elapsedMs: elapsed,
            error: error.message,
          });
          this.pasteWithPowerShell(originalClipboard, options).then(resolve).catch(reject);
        });

        const timeoutId = setTimeout(() => {
          hasTimedOut = true;
          const elapsed = Date.now() - startTime;
          this.safeLog(`⏱️ nircmd timeout, falling back to PowerShell`, { elapsedMs: elapsed });
          killProcess(pasteProcess, "SIGKILL");
          pasteProcess.removeAllListeners();
          this.pasteWithPowerShell(originalClipboard, options).then(resolve).catch(reject);
        }, 2000);
      }, pasteDelay);
    });
  }

  async pasteWithPowerShell(originalClipboard, options = {}) {
    return new Promise((resolve, reject) => {
      const pasteDelay = PASTE_DELAYS.win32_pwsh;
      const restoreDelay = RESTORE_DELAYS.win32_pwsh;
      const shouldRestoreClipboard = !options?.preserveClipboard;

      setTimeout(() => {
        let hasTimedOut = false;
        const startTime = Date.now();

        this.safeLog(`🪟 PowerShell paste starting (delay: ${pasteDelay}ms)`);

        const pasteProcess = spawn("powershell.exe", [
          "-NoProfile",
          "-NonInteractive",
          "-WindowStyle",
          "Hidden",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          "[void][System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms');[System.Windows.Forms.SendKeys]::SendWait('^v')",
        ]);

        let errorOutput = "";

        pasteProcess.stderr.on("data", (data) => {
          errorOutput += data.toString();
        });

        pasteProcess.on("close", (code) => {
          if (hasTimedOut) return;
          clearTimeout(timeoutId);

          const elapsed = Date.now() - startTime;

          if (code === 0) {
            this.safeLog(`✅ PowerShell paste success`, {
              elapsedMs: elapsed,
              restoreDelayMs: restoreDelay,
              restoredClipboard: shouldRestoreClipboard,
            });
            if (shouldRestoreClipboard) {
              setTimeout(() => {
                clipboard.writeText(originalClipboard);
                this.safeLog("🔄 Clipboard restored");
              }, restoreDelay);
            } else {
              this.safeLog("📋 Clipboard preserved for manual paste fallback");
            }
            resolve();
          } else {
            this.safeLog(`❌ PowerShell paste failed`, {
              code,
              elapsedMs: elapsed,
              stderr: errorOutput,
            });
            reject(
              new Error(
                `Windows paste failed with code ${code}. Text is copied to clipboard - please paste manually with Ctrl+V.`
              )
            );
          }
        });

        pasteProcess.on("error", (error) => {
          if (hasTimedOut) return;
          clearTimeout(timeoutId);
          const elapsed = Date.now() - startTime;
          this.safeLog(`❌ PowerShell paste error`, {
            elapsedMs: elapsed,
            error: error.message,
          });
          reject(
            new Error(
              `Windows paste failed: ${error.message}. Text is copied to clipboard - please paste manually with Ctrl+V.`
            )
          );
        });

        const timeoutId = setTimeout(() => {
          hasTimedOut = true;
          const elapsed = Date.now() - startTime;
          this.safeLog(`⏱️ PowerShell paste timeout`, { elapsedMs: elapsed });
          killProcess(pasteProcess, "SIGKILL");
          pasteProcess.removeAllListeners();
          reject(
            new Error(
              "Paste operation timed out. Text is copied to clipboard - please paste manually with Ctrl+V."
            )
          );
        }, 5000);
      }, pasteDelay);
    });
  }

  async checkAccessibilityPermissions({
    promptOnFailure = true,
    bypassCache = false,
  } = {}) {
    if (process.platform !== "darwin") return true;

    const now = Date.now();
    if (!bypassCache && now < this.accessibilityCache.expiresAt && this.accessibilityCache.value !== null) {
      return this.accessibilityCache.value;
    }

    const previousValue = this.accessibilityCache.value;
    const allowed = systemPreferences.isTrustedAccessibilityClient(false);
    this.accessibilityCache = {
      value: allowed,
      expiresAt: Date.now() + ACCESSIBILITY_CHECK_TTL_MS,
    };

    // AX flipped from denied to granted: a previous CGEvent failure may have
    // marked fast-paste unavailable. Clear that negative cache so the next
    // paste retries the fast path immediately instead of waiting out the TTL.
    if (allowed && previousValue === false) {
      this.fastPasteCache.invalidate();
    }

    if (!allowed && promptOnFailure) {
      this.showAccessibilityDialog("not allowed assistive access");
    }

    return allowed;
  }

  async resetAccessibilityPermissions() {
    if (process.platform !== "darwin") {
      return {
        success: false,
        error: "Accessibility reset is only available on macOS.",
      };
    }

    this.accessibilityCache = { value: null, expiresAt: 0 };

    const { command, args } = buildMacOSAccessibilityResetCommand();
    const result = spawnSync(command, args, { encoding: "utf8" });

    if (result.error) {
      return { success: false, error: result.error.message };
    }

    if (result.status !== 0) {
      const error = (result.stderr || result.stdout || "").trim();
      return {
        success: false,
        error: error || `tccutil exited with code ${result.status ?? "unknown"}`,
      };
    }

    this.openSystemSettings();
    return { success: true };
  }

  showAccessibilityDialog(testError) {
    const isStuckPermission =
      testError.includes("not allowed assistive access") ||
      testError.includes("(-1719)") ||
      testError.includes("(-25006)");

    let dialogMessage;
    if (isStuckPermission) {
      dialogMessage = `🔒 Mouthpiece needs Accessibility permissions, but it looks like you may have OLD PERMISSIONS from a previous version.

❗ COMMON ISSUE: If you've rebuilt/reinstalled Mouthpiece, the old permissions may be "stuck" and preventing new ones.

🔧 To fix this:
1. Open System Settings → Privacy & Security → Accessibility
2. Look for ANY old "Mouthpiece" entries and REMOVE them (click the - button)
3. Also remove any entries that say "Electron" or have unclear names
4. Click the + button and manually add the NEW Mouthpiece app
5. Make sure the checkbox is enabled
6. Restart Mouthpiece

⚠️ This is especially common during development when rebuilding the app.

📝 Without this permission, text will only copy to clipboard (no automatic pasting).

Would you like to open System Settings now?`;
    } else {
      dialogMessage = `🔒 Mouthpiece needs Accessibility permissions to paste text into other applications.

📋 Current status: Clipboard copy works, but pasting (Cmd+V simulation) fails.

🔧 To fix this:
1. Open System Settings (or System Preferences on older macOS)
2. Go to Privacy & Security → Accessibility
3. Click the lock icon and enter your password
4. Add Mouthpiece to the list and check the box
5. Restart Mouthpiece

⚠️ Without this permission, dictated text will only be copied to clipboard but won't paste automatically.

💡 In production builds, this permission is required for full functionality.

Would you like to open System Settings now?`;
    }

    const permissionDialog = spawn("osascript", [
      "-e",
      `display dialog "${dialogMessage}" buttons {"Cancel", "Open System Settings"} default button "Open System Settings"`,
    ]);

    permissionDialog.on("close", (dialogCode) => {
      if (dialogCode === 0) {
        this.openSystemSettings();
      }
    });

    permissionDialog.on("error", () => {});
  }

  openSystemSettings() {
    const settingsCommands = [
      ["open", ["x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"]],
      ["open", ["-b", "com.apple.systempreferences"]],
      ["open", ["/System/Library/PreferencePanes/Security.prefPane"]],
    ];

    let commandIndex = 0;
    const tryNextCommand = () => {
      if (commandIndex < settingsCommands.length) {
        const [cmd, args] = settingsCommands[commandIndex];
        const settingsProcess = spawn(cmd, args);

        settingsProcess.on("error", (error) => {
          commandIndex++;
          tryNextCommand();
        });

        settingsProcess.on("close", (settingsCode) => {
          if (settingsCode !== 0) {
            commandIndex++;
            tryNextCommand();
          }
        });
      } else {
        spawn("open", ["-a", "System Preferences"]).on("error", () => {
          spawn("open", ["-a", "System Settings"]).on("error", () => {});
        });
      }
    };

    tryNextCommand();
  }

  preWarmAccessibility() {
    if (process.platform !== "darwin") return;
    this.checkAccessibilityPermissions({ promptOnFailure: false }).catch(() => {});
    this.resolveFastPasteBinary();
  }

  async readClipboard() {
    return clipboard.readText();
  }

  async writeClipboard(text) {
    clipboard.writeText(text);
    return { success: true };
  }

}

module.exports = ClipboardManager;
