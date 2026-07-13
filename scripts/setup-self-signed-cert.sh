#!/bin/bash
# Generates a self-signed code-signing certificate for Mouthpiece releases.
#
# Why this exists: macOS TCC (Accessibility, Microphone, etc.) keys grants on the
# app's code-signing Designated Requirement. Ad-hoc signing recomputes the cdhash
# every build, which invalidates TCC grants. Signing every release with the SAME
# self-signed certificate keeps the DR stable and TCC grants persist across
# updates -- without an Apple Developer ID.
#
# Run this ONCE per machine. The resulting .p12 should be backed up to a password
# manager and uploaded to GitHub Actions secrets (MAC_SELFSIGN_CERT_BASE64 +
# MAC_SELFSIGN_CERT_PASSWORD). Losing the .p12 forces all users to re-grant TCC
# permissions -- inconvenient but recoverable by generating a new cert.
#
# Outputs:
#   ~/.mouthpiece-signing/signing.p12          PKCS#12 bundle (cert + key)
#   ~/.mouthpiece-signing/p12-password.txt     Random password for the .p12
#   ~/.mouthpiece-signing/signing.crt          Public cert (for inspection)
#   ~/.mouthpiece-signing/signing.crt.pem.b64  Base64-encoded .p12 ready for CI
#
# Usage: ./scripts/setup-self-signed-cert.sh

set -euo pipefail

CERT_DIR="${HOME}/.mouthpiece-signing"
COMMON_NAME="Mouthpiece Code Signing"
ORG="Mouthpiece"
VALIDITY_DAYS=3650 # 10 years

if [ -f "${CERT_DIR}/signing.p12" ]; then
  echo "ERROR: ${CERT_DIR}/signing.p12 already exists."
  echo "  If you really want to regenerate (which forces all users to re-grant"
  echo "  TCC permissions), delete the directory manually first:"
  echo "    rm -rf ${CERT_DIR}"
  exit 1
fi

mkdir -p "${CERT_DIR}"
chmod 700 "${CERT_DIR}"

echo "▸ Generating random .p12 password..."
P12_PASSWORD="$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 40)"
printf '%s' "${P12_PASSWORD}" > "${CERT_DIR}/p12-password.txt"
chmod 600 "${CERT_DIR}/p12-password.txt"

echo "▸ Writing OpenSSL config..."
cat > "${CERT_DIR}/cert.cnf" <<EOF
[ req ]
distinguished_name = req_dn
prompt = no
x509_extensions = v3_codesign

[ req_dn ]
CN = ${COMMON_NAME}
O  = ${ORG}

[ v3_codesign ]
basicConstraints     = critical, CA:false
keyUsage             = critical, digitalSignature
extendedKeyUsage     = critical, codeSigning
subjectKeyIdentifier = hash
EOF

echo "▸ Generating 2048-bit RSA private key..."
openssl genrsa -out "${CERT_DIR}/signing.key" 2048 2>/dev/null

echo "▸ Generating self-signed code-signing certificate (${VALIDITY_DAYS} days)..."
openssl req -new -x509 \
  -key "${CERT_DIR}/signing.key" \
  -out "${CERT_DIR}/signing.crt" \
  -days "${VALIDITY_DAYS}" \
  -config "${CERT_DIR}/cert.cnf" \
  -sha256

echo "▸ Bundling cert + key into PKCS#12..."
openssl pkcs12 -export \
  -inkey "${CERT_DIR}/signing.key" \
  -in    "${CERT_DIR}/signing.crt" \
  -name  "${COMMON_NAME}" \
  -out   "${CERT_DIR}/signing.p12" \
  -passout "pass:${P12_PASSWORD}" \
  -macalg sha256

echo "▸ Encoding .p12 to base64 for CI upload..."
base64 -i "${CERT_DIR}/signing.p12" -o "${CERT_DIR}/signing.p12.base64"

chmod 600 "${CERT_DIR}/signing.p12" \
          "${CERT_DIR}/signing.key" \
          "${CERT_DIR}/signing.p12.base64"

echo "▸ Verifying cert has codeSigning EKU..."
if openssl x509 -in "${CERT_DIR}/signing.crt" -noout -ext extendedKeyUsage 2>/dev/null \
   | grep -q "Code Signing"; then
  echo "  ✓ codeSigning EKU present"
else
  echo "  ✗ codeSigning EKU missing -- this won't sign"
  exit 1
fi

echo ""
echo "================================================================"
echo "✅  Self-signed code-signing cert generated"
echo "================================================================"
echo ""
echo "Files (chmod 600, in ${CERT_DIR}):"
echo "  signing.p12             ← upload to CI (MAC_SELFSIGN_CERT_BASE64)"
echo "  signing.p12.base64      ← already encoded, ready for gh secret set"
echo "  p12-password.txt        ← upload to CI (MAC_SELFSIGN_CERT_PASSWORD)"
echo "  signing.crt             ← public cert, for inspection"
echo "  signing.key             ← private key (do NOT share)"
echo ""
echo "Cert details:"
openssl x509 -in "${CERT_DIR}/signing.crt" -noout -subject -issuer -dates -fingerprint -sha256
echo ""
echo "⚠️  CRITICAL: Back up signing.p12 + p12-password.txt to a password manager."
echo "    If lost, all users have to re-grant TCC permissions on the next release."
echo ""
echo "Next steps:"
echo "  1. Upload to GitHub Secrets via:"
echo "       gh secret set MAC_SELFSIGN_CERT_BASE64 --repo NotWizard/Mouthpiece \\"
echo "         --body \"\$(cat ${CERT_DIR}/signing.p12.base64)\""
echo "       gh secret set MAC_SELFSIGN_CERT_PASSWORD --repo NotWizard/Mouthpiece \\"
echo "         --body \"\$(cat ${CERT_DIR}/p12-password.txt)\""
echo "  2. Verify scripts/sign-native-app.sh + release.yml (see code-signing-runbook.md)"
