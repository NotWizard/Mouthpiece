# Windows Troubleshooting

This guide focuses on Windows-specific Mouthpiece problems such as invisible windows, Defender interference, microphone selection, and local Whisper runtime issues.

## Quick Fixes

### Mouthpiece is running but no window appears

Symptoms:

- `Mouthpiece.exe` is visible in Task Manager
- no overlay or Control Panel window opens

Try this:

1. Check the system tray for the Mouthpiece icon
2. Launch with debug logging: `Mouthpiece.exe --log-level=debug`
3. Try disabling GPU acceleration once: `Mouthpiece.exe --disable-gpu`
4. If installed from a packaged build, reinstall the app

### Recording works but no text appears

Try this:

1. Open `Settings -> Privacy -> Microphone`
2. Make sure desktop apps can access the microphone
3. Open `Settings -> Sound -> Input` and confirm the correct microphone is selected
4. Test the microphone in Windows Voice Recorder
5. Enable debug logging and inspect the newest log under `%APPDATA%\Mouthpiece\logs\`

## Local Whisper Problems

### Local Whisper fails to start

Mouthpiece uses a bundled `whisper-server-win32-x64.exe` runtime for the OpenAI Whisper local provider.

Try this:

1. Reinstall the app
2. If you are running from source, run `npm run download:whisper-cpp`
3. Confirm a Windows Whisper runtime exists under `resources\\bin\\`
4. Check whether antivirus quarantined the runtime executable
5. Clear the model cache at `%USERPROFILE%\.cache\openwhispr\whisper-models`

### Model download problems

1. Verify internet access
2. Free up disk space
3. Delete the broken model and download it again from the Control Panel
4. Use `Privacy & Data -> Developer -> Clear Cache` if repeated downloads fail

### FFmpeg-related failures

Symptoms:

- transcription fails immediately
- local server starts but audio conversion fails

Try this:

1. Reinstall Mouthpiece
2. Check whether antivirus quarantined FFmpeg or related bundled files
3. If developing from source, reinstall dependencies with `npm ci`
4. Review debug logs for `FFmpeg not found` or permission-related errors

## Debug Logging

```batch
Mouthpiece.exe --log-level=debug
```

Or add this to `%APPDATA%\Mouthpiece\.env`:

```env
OPENWHISPR_LOG_LEVEL=debug
```

The environment variable name remains `OPENWHISPR_LOG_LEVEL` for compatibility.

Logs are written to:

```text
%APPDATA%\Mouthpiece\logs\
```

## Defender and Security Software

### Windows Defender or antivirus blocks bundled binaries

This most often affects:

- `whisper-server-win32-x64.exe`
- FFmpeg binaries
- helper executables under `resources\\bin\\`

If Mouthpiece works after reinstalling and then breaks again, check your antivirus quarantine history and consider adding the installed app directory to exclusions.

### Firewall prompts in cloud mode

If you use cloud transcription providers, allow Mouthpiece through the firewall when Windows prompts you.

## Permission Notes

- Windows does not require macOS-style accessibility permissions for auto-paste
- Running as Administrator is usually not required, but it can help reveal whether a policy or permissions rule is interfering

## Full Reset

If a reinstall is not enough, uninstall Mouthpiece and then remove its local data:

```batch
rd /s /q "%APPDATA%\Mouthpiece"
rd /s /q "%USERPROFILE%\.cache\openwhispr\whisper-models"
```

If this machine previously used older OpenWhispr builds, also remove the old roaming-data directory if it still exists:

```batch
rd /s /q "%APPDATA%\OpenWhispr"
```

Then reinstall and launch again.

## Getting Help

When reporting a Windows issue, include:

- Windows version (`winver`)
- Mouthpiece version
- whether you are using packaged app or source checkout
- newest debug log file
- exact reproduction steps

If you want to file it on the current fork, use [github.com/NotWizard/Mouthpiece/issues](https://github.com/NotWizard/Mouthpiece/issues).
