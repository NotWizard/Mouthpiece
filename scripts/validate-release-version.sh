#!/bin/bash
set -euo pipefail

VERSION=${1#v}
PROJECT_VERSION=$(awk '/MARKETING_VERSION:/ { print $2; exit }' project.yml)

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Invalid semantic version: $VERSION" >&2
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
