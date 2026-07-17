#!/bin/bash
set -euo pipefail

ARCH="${1:-$(uname -m)}"
case "$ARCH" in
  arm64) XCODE_ARCH=arm64 ;;
  x64|x86_64) XCODE_ARCH=x86_64 ;;
  *) echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;
esac

ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUTPUT="$ROOT/Native/Binaries"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

WHISPER_VERSION=v1.8.3
SHERPA_VERSION=1.12.23

copy_libraries() {
  local source=$1
  local destination=$2
  while IFS= read -r -d '' library; do
    if [ -L "$library" ]; then
      cp -P "$library" "$destination/"
    else
      cp -f "$library" "$destination/"
    fi
  done < <(find "$source" \( -type f -o -type l \) -name '*.dylib' -print0)
}

verify_runtime_directory() {
  local directory=$1
  while IFS= read -r -d '' item; do
    while IFS= read -r dependency; do
      if [ ! -e "$directory/$dependency" ]; then
        echo "Missing @rpath dependency for $(basename "$item"): $dependency" >&2
        exit 1
      fi
    done < <(otool -L "$item" | awk '$1 ~ /^@rpath\// { sub("@rpath/", "", $1); print $1 }')
  done < <(find "$directory" -type f \( -perm -111 -o -name '*.dylib' \) -print0)
}

verify_runtime_binary() {
  local binary=$1
  test -x "$binary" || { echo "Missing runtime executable: $binary" >&2; exit 1; }
  file "$binary" | grep -q "$XCODE_ARCH" || {
    echo "Runtime architecture mismatch: $(file "$binary")" >&2
    exit 1
  }
}

mkdir -p "$OUTPUT/whisper" "$OUTPUT/parakeet"
find "$OUTPUT" -mindepth 2 -type f ! -name .gitkeep -delete

echo "Building whisper.cpp $WHISPER_VERSION for $XCODE_ARCH"
curl -fsSL "https://github.com/ggml-org/whisper.cpp/archive/refs/tags/$WHISPER_VERSION.tar.gz" \
  -o "$WORK/whisper.tar.gz"
tar -xzf "$WORK/whisper.tar.gz" -C "$WORK"
WHISPER_SOURCE=$(find "$WORK" -maxdepth 1 -type d -name 'whisper.cpp-*' -print -quit)
cmake -S "$WHISPER_SOURCE" -B "$WORK/whisper-build" \
  -DWHISPER_BUILD_SERVER=ON \
  -DWHISPER_BUILD_EXAMPLES=ON \
  -DWHISPER_BUILD_TESTS=OFF \
  -DWHISPER_SDL2=OFF \
  -DBUILD_SHARED_LIBS=ON \
  -DGGML_NATIVE=OFF \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_OSX_ARCHITECTURES="$XCODE_ARCH"
cmake --build "$WORK/whisper-build" --config Release --target whisper-server --parallel
WHISPER_SERVER=$(find "$WORK/whisper-build" -type f -name whisper-server -perm +111 -print -quit)
cp "$WHISPER_SERVER" "$OUTPUT/whisper/whisper-server-darwin-${ARCH/x86_64/x64}"
copy_libraries "$WORK/whisper-build" "$OUTPUT/whisper"

echo "Downloading sherpa-onnx $SHERPA_VERSION"
SHERPA_ARCHIVE="sherpa-onnx-v$SHERPA_VERSION-osx-universal2-shared.tar.bz2"
curl -fsSL "https://github.com/k2-fsa/sherpa-onnx/releases/download/v$SHERPA_VERSION/$SHERPA_ARCHIVE" \
  -o "$WORK/sherpa.tar.bz2"
mkdir "$WORK/sherpa"
tar -xjf "$WORK/sherpa.tar.bz2" -C "$WORK/sherpa"
SHERPA_SERVER=$(find "$WORK/sherpa" -type f -name sherpa-onnx-offline-websocket-server -print -quit)
cp "$SHERPA_SERVER" "$OUTPUT/parakeet/sherpa-onnx-ws-darwin-${ARCH/x86_64/x64}"
copy_libraries "$WORK/sherpa" "$OUTPUT/parakeet"

find "$OUTPUT" -type f ! -name .gitkeep -exec chmod 755 {} \;
verify_runtime_binary "$OUTPUT/whisper/whisper-server-darwin-${ARCH/x86_64/x64}"
verify_runtime_binary "$OUTPUT/parakeet/sherpa-onnx-ws-darwin-${ARCH/x86_64/x64}"
verify_runtime_directory "$OUTPUT/whisper"
verify_runtime_directory "$OUTPUT/parakeet"
echo "Native runtimes prepared in $OUTPUT"
