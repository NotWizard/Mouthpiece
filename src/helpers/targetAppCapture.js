const { execFile } = require("child_process");
const debugLogger = require("./debugLogger");

// Captures the foreground app's PID + localized name when the user invokes
// dictation, so the paste pipeline knows which app received the text. Called
// at hotkey-press time, BEFORE the dictation overlay steals focus.

const WINDOWS_FOREGROUND_APP_SCRIPT = `
try {
  Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Win32ForegroundWindow {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
}
"@ | Out-Null

  $hwnd = [Win32ForegroundWindow]::GetForegroundWindow()
  if ($hwnd -eq [IntPtr]::Zero) {
    [pscustomobject]@{
      pid = $null
      name = $null
      capturedAt = (Get-Date).ToUniversalTime().ToString("o")
    } | ConvertTo-Json -Compress
    exit 0
  }

  $targetPid = 0
  [void][Win32ForegroundWindow]::GetWindowThreadProcessId($hwnd, [ref]$targetPid)
  $proc = Get-Process -Id $targetPid -ErrorAction SilentlyContinue
  $name = if ($null -ne $proc) { $proc.ProcessName } else { $null }

  [pscustomobject]@{
    pid = [int]$targetPid
    name = $name
    capturedAt = (Get-Date).ToUniversalTime().ToString("o")
  } | ConvertTo-Json -Compress
} catch {
  [pscustomobject]@{
    pid = $null
    name = $null
    capturedAt = (Get-Date).ToUniversalTime().ToString("o")
    error = $_.Exception.Message
  } | ConvertTo-Json -Compress
}
`;

class TargetAppCapture {
  constructor() {
    this.lastTargetPid = null;
    this.lastTargetAppName = null;
    this.lastTargetCapturedAt = null;
  }

  captureTargetPid() {
    const applyCaptureResult = (err, stdout) => {
      if (err) {
        this.lastTargetPid = null;
        this.lastTargetAppName = null;
        this.lastTargetCapturedAt = null;
      } else {
        try {
          const parsed = JSON.parse((stdout || "").trim());
          const pid = Number(parsed?.pid);
          this.lastTargetPid = Number.isInteger(pid) ? pid : null;
          this.lastTargetAppName =
            typeof parsed?.name === "string" && parsed.name.trim() ? parsed.name.trim() : null;
          this.lastTargetCapturedAt =
            typeof parsed?.capturedAt === "string" ? parsed.capturedAt : new Date().toISOString();
        } catch {
          const pid = parseInt((stdout || "").trim(), 10);
          this.lastTargetPid = Number.isInteger(pid) ? pid : null;
          this.lastTargetAppName = null;
          this.lastTargetCapturedAt = new Date().toISOString();
        }
      }

      debugLogger.debug("[TargetAppCapture] Captured target app", {
        pid: this.lastTargetPid,
        appName: this.lastTargetAppName,
        capturedAt: this.lastTargetCapturedAt,
      });
    };

    if (process.platform === "darwin") {
      const script =
        'ObjC.import("AppKit");' +
        "const app = $.NSWorkspace.sharedWorkspace.frontmostApplication;" +
        "const payload = {" +
        "pid: Number(app.processIdentifier)," +
        "name: ObjC.unwrap(app.localizedName) || null," +
        "capturedAt: (new Date()).toISOString()" +
        "};" +
        "JSON.stringify(payload);";
      execFile(
        "osascript",
        ["-l", "JavaScript", "-e", script],
        { timeout: 2000 },
        applyCaptureResult
      );
      return;
    }

    if (process.platform === "win32") {
      const encodedScript = Buffer.from(WINDOWS_FOREGROUND_APP_SCRIPT, "utf16le").toString(
        "base64"
      );

      execFile(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-EncodedCommand",
          encodedScript,
        ],
        { timeout: 2000, windowsHide: true, maxBuffer: 1024 * 1024 },
        applyCaptureResult
      );
      return;
    }
  }

  getLastTargetAppInfo() {
    return {
      appName: this.lastTargetAppName || null,
      processId: Number.isInteger(this.lastTargetPid) ? this.lastTargetPid : null,
      capturedAt: this.lastTargetCapturedAt || null,
    };
  }
}

module.exports = TargetAppCapture;
