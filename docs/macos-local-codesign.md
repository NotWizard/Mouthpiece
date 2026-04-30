# macOS Local Codesign

Mouthpiece can use a local self-signed Code Signing certificate to make development builds more stable with macOS Accessibility permissions. This is only for local development or tightly controlled testing. It does not replace Apple Developer ID signing or notarization for public distribution.

## Create the Local Certificate

1. Open Keychain Access.
2. Choose Certificate Assistant, then Create a Certificate.
3. Use the name `Mouthpiece Local Codesign`.
4. Set Identity Type to Self Signed Root.
5. Set Certificate Type to Code Signing.
6. Create the certificate in the login keychain.
7. Open the certificate, set Trust to Always Trust for Code Signing, then save.

Keep this certificate and private key. If you replace it, macOS may treat future builds as a different app and Accessibility permission may need to be granted again.

## Build and Sign Locally

Run:

```bash
npm run pack:mac:local
```

The script packages an unsigned macOS app, signs nested Electron helper apps, frameworks, and Mouthpiece helper binaries first, then signs `Mouthpiece.app` with `resources/mac/entitlements.mac.plist`.

You can override the identity:

```bash
MOUTHPIECE_LOCAL_CODESIGN_IDENTITY="My Local Code Signing Certificate" npm run pack:mac:local
```

You can also sign an explicit app path:

```bash
node scripts/sign-macos-local.js /Applications/Mouthpiece.app
```

## Permission Stability

Accessibility permission is most stable when these stay the same:

- Bundle identifier: `com.mouthpiece.app`
- Signing identity: the same `Mouthpiece Local Codesign` certificate
- App path: preferably `/Applications/Mouthpiece.app`
- Nested helper signatures: signed with the same identity as the main app

Moving the app, changing the certificate, changing the bundle id, switching from self-signed to Developer ID, or resetting TCC with `tccutil reset Accessibility` can require another authorization.

## Distribution Boundary

Self-signed codesign helps local macOS recognize a consistent app identity, but it does not make the app trusted by Gatekeeper on other machines. Public distribution should use Apple Developer ID signing and notarization.
