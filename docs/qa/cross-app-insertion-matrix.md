# Cross-App Insertion Matrix

This matrix documents the first compatibility-profile rollout for Phase 6 Task 7.
It keeps retry policy and degraded fallback behavior explicit so insertion failures can be triaged without reading platform code.

| Profile | App Family Examples | Expected Insertion Mode | Retry Policy | Degraded Mode | Known Gap |
| --- | --- | --- | --- | --- | --- |
| `browser_text_input` | Chrome, Safari, Firefox, Arc, Edge | `replace_preferred` | 2 auto-paste attempts, 140ms backoff | Clipboard copy allowed with manual paste hint | Rich `contenteditable` fields can still reject simulated paste intermittently |
| `electron_editor` | Notion, Obsidian, Linear, Postman, Figma | `intent_driven` | 2 auto-paste attempts, 120ms backoff | Clipboard copy allowed with editor refocus hint | Embedded editors can steal focus after overlay restoration |
| `chat_app` | Slack, Discord, Teams, Telegram, WeChat, WhatsApp | `replace_preferred` | 2 auto-paste attempts, 120ms backoff | Clipboard copy allowed with compose-box recovery hint | Slash commands and mention pickers may replace selection |
| `document_editor` | Word, Pages, Google Docs, Craft, Bear | `intent_driven` | 2 auto-paste attempts, 180ms backoff | Clipboard copy allowed with caret-position hint | Heavy editors can delay focus after window switching |
| `terminal_ide` | Terminal, iTerm, Warp, Ghostty, Cursor, VS Code, IntelliJ | `manual_review` | No auto retry beyond first attempt | Unverified automation is downgraded to clipboard-only | Avoids accidental command execution when focus cannot be verified safely |
| `generic` | Unknown text fields | `intent_driven` | 2 auto-paste attempts, 120ms backoff | Clipboard copy allowed with generic paste hint | Generic assumptions remain until explicit profiling is added |

## QA Notes

- Treat `compatibilityProfileId`, `feedbackCode`, and `retryCount` as the primary telemetry hooks for regression analysis.
- Terminal and IDE surfaces intentionally favor honesty over aggressiveness: if the automation path is unverified, Mouthpiece should keep the dictation visible and ask for manual paste.
- Sensitive-app hard blocks belong to Phase 7 privacy policy, not this matrix.
