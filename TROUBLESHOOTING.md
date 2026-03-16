# Troubleshooting

This guide covers the most common Mouthpiece problems across macOS, Windows, and Linux.

## Quick Diagnostics

| Check                          | Command                                                               |
| ------------------------------ | --------------------------------------------------------------------- |
| Host architecture              | `uname -m`                                                            |
| Node architecture              | `node -p "process.arch"`                                              |
| Current Electron platform/arch | `node -p "process.platform + ' ' + process.arch"`                     |
| FFmpeg availability            | `ffmpeg -version`                                                     |
| Installed package scripts      | `node -p "Object.keys(require('./package.json').scripts).join('\n')"` |

If you are running from source, confirm the local Whisper runtime has been downloaded:

```bash
npm run download:whisper-cpp
```

## Startup and Build Problems

### Architecture mismatch on Apple Silicon

Symptoms:

- app crashes on launch
- native modules fail to load
- "wrong architecture" errors

Try this:

1. Compare `uname -m` and `node -p "process.arch"`
2. Reinstall a native arm64 version of Node if needed
3. Reinstall dependencies with `npm ci`
4. Rebuild or repackage the app

### Packaged app launches but UI does not load

Symptoms:

- blank window
- tray icon appears but Control Panel does not load
- window flashes and closes

Try this:

1. Enable debug logging with [DEBUG.md](DEBUG.md)
2. Reinstall the packaged app
3. If you are on a local source checkout, run `npm run build:renderer`
4. If packaging from source, make sure required binaries were downloaded before the build

## Microphone Problems

### Mouthpiece cannot access the microphone

Symptoms:

- "Permission denied"
- "No microphones detected"
- recording starts but captures silence

Fixes:

#### macOS

1. Open `System Settings -> Privacy & Security -> Microphone`
2. Make sure `Mouthpiece` is enabled
3. If it is missing, use the permission prompt inside the app or reopen the microphone privacy page from Control Panel
4. Also confirm the right input device under `System Settings -> Sound -> Input`

#### Windows

1. Open `Settings -> Privacy -> Microphone`
2. Turn on microphone access for desktop apps
3. Confirm the correct input device under `Settings -> Sound -> Input`

#### Linux

1. Open your sound settings or `pavucontrol`
2. Select the expected input device
3. Verify your desktop environment is not muting the device

## Empty or Bad Transcriptions

Symptoms:

- blank text
- repeated short filler text
- transcriptions that never appear

Try this:

1. Verify microphone access first
2. Check the selected transcription language in `Settings`
3. Change to a different input device
4. If you are using local Whisper, switch to a smaller model and test again
5. Clear the local model cache if you suspect a corrupted download
6. Re-run onboarding if permissions or language defaults are in a bad state

## Local Whisper Problems

Mouthpiece's local Whisper mode uses a bundled `whisper-server` binary plus model files stored under the legacy cache directory `~/.cache/openwhispr/whisper-models/`.

### "whisper-server binary not found"

1. Restart Mouthpiece
2. If running from source, run `npm run download:whisper-cpp`
3. Reinstall the packaged app if the binary is missing from a build
4. On Windows, check whether antivirus quarantined the executable

### Model download or startup failures

1. Verify free disk space
2. Delete the failed model and download it again
3. Use `Privacy & Data -> Developer` to clear cached models if needed
4. See [LOCAL_WHISPER_SETUP.md](LOCAL_WHISPER_SETUP.md) for setup details

### FFmpeg not found

1. If running from source, reinstall dependencies with `npm ci`
2. Run `npm run setup`
3. Rebuild or reinstall the app if a packaged dependency is missing
4. Check debug logs to see whether Mouthpiece found the bundled FFmpeg binary

## Clipboard and Paste Problems on Linux

### Wayland clipboard issues

Symptoms:

- Mouthpiece copies text but the target app says the clipboard is empty
- paste simulation runs but nothing appears
- native Wayland apps cannot read clipboard data

Cause:

Electron clipboard behavior differs between X11, XWayland, and native Wayland apps, so Mouthpiece has to fall back across several paste methods.

Try this:

1. Install `wl-clipboard`
   - Debian/Ubuntu: `sudo apt install wl-clipboard`
   - Fedora/RHEL: `sudo dnf install wl-clipboard`
   - Arch: `sudo pacman -S wl-clipboard`
2. Install at least one paste automation tool
   - `xdotool` for X11 or XWayland apps
   - `wtype` for wlroots-based Wayland sessions such as Sway or Hyprland
   - `ydotool` if you already run `ydotoold`
3. Restart Mouthpiece after installing new tools

## Windows-Specific Problems

For Windows-only issues such as invisible windows, Defender interference, or full reset steps, see [WINDOWS_TROUBLESHOOTING.md](WINDOWS_TROUBLESHOOTING.md).

## Useful In-App Recovery Tools

The `Privacy & Data` section of the Control Panel includes developer and recovery tools that can help without touching files manually:

- `Open Logs Folder`
- `Clear Cache` for downloaded local models
- `Reset App Data` to remove settings, history, and cached files

## Getting Help

1. Enable debug logging and reproduce the issue once
2. Save the newest log file from [DEBUG.md](DEBUG.md)
3. Include:
   - operating system and version
   - Mouthpiece version
   - whether you are using packaged app or source checkout
   - whether the issue happens in local Whisper, NVIDIA Parakeet, or cloud mode
   - steps to reproduce

If you want to file it on the current fork, use [github.com/NotWizard/Mouthpiece/issues](https://github.com/NotWizard/Mouthpiece/issues).
