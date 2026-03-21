# ASR Quality Checklist

## Replay benchmark summary

- Run `npm run replay:asr -- --output tmp/asr-replay.json`.
- Run `npm run verify:asr-benchmarks`.
- Confirm the generated benchmark report is either `passed` or an explicitly explained `skipped`.
- If replay data is missing, record why the fixture corpus is unavailable before shipping.

## Insertion smoke matrix

- Verify insertion in at least one browser textarea, one Electron editor, one chat app, and one document editor.
- Check direct insert, replace-selection, and fallback-copy behavior where the app family supports them.
- Confirm undo behavior remains user-understandable after insertion.
- Record any app-specific degraded mode in the cross-app insertion matrix before release.

## Sensitive app review

- Confirm sensitive-app rules cover finance, password, admin, and authentication-heavy surfaces.
- Confirm auto-learn, paste monitoring, and cloud routing respect the current sensitive-app policy.
- Confirm debug logs redact dictated text, clipboard payloads, and API keys.
- Confirm privacy-facing copy matches the actual runtime behavior for blocked or downgraded flows.

## Rollback criteria

- Roll back if replay verification returns `failed`.
- Roll back if insertion smoke coverage exposes a regression in a high-value app family.
- Roll back if privacy or sensitive-app policy behavior is bypassed.
- Roll back if release assets are incomplete or quality summaries are missing.
