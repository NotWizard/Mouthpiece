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
VOLNAME="Mouthpiece $VERSION"
MOUNT="/Volumes/$VOLNAME"
RW_DMG="$ROOT/.build/release/rw-$ARCH.dmg"
BG_SRC="$ROOT/Native/Packaging/dmg-background.png"
BG_1X="$ROOT/.build/release/dmg-bg-1x-$ARCH.png"

ln -s /Applications "$STAGING/Applications"
hdiutil detach "$MOUNT" 2>/dev/null || true
rm -f "$RW_DMG"

STAGING_KB=$(du -sk "$STAGING" | awk '{ print $1 }')
IMAGE_MB=$(( STAGING_KB / 1024 + 60 ))
hdiutil create -volname "$VOLNAME" -srcfolder "$STAGING" -fs HFS+ \
  -format UDRW -size "${IMAGE_MB}m" -ov "$RW_DMG"
hdiutil attach "$RW_DMG" -mountpoint "$MOUNT" -nobrowse -noverify -noautoopen

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
  tell disk "$VOLNAME"
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
  hdiutil detach "$MOUNT" 2>/dev/null || true
  exit 1
}

if ! apply_dmg_layout; then
  echo "Finder DMG layout failed; retrying once" >&2
  sleep 5
  apply_dmg_layout || fail_dmg_layout "Finder DMG layout failed after retry"
fi

# Read the layout back from Finder: icon positions and the background picture
# must match what was set above, so a half-applied layout cannot go out.
# The window was closed after applying, and a closed container window has no
# items (-1728 on CI), so reopen it for the readback and close it again.
read_dmg_layout() {
  osascript <<OSA
tell application "Finder"
  tell disk "$VOLNAME"
    open
    delay 1
    set appPosition to position of item "Mouthpiece.app" of container window
    set linkPosition to position of item "Applications" of container window
    set backgroundPath to (background picture of icon view options of container window) as text
    close
  end tell
end tell
return ((item 1 of appPosition) as text) & "," & ((item 2 of appPosition) as text) & " " & ((item 1 of linkPosition) as text) & "," & ((item 2 of linkPosition) as text) & " " & backgroundPath
OSA
}

if ! LAYOUT=$(read_dmg_layout); then
  echo "DMG layout readback failed; retrying once" >&2
  sleep 5
  LAYOUT=$(read_dmg_layout) || fail_dmg_layout "DMG layout readback failed after retry"
fi
case "$LAYOUT" in
  "161,210 472,210 "*".background:background.tiff") ;;
  *) fail_dmg_layout "DMG layout readback mismatch: expected '161,210 472,210 *.background:background.tiff', got '$LAYOUT'" ;;
esac

sync
test -s "$MOUNT/.DS_Store" || fail_dmg_layout "DMG layout was not applied (missing or empty .DS_Store)"
hdiutil detach "$MOUNT" || hdiutil detach "$MOUNT" -force

rm -f "$DMG"
hdiutil convert "$RW_DMG" -format UDZO -imagekey zlib-level=9 -o "$DMG"
rm -f "$RW_DMG"
rm "$STAGING/Applications"

shasum -a 256 "$ZIP" "$DMG" > "$ROOT/$OUTPUT/Mouthpiece-$VERSION-$ARCH.sha256"
scripts/verify-native-artifact.sh "$DMG" "$ARCH"
echo "Created native $ARCH release artifacts in $OUTPUT"
