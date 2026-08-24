#!/bin/bash
set -euo pipefail

VERSION=${1#v}
ARCH=${2:-arm64}
OUTPUT=${3:-artifacts}

case "$ARCH" in
  arm64) XCODE_ARCH=arm64 ;;
  x64|x86_64) ARCH=x64; XCODE_ARCH=x86_64 ;;
  *) echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;
esac

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
scripts/validate-release-version.sh "$VERSION" >/dev/null
scripts/download-native-binaries.sh "$ARCH"
xcodegen generate

BUILD_NUMBER=$(awk -F. '{ print ($1 * 10000) + ($2 * 100) + $3 }' <<<"$VERSION")
ARCHIVE="$ROOT/.build/release/Mouthpiece-$ARCH.xcarchive"
STAGING="$ROOT/.build/release/staging-$ARCH"
rm -rf "$ARCHIVE" "$STAGING"
mkdir -p "$STAGING" "$OUTPUT"

DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer} \
xcodebuild -project Mouthpiece.xcodeproj -scheme Mouthpiece -configuration Release \
  -destination 'generic/platform=macOS' -archivePath "$ARCHIVE" archive \
  ARCHS="$XCODE_ARCH" ONLY_ACTIVE_ARCH=NO \
  MARKETING_VERSION="$VERSION" CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO

ditto "$ARCHIVE/Products/Applications/Mouthpiece.app" "$STAGING/Mouthpiece.app"
scripts/sign-native-app.sh "$STAGING/Mouthpiece.app"

ZIP="$ROOT/$OUTPUT/Mouthpiece-$VERSION-$ARCH-mac.zip"
DMG="$ROOT/$OUTPUT/Mouthpiece-$VERSION-$ARCH.dmg"
ditto -c -k --sequesterRsrc --keepParent "$STAGING/Mouthpiece.app" "$ZIP"

# Build a laid-out DMG: Mouthpiece.app on the left, Applications on the right,
# with a branded drag-arrow background. A bare `hdiutil create` leaves Finder to
# place icons alphabetically (Applications left, app right) with no background.
#
# Everything DMG-related lives in a per-run mktemp workdir. The image mounts at
# /Volumes/<build-unique volname>: Finder can only resolve `tell disk "<name>"`
# for volumes under /Volumes (an arbitrary mountpoint fails with -1728), so the
# uniqueness lives in the NAME rather than the path — two concurrent builds or a
# retry after a leaked mount still cannot collide. The build volname is kept
# short because HFS+ truncates past 27 characters, which would break `tell disk`.
# Detach always goes through the device node captured at attach time, because
# `diskutil renameVolume` relocates the mountpoint and leaves the original path
# invalid. The trap detaches and removes the workdir on any exit path so a hung
# AppleScript cannot leak a mount into the next run. The volume is renamed to the
# release-facing name before the UDZO convert so the shipped DMG surfaces the
# polished name to end users.
mkdir -p "$ROOT/.build/release"
WORK_DIR=
DEV_NODE=
cleanup_dmg() {
  if [[ -n "${DEV_NODE:-}" ]]; then
    hdiutil detach "$DEV_NODE" -quiet 2>/dev/null \
      || hdiutil detach "$DEV_NODE" -force -quiet 2>/dev/null \
      || true
  fi
  if [[ -n "${WORK_DIR:-}" ]]; then
    rm -rf "$WORK_DIR"
  fi
}
trap cleanup_dmg EXIT
WORK_DIR=$(mktemp -d "$ROOT/.build/release/dmg-$ARCH.XXXXXX")
RW_DMG="$WORK_DIR/rw.dmg"
BG_SRC="$ROOT/Native/Packaging/dmg-background.png"
BG_1X="$WORK_DIR/dmg-bg-1x.png"
VOLNAME_BUILD="Mouthpiece $ARCH-$$"
VOLNAME_FINAL="Mouthpiece $VERSION"
MOUNT="/Volumes/$VOLNAME_BUILD"

ln -s /Applications "$STAGING/Applications"

STAGING_KB=$(du -sk "$STAGING" | awk '{ print $1 }')
IMAGE_MB=$(( STAGING_KB / 1024 + 60 ))
hdiutil create -volname "$VOLNAME_BUILD" -srcfolder "$STAGING" -fs HFS+ \
  -format UDRW -size "${IMAGE_MB}m" -ov "$RW_DMG"
DEV_NODE=$(hdiutil attach "$RW_DMG" -mountpoint "$MOUNT" -nobrowse -noverify \
  -noautoopen | awk '/\/dev\/disk/ { print $1; exit }')
test -n "$DEV_NODE" || { echo "hdiutil attach reported no device node" >&2; exit 1; }

# HiDPI background: pair a 1x (632x424) with the source 2x (1264x848) so the
# window renders crisply on Retina and correctly on non-Retina displays.
mkdir -p "$MOUNT/.background"
sips -z 424 632 "$BG_SRC" --out "$BG_1X" >/dev/null
tiffutil -cathidpicheck "$BG_1X" "$BG_SRC" -out "$MOUNT/.background/background.tiff"
rm -f "$BG_1X"

# Apply the Finder layout. No `|| true` fallback: an unstyled DMG must fail
# the build instead of shipping. Finder is occasionally busy on CI runners,
# so one retry is allowed before giving up.
apply_dmg_layout() {
  osascript <<OSA
tell application "Finder"
  tell disk "$VOLNAME_BUILD"
    open
    set current view of container window to icon view
    set toolbar visible of container window to false
    set statusbar visible of container window to false
    set the bounds of container window to {240, 140, 872, 592}
    set theViewOptions to the icon view options of container window
    set arrangement of theViewOptions to not arranged
    set icon size of theViewOptions to 120
    set text size of theViewOptions to 12
    set background picture of theViewOptions to file ".background:background.tiff"
    set position of item "Mouthpiece.app" of container window to {161, 210}
    set position of item "Applications" of container window to {472, 210}
    update without registering applications
    delay 1
    close
  end tell
end tell
OSA
}

fail_dmg_layout() {
  echo "$1" >&2
  exit 1
}

if ! apply_dmg_layout; then
  echo "Finder DMG layout failed; retrying once" >&2
  sleep 5
  apply_dmg_layout || fail_dmg_layout "Finder DMG layout failed after retry"
fi

# Readback of icon positions/background via Finder AppleEvents is unreliable
# on headless CI (background-picture reads throw -10000), so verification is
# the strict apply above (fails the build after one retry) plus a non-empty
# .DS_Store; a missing layout cannot slip through as an empty store.

sync
test -s "$MOUNT/.DS_Store" || fail_dmg_layout "DMG layout was not applied (missing or empty .DS_Store)"

# Rename the volume to the release-facing name now that layout is applied.
# The build used a build-unique volname to disambiguate Finder's `tell disk`
# under concurrent runs; renaming in-place before detach lets the UDZO convert
# carry the polished `Mouthpiece <version>` label to end users.
diskutil renameVolume "$MOUNT" "$VOLNAME_FINAL" >/dev/null

# Detach by device node: the rename above moved the volume to
# /Volumes/$VOLNAME_FINAL, so "$MOUNT" no longer resolves. Clearing DEV_NODE
# keeps the exit trap from trying to detach an image that is already gone.
hdiutil detach "$DEV_NODE" || hdiutil detach "$DEV_NODE" -force
DEV_NODE=

rm -f "$DMG"
hdiutil convert "$RW_DMG" -format UDZO -imagekey zlib-level=9 -o "$DMG"
rm "$STAGING/Applications"

# Emit checksums with bare basenames so downstream `shasum -c` can verify from
# whatever directory the artifacts land in; the previous absolute-path form
# baked the build machine's `/Users/runner/.../artifacts/...` into the sha256
# file and made `-c` fail unless consumers reproduced that exact tree.
(
  cd "$ROOT/$OUTPUT"
  shasum -a 256 \
    "Mouthpiece-$VERSION-$ARCH-mac.zip" \
    "Mouthpiece-$VERSION-$ARCH.dmg" \
    > "Mouthpiece-$VERSION-$ARCH.sha256"
)
scripts/verify-native-artifact.sh "$DMG" "$ARCH"
echo "Created native $ARCH release artifacts in $OUTPUT"
