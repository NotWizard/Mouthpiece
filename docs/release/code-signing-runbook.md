# Code Signing Runbook

Mouthpiece is signed with a **self-signed code-signing certificate** instead of an Apple Developer ID. This keeps the codesign Designated Requirement (DR) stable across releases, which is what `TCC` (Accessibility / Microphone permissions) keys grants on. Without a stable DR, every update would force users to re-grant permissions.

This document covers the lifecycle: generation, CI integration, rotation, recovery.

## Key facts

| Item | Value |
|---|---|
| Cert Common Name (CN) | `Mouthpiece Code Signing` |
| Validity | 10 years (regenerate before expiry) |
| Algorithm | RSA 2048, SHA-256 |
| Extended Key Usage | `Code Signing` (critical) |
| Key location on dev machine | `~/.mouthpiece-signing/signing.p12` |
| Encrypted by | Random 40-character password, stored in `~/.mouthpiece-signing/p12-password.txt` |
| GitHub Secrets | `MAC_SELFSIGN_CERT_BASE64`, `MAC_SELFSIGN_CERT_PASSWORD`, `MAC_SELFSIGN_IDENTITY` |
| Bundle ID (must not change) | `com.mouthpiece.app` |
| App name (must not change) | `Mouthpiece` |
| Install path (must not change) | `/Applications/Mouthpiece.app` |

Changing any of the three "must not change" values rotates the TCC row and forces every user to re-grant permissions on their next update.

## How TCC persistence works (one-paragraph version)

`TCC.db` stores `(service, client, csreq)` where `csreq` is a serialized **Designated Requirement**. With a self-signed cert the DR looks like:

```
identifier "com.mouthpiece.app" and certificate root = H"<sha1-of-cert>"
```

As long as every release is signed with the **same** cert, the DR matches and grants persist. With ad-hoc signing the DR uses `cdhash`, which changes on every build, so grants are dropped on every update.

Sources: Apple TN3127 (Inside Code Signing: Requirements); Howard Oakley's `eclecticlight.co` code-signing series.

## Initial generation (already done — for reference / disaster recovery)

Run on a Mac:

```bash
./scripts/setup-self-signed-cert.sh
```

The script:

1. Generates 2048-bit RSA key + 10-year self-signed X.509 cert with `Code Signing` EKU
2. Bundles into PKCS#12 (`signing.p12`) with a random 40-char password
3. Outputs everything (chmod 600) to `~/.mouthpiece-signing/`
4. Prints the SHA-256 fingerprint

Verify locally:

```bash
openssl x509 -in ~/.mouthpiece-signing/signing.crt -noout -subject -dates -fingerprint -sha256
```

## Upload to GitHub Secrets

```bash
CERT_DIR="$HOME/.mouthpiece-signing"
gh secret set MAC_SELFSIGN_CERT_BASE64 \
  --repo NotWizard/Mouthpiece \
  --body "$(cat $CERT_DIR/signing.p12.base64)"
gh secret set MAC_SELFSIGN_CERT_PASSWORD \
  --repo NotWizard/Mouthpiece \
  --body "$(cat $CERT_DIR/p12-password.txt)"
gh secret set MAC_SELFSIGN_IDENTITY \
  --repo NotWizard/Mouthpiece \
  --body "Mouthpiece Code Signing"
```

## Backup (CRITICAL)

The `signing.p12` and password are the **only** copies of the signing material in existence. If lost:

- Every Mouthpiece user has to re-grant Accessibility + Microphone the next time they update (one-time pain, not a security failure).
- You'll need to regenerate the cert and rotate the GitHub secrets.

**Back up to a password manager** (1Password, Bitwarden, etc.) immediately after generation:

- Paste the contents of `signing.p12.base64` and `p12-password.txt`
- Tag both with `mouthpiece` and `code-signing`

If the dev machine is wiped, decode the base64 back to `signing.p12`, save with the password, and you're whole again.

## How CI uses it

`.github/workflows/release.yml` `build-macos` job:

1. `MAC_SIGNING_ENABLED` env var is `true` iff both `MAC_SELFSIGN_CERT_BASE64` and `MAC_SELFSIGN_CERT_PASSWORD` secrets are set.
2. Step `Setup macOS Code Signing (self-signed)` decodes the base64, creates a temporary keychain, imports the .p12 into it, sets the partition list so codesign doesn't prompt.
3. Step `Build Application` runs `electron-builder --mac --publish always` with `CSC_IDENTITY_AUTO_DISCOVERY=true` and `CSC_KEY_PASSWORD=$MAC_SELFSIGN_CERT_PASSWORD`. `electron-builder.json` has `"identity": "Mouthpiece Code Signing"` so builder finds the right identity in the keychain.
4. Step `Verify Designated Requirement` runs `codesign -d -r-` on the built `.app` and **fails the build** if the DR doesn't reference the certificate (i.e., if signing silently fell back to ad-hoc).
5. Step `Cleanup Certificates` deletes the temporary keychain and .p12.

## Local builds

For local development:

- `npm run dev` does **not** sign at all — Electron runs from source.
- `npm run pack` (per `CSC_IDENTITY_AUTO_DISCOVERY=false`) produces an unsigned local build.
- `npm run build:mac` from a developer machine **with** the cert in your login keychain will sign with the same identity as CI.

## First release after switching to self-signed (one-time disruption)

The release that **first** uses self-signed signing (e.g., the upgrade from v1.2.0 ad-hoc to v1.3.0 self-signed) **will** force users to re-grant TCC permissions, because the DR is changing from `cdhash H"..."` to `certificate root = H"..."`. Going forward, every release after that retains all grants.

Communicate this clearly in the v1.3.0 release notes:

> "After updating to v1.3.0, you'll be asked to re-grant Accessibility (and Microphone, if you use voice dictation) one final time. Mouthpiece now uses a stable code-signing identity, so future updates will not require re-granting."

## Rotation / renewal

The cert is valid until **2036-05-13**.

To rotate (planned, before expiry):

1. Generate a new cert (delete `~/.mouthpiece-signing/` first to bypass the safety check)
2. Upload new secrets via the gh commands above
3. Cut a new release
4. Communicate to users that this release will require one-time re-grant

To rotate (emergency, e.g., key compromised):

1. Generate new cert
2. Upload new secrets
3. Revoke the old cert from your keychain (cosmetic — clients have no revocation infra)
4. Cut a release ASAP

Note: there's no CRL or OCSP for self-signed certs. A "compromised" .p12 means an attacker could sign their own builds claiming to be Mouthpiece. For a low-stakes desktop app this is an acceptable risk; for higher-stakes apps you'd want HSM-backed signing.

## Verifying a build's DR

After a release publishes, verify the DR on the installed `.app`:

```bash
codesign -d -r- /Applications/Mouthpiece.app 2>&1
```

Expected output contains:

```
designated => identifier "com.mouthpiece.app" and certificate root = H"<some hex>"
```

If you see `cdhash H"..."` instead, the build is ad-hoc and TCC will reset on next update — investigate the workflow's `Setup macOS Code Signing (self-signed)` step.

## Why we don't notarize

Notarization requires an Apple Developer ID Application certificate ($99/year). Notarization is **independent** of TCC — it's a Gatekeeper-only mechanism that proves Apple scanned your binaries and didn't find malware.

Without notarization:

- ✓ TCC permissions persist across updates (this runbook)
- ✗ macOS shows "unidentified developer" warning on first launch
- ✗ macOS shows "checking against malicious software" delay on first launch
- ✓ Mitigation: Homebrew cask runs `xattr -dr com.apple.quarantine` postflight, which **completely silences** the unidentified-developer warning for cask installations

Manual `.dmg` downloads (outside Homebrew) still show the warning. To open: right-click → Open → "Open Anyway".

## Related files

- `scripts/setup-self-signed-cert.sh` — cert generation script
- `electron-builder.json` — `mac.identity: "Mouthpiece Code Signing"`
- `.github/workflows/release.yml` — `build-macos` job
- `scripts/lib/release-update-metadata.mjs` — `renderHomebrewCask()` produces the postflight
- `tests/update-release-assets.test.mjs` — tests cask renderer including postflight
