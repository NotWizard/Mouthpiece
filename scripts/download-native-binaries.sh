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
MEDIAREMOTE_ADAPTER_SHA=3ac3d4bdf862c7b5399b4fba4df5689f5c38609a
WHISPER_SHA256=870ba21409cdf66697dc4db15ebdb13bc67037d76c7cc63756c81471d8f1731a
SHERPA_SHA256=396be5ea5bfd22c37f939f94bf3dbfcb5a953aa1cd13b4453c4f799eb128578d
MEDIAREMOTE_ADAPTER_SHA256=111e285e7a8acfb05b7339883e303a360f8a7a9b7acb4f0f5c01b647deb8ceb5

verify_checksum() {
  local file=$1
  local expected=$2
  echo "$expected  $file" | shasum -a 256 -c - >/dev/null || {
    echo "Checksum mismatch for $file (expected $expected)" >&2
    exit 1
  }
}

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
curl -fsSL --retry 5 --retry-all-errors --retry-delay 3 \
  --connect-timeout 30 --max-time 600 \
  "https://github.com/ggml-org/whisper.cpp/archive/refs/tags/$WHISPER_VERSION.tar.gz" \
  -o "$WORK/whisper.tar.gz"
verify_checksum "$WORK/whisper.tar.gz" "$WHISPER_SHA256"
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
WHISPER_SERVER=$(find "$WORK/whisper-build" -type f -name whisper-server -perm -111 -print -quit)
cp "$WHISPER_SERVER" "$OUTPUT/whisper/whisper-server-darwin-${ARCH/x86_64/x64}"
copy_libraries "$WORK/whisper-build" "$OUTPUT/whisper"

echo "Downloading sherpa-onnx $SHERPA_VERSION"
SHERPA_ARCHIVE="sherpa-onnx-v$SHERPA_VERSION-osx-universal2-shared.tar.bz2"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 3 \
  --connect-timeout 30 --max-time 600 \
  "https://github.com/k2-fsa/sherpa-onnx/releases/download/v$SHERPA_VERSION/$SHERPA_ARCHIVE" \
  -o "$WORK/sherpa.tar.bz2"
verify_checksum "$WORK/sherpa.tar.bz2" "$SHERPA_SHA256"
mkdir "$WORK/sherpa"
tar -xjf "$WORK/sherpa.tar.bz2" -C "$WORK/sherpa"
SHERPA_SERVER=$(find "$WORK/sherpa" -type f -name sherpa-onnx-offline-websocket-server -print -quit)
cp "$SHERPA_SERVER" "$OUTPUT/parakeet/sherpa-onnx-ws-darwin-${ARCH/x86_64/x64}"
copy_libraries "$WORK/sherpa" "$OUTPUT/parakeet"

echo "Building mediaremote-adapter $MEDIAREMOTE_ADAPTER_SHA"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 3 \
  --connect-timeout 30 --max-time 600 \
  "https://github.com/ungive/mediaremote-adapter/archive/$MEDIAREMOTE_ADAPTER_SHA.tar.gz" \
  -o "$WORK/mra.tar.gz"
verify_checksum "$WORK/mra.tar.gz" "$MEDIAREMOTE_ADAPTER_SHA256"
tar -xzf "$WORK/mra.tar.gz" -C "$WORK"
MRA_SOURCE=$(find "$WORK" -maxdepth 1 -type d -name 'mediaremote-adapter-*' -print -quit)
cmake -S "$MRA_SOURCE" -B "$WORK/mra-build" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_OSX_ARCHITECTURES="$XCODE_ARCH"
cmake --build "$WORK/mra-build" --config Release --target MediaRemoteAdapter
MRA_FRAMEWORK=$(find "$WORK/mra-build" -type d -name 'MediaRemoteAdapter.framework' -print -quit)
test -n "$MRA_FRAMEWORK" || { echo "MediaRemoteAdapter.framework was not built" >&2; exit 1; }
mkdir -p "$OUTPUT/mediaremote"
cp -R "$MRA_FRAMEWORK" "$OUTPUT/mediaremote/"
cp "$MRA_SOURCE/bin/mediaremote-adapter.pl" "$OUTPUT/mediaremote/mediaremote-adapter.pl"
cp "$MRA_SOURCE/LICENSE" "$OUTPUT/mediaremote/LICENSE"

find "$OUTPUT" -type f \( -name '*.dylib' -o -name 'whisper-server-*' -o -name 'sherpa-onnx-ws-*' -o -name '*.pl' -o -name 'MediaRemoteAdapter' \) -exec chmod 755 {} \;
verify_runtime_binary "$OUTPUT/whisper/whisper-server-darwin-${ARCH/x86_64/x64}"
verify_runtime_binary "$OUTPUT/parakeet/sherpa-onnx-ws-darwin-${ARCH/x86_64/x64}"
verify_runtime_directory "$OUTPUT/whisper"
verify_runtime_directory "$OUTPUT/parakeet"
echo "Native runtimes prepared in $OUTPUT"
