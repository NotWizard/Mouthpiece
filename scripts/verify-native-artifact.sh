#!/bin/bash
set -euo pipefail

DMG_PATH=$1
ARCH=${2:-arm64}
EXPECTED_SHA1=${MAC_SELFSIGN_CERT_SHA1:-DB4FFD2432826CB4DA396D12CD2B3193E51448D7}

case "$ARCH" in
  arm64) EXPECTED_ARCH=arm64 ;;
  x64|x86_64) EXPECTED_ARCH=x86_64 ;;
  *) echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;
esac

hdiutil verify "$DMG_PATH"
MOUNT_POINT=$(mktemp -d /tmp/mouthpiece-dmg.XXXXXX)
DATA_ROOT=$(mktemp -d /tmp/mouthpiece-smoke.XXXXXX)
cleanup() {
  hdiutil detach "$MOUNT_POINT" -quiet 2>/dev/null || true
  rm -rf "$MOUNT_POINT" "$DATA_ROOT"
}
trap cleanup EXIT

hdiutil attach "$DMG_PATH" -nobrowse -readonly -mountpoint "$MOUNT_POINT" -quiet
APP_PATH="$MOUNT_POINT/Mouthpiece.app"
EXECUTABLE="$APP_PATH/Contents/MacOS/Mouthpiece"
test -x "$EXECUTABLE"
codesign --verify --deep --strict --verbose=2 "$APP_PATH"
codesign --verify --strict \
  -R="identifier \"com.mouthpiece.app\" and certificate root = H\"$EXPECTED_SHA1\"" \
  "$APP_PATH"
codesign -d --entitlements :- "$APP_PATH" 2>/dev/null \
  | grep -q '<key>com.apple.security.cs.disable-library-validation</key><true/>'
test "$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$APP_PATH/Contents/Info.plist")" = "15.0"
lipo "$EXECUTABLE" -verify_arch "$EXPECTED_ARCH"

# Audit P1-14: fail the release if the bundled model-server runtimes or
# the MediaRemote adapter framework are missing or wrong-arch. The launch
# smoke below never exercises dictation or media pause, so without these
# gates a broken build-native-release.sh copy step would ship a signed
# .app that dies the moment the user selects local transcription or the
# playing-audio ducking path runs. Paths mirror how LocalModelRuntime and
# AudioCueService resolve them at launch (Bundle.main.resourceURL/
# Binaries/...). $ARCH matches the arch suffix produced by
# scripts/download-native-binaries.sh (arm64|x64); $EXPECTED_ARCH is the
# lipo-native arch (arm64|x86_64). qwen's mlx-qwen3-asr server is not
# yet part of the release payload (download-native-binaries.sh does not
# build it); add an entry to BUNDLED_RUNTIMES once it is.
BUNDLED_RUNTIMES=(
  "$APP_PATH/Contents/Resources/Binaries/whisper/whisper-server-darwin-$ARCH"
  "$APP_PATH/Contents/Resources/Binaries/parakeet/sherpa-onnx-ws-darwin-$ARCH"
)
for runtime in "${BUNDLED_RUNTIMES[@]}"; do
  if [[ ! -x "$runtime" ]]; then
    echo "Missing bundled runtime: $runtime" >&2
    exit 1
  fi
  if ! lipo "$runtime" -verify_arch "$EXPECTED_ARCH"; then
    echo "Bundled runtime arch mismatch: $runtime (expected $EXPECTED_ARCH)" >&2
    exit 1
  fi
done
MRA_FRAMEWORK="$APP_PATH/Contents/Resources/Binaries/mediaremote/MediaRemoteAdapter.framework"
if [[ ! -d "$MRA_FRAMEWORK" ]]; then
  echo "Missing bundled framework: $MRA_FRAMEWORK" >&2
  exit 1
fi
if ! lipo "$MRA_FRAMEWORK/MediaRemoteAdapter" -verify_arch "$EXPECTED_ARCH"; then
  echo "Bundled framework arch mismatch: $MRA_FRAMEWORK/MediaRemoteAdapter (expected $EXPECTED_ARCH)" >&2
  exit 1
fi

if ! spctl --assess --type execute --verbose=4 "$APP_PATH"; then
  echo "Gatekeeper rejected the self-signed app as expected without prior certificate trust; signature and DR checks passed." >&2
fi

MOUTHPIECE_DATA_ROOT="$DATA_ROOT" \
MOUTHPIECE_DISABLE_UPDATES=1 \
"$EXECUTABLE" > "$DATA_ROOT/launch.log" 2>&1 &
PID=$!
# Poll instead of a fixed sleep: a busy runner can take >3s to launch, and a
# crash right after the old sleep window went undetected.
for _ in $(seq 1 10); do
  sleep 0.5
  if ! kill -0 "$PID" 2>/dev/null; then
    echo "App exited during the smoke test; launch log follows:" >&2
    cat "$DATA_ROOT/launch.log" >&2 || true
    exit 1
  fi
done
kill "$PID"
wait "$PID" 2>/dev/null || true

echo "Verified $ARCH DMG, signature, requirement, deployment target, architecture, and launch."
