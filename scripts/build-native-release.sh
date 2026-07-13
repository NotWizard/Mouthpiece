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
ln -s /Applications "$STAGING/Applications"
hdiutil create -volname "Mouthpiece $VERSION" -srcfolder "$STAGING" \
  -ov -format UDZO "$DMG"
rm "$STAGING/Applications"

shasum -a 256 "$ZIP" "$DMG" > "$ROOT/$OUTPUT/Mouthpiece-$VERSION-$ARCH.sha256"
scripts/verify-native-artifact.sh "$DMG" "$ARCH"
echo "Created native $ARCH release artifacts in $OUTPUT"
