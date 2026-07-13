# Native macOS code-signing runbook

Mouthpiece 没有 Apple Developer ID。所有正式构建必须使用同一张自签名证书，使 macOS TCC 看到稳定的 Designated Requirement，从而在覆盖安装、Sparkle 更新和 Homebrew reinstall 后尽量保留麦克风及辅助功能权限。

## 固定身份

| 项目 | 值 |
| --- | --- |
| Certificate CN | `Mouthpiece Code Signing` |
| Certificate SHA-1 | `DB4FFD2432826CB4DA396D12CD2B3193E51448D7` |
| Certificate SHA-256 | `AD386695155758F30DEDDDCE3A88022E3A74D2B6B60CD368FD0994DE677BA04F` |
| Bundle ID | `com.mouthpiece.app` |
| App name | `Mouthpiece.app` |
| Install path | `/Applications/Mouthpiece.app` |
| Expiry | 2036-05-13 |

预期 Designated Requirement：

```text
identifier "com.mouthpiece.app" and certificate root = H"db4ffd2432826cb4da396d12cd2b3193e51448d7"
```

以上证书、Bundle ID、应用名称和安装路径都不得在普通发布中改变。任何变化都会使 TCC 将新版本视为另一应用。

## GitHub Secrets

- `MAC_SELFSIGN_CERT_BASE64`
- `MAC_SELFSIGN_CERT_PASSWORD`
- `SPARKLE_PRIVATE_KEY`
- `HOMEBREW_TAP_TOKEN`，或具备 tap 写权限的 `GH_TOKEN`

`scripts/setup-self-signed-cert.sh` 仅用于灾难恢复或计划轮换。日常发布不得重新生成证书。

## Release workflow

`.github/workflows/release.yml` 会执行：

1. 将 PKCS#12 导入临时 Keychain，并把公钥证书设为 code-signing trust root。
2. 构建未签名的 arm64 或 x86_64 Xcode archive。
3. 从内到外签名所有 Mach-O、dylib、XPC、framework 和主 App。
4. 校验证书 SHA-1、SHA-256、所有嵌套代码、`codesign --verify --deep --strict` 和完整 Designated Requirement。
5. 验证 DMG 完整性、目标架构、macOS 15 最低版本、Gatekeeper 评估和隔离数据目录下的启动冒烟测试。
6. 在 `macos-15` 与 `macos-26` runner 运行 XCTest，再使用 EdDSA 生成 Sparkle appcast，发布 GitHub Release 与 Homebrew cask。
7. 删除 runner 上的临时 Keychain 和证书文件。

签名不是 notarization。自签名应用通过 Homebrew 安装时由 cask 移除 quarantine；手动下载仍可能需要用户在 Finder 中右键打开。

## 本地验证

```bash
codesign --verify --deep --strict --verbose=2 /Applications/Mouthpiece.app
codesign -d -r- /Applications/Mouthpiece.app 2>&1
security find-certificate -c "Mouthpiece Code Signing" -Z
security find-certificate -c "Mouthpiece Code Signing" -p | openssl x509 -noout -fingerprint -sha256
```

如果 Requirement 出现 `cdhash` 而不是固定 certificate root，必须停止发布。ad-hoc 签名会在下一次更新时改变身份并导致权限重新授权。
