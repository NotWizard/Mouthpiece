#!/bin/bash
set -euo pipefail

APP_PATH=$1
IDENTITY=${MAC_SELFSIGN_IDENTITY:-Mouthpiece Code Signing}
EXPECTED_SHA1=${MAC_SELFSIGN_CERT_SHA1:-DB4FFD2432826CB4DA396D12CD2B3193E51448D7}
EXPECTED_SHA256=${MAC_SELFSIGN_CERT_SHA256:-AD386695155758F30DEDDDCE3A88022E3A74D2B6B60CD368FD0994DE677BA04F}
ENTITLEMENTS=${2:-Native/Resources/Mouthpiece.entitlements}

ACTUAL_SHA1=$(security find-certificate -c "$IDENTITY" -Z 2>/dev/null \
  | awk '/SHA-1 hash:/ { print toupper($3); exit }' || true)
if [ "$ACTUAL_SHA1" != "$EXPECTED_SHA1" ]; then
  echo "Signing certificate fingerprint mismatch. Expected $EXPECTED_SHA1, found ${ACTUAL_SHA1:-none}." >&2
  exit 1
fi

CERTIFICATE_PEM=$(mktemp)
trap 'rm -f "$CERTIFICATE_PEM"' EXIT
security find-certificate -c "$IDENTITY" -p > "$CERTIFICATE_PEM"
ACTUAL_SHA256=$(openssl x509 -in "$CERTIFICATE_PEM" -noout -fingerprint -sha256 \
  | awk -F= '{ gsub(":", "", $2); print toupper($2) }')
if [ "$ACTUAL_SHA256" != "$EXPECTED_SHA256" ]; then
  echo "Signing certificate SHA-256 mismatch. Expected $EXPECTED_SHA256, found ${ACTUAL_SHA256:-none}." >&2
  exit 1
fi

while IFS= read -r item; do
  codesign --force --sign "$IDENTITY" --options runtime --timestamp=none "$item"
done < <(find "$APP_PATH/Contents" -type f \( -perm -111 -o -name '*.dylib' \) | sort)

while IFS= read -r item; do
  codesign --force --sign "$IDENTITY" --options runtime --timestamp=none "$item"
done < <(find "$APP_PATH/Contents" -depth \( -name '*.xpc' -o -name '*.framework' -o -name '*.app' \) -type d | sort -r)

codesign --force --sign "$IDENTITY" --options runtime --timestamp=none \
  --entitlements "$ENTITLEMENTS" "$APP_PATH"
codesign --verify --deep --strict --verbose=2 "$APP_PATH"

EXPECTED_LOWER=$(printf '%s' "$EXPECTED_SHA1" | tr '[:upper:]' '[:lower:]')
EXPECTED_REQUIREMENT="identifier \"com.mouthpiece.app\" and certificate root = h\"$EXPECTED_LOWER\""
REQUIREMENT=$(codesign -d -r- "$APP_PATH" 2>&1 \
  | sed -n 's/^designated => //p' \
  | tr '[:upper:]' '[:lower:]')
if [ "$REQUIREMENT" != "$EXPECTED_REQUIREMENT" ]; then
  echo "Unexpected Designated Requirement: $REQUIREMENT" >&2
  exit 1
fi

codesign --verify --strict -R="identifier \"com.mouthpiece.app\" and certificate root = H\"$EXPECTED_SHA1\"" "$APP_PATH"
while IFS= read -r item; do
  codesign --verify --strict -R="certificate root = H\"$EXPECTED_SHA1\"" "$item"
done < <(find "$APP_PATH/Contents" -type f \( -perm -111 -o -name '*.dylib' \) | sort)
while IFS= read -r item; do
  codesign --verify --strict -R="certificate root = H\"$EXPECTED_SHA1\"" "$item"
done < <(find "$APP_PATH/Contents" -depth \( -name '*.xpc' -o -name '*.framework' -o -name '*.app' \) -type d | sort)
echo "Signed $APP_PATH with stable Designated Requirement."
