# Debug Logging

Use debug logging when Mouthpiece launches but does not record, transcribe, paste, or load correctly.

## Turn It On

### Option 1: From the app

1. Open the Mouthpiece Control Panel
2. Go to `Privacy & Data`
3. In the `Developer` section, enable `Debug mode`
4. Reproduce the issue

### Option 2: Launch from the command line

```bash
# macOS packaged app
/Applications/Mouthpiece.app/Contents/MacOS/Mouthpiece --log-level=debug

# Windows packaged app
Mouthpiece.exe --log-level=debug
```

You can also use `--log-level=trace` for even more detail.

### Option 3: Set the environment file

Add this to the `.env` file inside Mouthpiece's user-data directory and restart the app:

```env
OPENWHISPR_LOG_LEVEL=debug
```

The environment variable still uses the legacy `OPENWHISPR_LOG_LEVEL` name for compatibility.

## Where the `.env` File Lives

Mouthpiece stores runtime settings in `app.getPath("userData")`. Typical production paths are:

- macOS: `~/Library/Application Support/Mouthpiece/.env`
- Windows: `%APPDATA%\Mouthpiece\.env`
- Linux: `~/.config/Mouthpiece/.env`

Development and staging builds may use a suffixed directory such as `Mouthpiece-development`.

## Log File Locations

Debug logs are written to the `logs/` folder inside the same user-data directory:

- macOS: `~/Library/Application Support/Mouthpiece/logs/debug-*.log`
- Windows: `%APPDATA%\Mouthpiece\logs\debug-*.log`
- Linux: `~/.config/Mouthpiece/logs/debug-*.log`

If you are troubleshooting an older install, also check legacy directories such as `OpenWhispr` if the app migrated from a previous build.

## What Gets Logged

| Area                | Examples                                                                   |
| ------------------- | -------------------------------------------------------------------------- |
| App startup         | environment loading, user-data path selection, window load failures        |
| Audio capture       | microphone permissions, selected device, chunk sizes, silence detection    |
| Local transcription | whisper-server startup, model selection, FFmpeg conversion, parse failures |
| Cloud requests      | request lifecycle, provider failures, timeouts                             |
| Clipboard and paste | permission checks, paste method selection, platform-specific fallback      |
| IPC                 | renderer/main-process message flow and handler failures                    |

## What to Search For

### No audio or silent recordings

Look for lines such as:

- `maxLevel < 0.01`
- `Audio appears to be silent`
- `No active audio input was found`

### Local transcription failures

Look for:

- `whisper-server binary not found`
- `whisper-server failed to start`
- `FFmpeg not found`
- `Failed to parse whisper-server response`

### Permission or paste issues

Look for:

- `Microphone Access Denied`
- `Accessibility permissions needed`
- `clipboard`
- `ydotool`
- `wtype`
- `xdotool`

## Sharing Logs

1. Enable debug mode
2. Reproduce the issue once
3. Open the logs folder from the Control Panel if available, or browse to the path above
4. Remove any private content you do not want to share
5. Attach the newest `debug-*.log` file to your issue report

## Turn It Off

Debug mode is off by default. To disable it again:

- turn off `Debug mode` in the Control Panel
- remove `--log-level=debug` from your launch command
- remove `OPENWHISPR_LOG_LEVEL` from the user-data `.env` file
