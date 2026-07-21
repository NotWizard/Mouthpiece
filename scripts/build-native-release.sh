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

osascript <<OSA || true
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

sync
test -f "$MOUNT/.DS_Store" || { echo "DMG layout was not applied (no .DS_Store)" >&2; hdiutil detach "$MOUNT" 2>/dev/null || true; exit 1; }
hdiutil detach "$MOUNT" || hdiutil detach "$MOUNT" -force

rm -f "$DMG"
hdiutil convert "$RW_DMG" -format UDZO -imagekey zlib-level=9 -o "$DMG"
rm -f "$RW_DMG"
rm "$STAGING/Applications"

shasum -a 256 "$ZIP" "$DMG" > "$ROOT/$OUTPUT/Mouthpiece-$VERSION-$ARCH.sha256"
scripts/verify-native-artifact.sh "$DMG" "$ARCH"
echo "Created native $ARCH release artifacts in $OUTPUT"
