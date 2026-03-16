# Local Whisper Setup

Mouthpiece supports fully local transcription with OpenAI Whisper models. In local mode, your audio stays on the device and is processed by a bundled `whisper-server` binary built from whisper.cpp.

This document covers the `OpenAI Whisper` local provider. If you want a different local engine, use the `NVIDIA Parakeet` provider in the same settings area.

## Quick Start

1. Open the Mouthpiece Control Panel
2. Go to `Settings`
3. Open the `Speech to Text` section
4. Switch the processing mode to `Local`
5. Choose `OpenAI Whisper` as the local provider
6. Download and select a model
7. Start dictating

The first time you use a model, Mouthpiece downloads it automatically.

## Recommended Models

| Model    | Size   | Speed             | Quality | Best for                             |
| -------- | ------ | ----------------- | ------- | ------------------------------------ |
| `tiny`   | ~75MB  | Fastest           | Basic   | quick tests and low-end hardware     |
| `base`   | ~142MB | Fast              | Good    | most users                           |
| `small`  | ~466MB | Medium            | Better  | longer dictation and better accuracy |
| `medium` | ~1.5GB | Slow              | High    | quality-focused local use            |
| `large`  | ~3GB   | Slowest           | Best    | maximum accuracy                     |
| `turbo`  | ~1.6GB | Fast for its size | High    | faster high-quality local use        |

## How Mouthpiece Runs Local Whisper

1. Mouthpiece starts a bundled `whisper-server` binary from `resources/bin/`
2. Audio is normalized to the format Whisper expects, using bundled FFmpeg when available
3. The selected GGML model is loaded from the local model cache
4. Transcription runs on-device and the text is returned to the app

## Model Cache Location

Whisper model files are stored in the legacy cache namespace:

- macOS: `~/.cache/openwhispr/whisper-models/`
- Windows: `%USERPROFILE%\.cache\openwhispr\whisper-models\`
- Linux: `~/.cache/openwhispr/whisper-models/`

The `openwhispr` folder name is still used internally for compatibility with existing installs.

## Requirements

- Disk space: about 75MB to 3GB depending on model
- RAM: about 1GB to 10GB depending on model size
- No separate Whisper install required for packaged builds

## Running From Source

If you are developing from a git checkout instead of a packaged build, download the local Whisper runtime for your current platform first:

```bash
npm run download:whisper-cpp
```

That populates the current-platform binary under `resources/bin/`.

If you are preparing multi-platform release artifacts from one machine, use:

```bash
npm run download:whisper-cpp:all
```

## Common Problems

### "whisper-server binary not found"

1. Restart Mouthpiece
2. If running from source, rerun `npm run download:whisper-cpp`
3. If using a packaged build, reinstall the app
4. On Windows, check whether antivirus quarantined the bundled binary

### Model will not download or install

1. Check internet access
2. Verify you have enough free disk space
3. Try deleting the failed model from the Control Panel and downloading again
4. If needed, clear the model cache from `Privacy & Data` -> `Developer`

### Transcription starts slowly on first run

This is expected when the selected model is being loaded or when the local server is warming up for the first time. Later requests should be faster.

### Local transcription keeps failing

1. Confirm your microphone works in Mouthpiece
2. Try a smaller model such as `base`
3. Check [TROUBLESHOOTING.md](TROUBLESHOOTING.md) and [DEBUG.md](DEBUG.md)
4. Temporarily switch to cloud mode to confirm the problem is local-provider specific

## Privacy Comparison

| Mode          | Audio leaves device | Internet required       | Notes                                               |
| ------------- | ------------------- | ----------------------- | --------------------------------------------------- |
| Local Whisper | No                  | Only for model download | best privacy, works offline after setup             |
| Cloud         | Yes                 | Yes                     | lower setup cost, depends on provider configuration |
