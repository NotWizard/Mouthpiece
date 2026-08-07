#!/bin/bash
set -euo pipefail

VERSION=${1#v}
PROJECT_VERSION=$(awk '/MARKETING_VERSION:/ { print $2; exit }' project.yml)

# minor/patch are capped at 99 because BUILD_NUMBER = major*10000 + minor*100 + patch
# (scripts/build-native-release.sh); a third digit would collide with the next slot.
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]{1,2}\.[0-9]{1,2}$ ]]; then
  echo "Invalid semantic version: $VERSION (minor and patch must be 0-99; BUILD_NUMBER packs them as major*10000 + minor*100 + patch)" >&2
  exit 1
fi

if [ "$PROJECT_VERSION" != "$VERSION" ]; then
  echo "Release version $VERSION does not match project.yml MARKETING_VERSION $PROJECT_VERSION" >&2
  exit 1
fi

NOTES="docs/releases/v${VERSION}.md"
if [ ! -f "$NOTES" ]; then
  echo "Missing bilingual release notes: $NOTES" >&2
  exit 1
fi

echo "$VERSION"
