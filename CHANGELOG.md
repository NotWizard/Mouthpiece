# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

> Note: Version numbering restarts at `1.0.0` for this standalone Mouthpiece repository. The `1.5.x` entries below are retained as inherited upstream reference only.

### Changed

- **Atmosphere and sidebar opacity tuned closer to the demo so orb colors come through more clearly.** The atmosphere had been dialed back from `0.78` to `0.42` orb opacity to fix earlier "rainbow over-saturation", but the resulting page read noticeably duller than `liquid-glass-preview.html` (which uses `0.85` orbs + `0.55` sidebar). Returning halfway: `--glass-orb-opacity` goes `0.42 → 0.60` (light) / `0.32 → 0.45` (dark), and `--mp-control-sidebar-bg` drops `0.62 → 0.50` (light) / `0.50 → 0.42` (dark) so the sidebar lets more of the orb wash refract through. The onboarding override (which was `0.55`, intentionally more vivid than the previous control-panel value) keeps that emphasis by going `0.55 → 0.70`. CSS tokens only — no JSX or component change.
- **History date separators are now sticky glass pills with a per-day timeline rail.** The previous full-width sticky bar (a 11 px uppercase muted-foreground label inside `.history-date-header`) read as just another row in the list — it had no contrast against `.transcription-list-item` and "今天" / "2026年4月30日" were typographically interchangeable. Each day group is now a `.history-day-group` containing (a) a `.history-date-pill` — a tinted glass pill (linear-gradient `rgba(56,116,240, 0.14 → 0.06)` light, `rgba(122,166,255, 0.18 → 0.08)` dark) with a 1 px primary border, inset specular highlight, and `backdrop-filter: blur(20px) saturate(180%)` — that holds a 6 px primary dot, a primary-colored 12 px / 700 weight `primary` label, and a muted 11.5 px `secondary` label. The pill is `position: sticky; top: 8px; z-index: 12;` so when the user scrolls through a day's items the date stays anchored, then gets pushed away by the next group's pill. (b) A `.history-day-items` block holding the actual `<TranscriptionItem>` rows, with a `::before` 2 px rail running down its left edge — `linear-gradient(180deg, primary 50% → 18% 75% → transparent)` — that visually clusters the day's items as a timeline. `formatDateGroup` (string-only) is replaced with `formatDateGroupParts(date, t, locale) → { key, primary, secondary? }`: today / yesterday surface "今天 / 昨天" as primary and "2026年5月16日 · 周六" as secondary; days within the last week surface the localized weekday ("周三") as primary and full date as secondary; older entries surface full date as primary and weekday as secondary. The `key` (`YYYY-M-D`) is now used for grouping identity instead of the rendered label, so language switches and same-label-different-day edge cases don't collide. No IPC, store, hook, or new translation key — `Intl.DateTimeFormat` already covers all 10 locales.
- **Intelligence page hides Prompt Studio when text cleanup is disabled.** The Prompt Studio block (查看 / 自定义 / 测试 tabs that ride on `<PromptStudio />` plus its section header) on the Intelligence settings page is now gated on the `useReasoningModel` toggle. When "启用文本整理 / Enable Text Cleanup" is OFF the entire prompt-studio area collapses, since the prompt is only consumed by the reasoning pipeline that the toggle gates — exposing it while cleanup is off was confusing and let users edit a prompt that wouldn't run. Toggling the switch back on instantly restores the section. Pure render-time conditional in `SettingsPage.tsx`'s `intelligence` case; no IPC, store, hook, validation, or i18n change.
- **Segmented selectors and form inputs gain three subtle visual cues.** (1) Selected tab pill — both the Cloud / Local mode toggle in TranscriptionModelPicker and the provider tabs in ProviderTabs (transcription, intelligence) — now renders as a primary-tinted glass pill (`linear-gradient` of `rgba(56, 116, 240, 0.13 → 0.07)` light, `rgba(122, 166, 255, 0.18 → 0.10)` dark) with an inset top highlight, replacing the previously flat `bg-card` white slab. The selected button text also picks up `var(--color-primary)` for visual coherence. (2) Inactive provider/mode logos are dimmed to `opacity: 0.55 + grayscale(0.25)` so the active brand naturally pops; selected returns to full color. (3) Filled inputs (any `<input>` or `<textarea>` matching `:not(:placeholder-shown):not(:focus)`) get a 2 px primary inset strip on their left edge so a configured field reads as configured at a glance — implemented as inset box-shadow so layout never shifts. ApiKeyInput.tsx adds a small `Saved` / `已保存` badge in the label row (`.api-key-saved-badge`) when the key value is non-empty, with new `apiKeyInput.savedBadge` translations in all 10 locales (en / zh-CN / zh-TW / de / es / fr / it / ja / pt / ru). The two indicator divs (ProviderTabs sliding pill + TranscriptionModelPicker mode-toggle pill) gain a `data-tab-indicator` attribute and the buttons gain `aria-selected` to drive the new CSS without chasing fragile Tailwind utility classes.
- **Sidebar matches the demo, and every settings page now opens with a real page header.** Sidebar polish: the `--mp-control-selected-bg` token in light mode flips from solid `#e8f1ff` to translucent `rgba(56, 116, 240, 0.14)` and `--mp-control-selected-text` is `#1e54d4` to align with `--color-primary`, so the active pill refracts the glass behind it the way the demo did instead of reading as a solid blue slab. Nav rail tightens up: `padding: 14px 10px 8px` → `6px 10px 8px`, `gap: 2px` → `1px`, item `min-height: 34px` → `32px`, plus explicit `font-size: 12.5px / 500 / -0.005em` so items hit the demo cadence. Hover swaps to `rgba(125, 135, 160, 0.1)` (matches the demo) and active hover uses `color-mix(... var(--color-foreground) 4%)` so it darkens consistently in both modes. The footer becomes a flex column with `gap: 1px` so the sparse-footer state (only Support visible) doesn't read as half-empty. New `.settings-page-header` CSS class (h2 20 px / 700 / -0.02em + 13 px muted description, 14 px bottom padding plus a hairline) and a local `PageHeader` function in `SettingsPage.tsx`. `<PageHeader>` now sits at the top of every settings case — `general`, `hotkeys`, `transcription`, `intelligence`, `privacyData`, `system` — pulling `settingsModal.sections.X.label` and `settingsModal.sections.X.description` (the same i18n keys the sidebar already uses), so each page reads "Preferences / Appearance, sounds & startup" rather than dropping the user straight into a second-level "Appearance" SectionHeader. The transcription case had to wrap its delegated `<TranscriptionSection />` in a `space-y-6` container; intelligence and privacyData also gained the page header above their existing content. No IPC, store, hook, validation, or new i18n key — just visual structure. The plain `<p>{readableHotkey}</p>` line in `renderActivationStep` is now wrapped in `.activation-hero` — a centered block containing a `.activation-halo` (radial primary→purple gradient blurred 24 px, breathing 2.6 s loop with `activation-breathe` keyframe at 0.45→0.85 opacity / 0.96→1.06 scale) and a `.activation-keycap` (18 px / 600 weight, 14 px radius, layered glass: inset top + bottom highlights, 0.5 px hairline, 1 px close, 12 px diffuse, dark-mode equivalent included). When a `PermissionCard` flips into `permission-card-granted`, the inner check svg now plays the existing `check-pop` keyframe (0.55 s cubic-bezier overshoot) — the icon was already in place, this just ties it to a celebration animation. Both new animations inherit the global `prefers-reduced-motion` rule's `0.01ms` override, so accessibility is preserved. JSX touch is a single `<p>` swap; no IPC, no i18n, no new state. Phase OB-4 of the onboarding redesign.
- **Onboarding step rail gets per-step identity colors and a more spacious cadence.** `.wizard-step-pill` height grows from 34 px to 44 px, gap 4 → 6, font 12 → 13. `.wizard-step-icon` grows from 20 × 20 px (round) to 32 × 32 px (9 px squircle) with the inner svg bumped to 16 px. Each step's icon now carries its own gradient identity: permissions/Shield is blue→purple `#5b8df8 → #7b6cff` ("security"), hotkeySetup/Command is orange→amber `#ffa15e → #ff7245` ("action"), activation/Mic is green→teal `#4dd49e → #2db872` ("voice ready") — selectors target `:nth-child(1)`, `(3)`, `(5)` because connector divs are interleaved between pills. Active state amplifies the per-step shadow with a 3 px glow ring in the matching tint plus a `scale(1.04)` lift; completed state ringed in a muted success-green and the connector below uses a vertical success-tint gradient. CSS-only — no StepProgress JSX, OnboardingFlow logic, step copy, or i18n key was touched. Phase OB-3 of the onboarding redesign.
- **Onboarding auth step is now a hero glass card.** `.wizard-auth-panel` widens from 380 px to 480 px, radius lifts from 14 px to 18 px, padding becomes `36 32 28`, and a soft purple radial glow leaks from the upper-right corner to give the first-run moment a clear "this matters" beat. The Mouthpiece logo grows from 44 px to 64 px with a 16 px radius, an inset top highlight and a 12 px blue drop shadow that lifts it off the glass. The first `<p>` inside `.auth-setup-header` and `.email-verification-header` (the step title — covers all 6 branches across AuthenticationStep + EmailVerificationStep) now renders as a 22 px / 700 weight gradient sweep from `#3974ff` to `#a87dff` (atmosphere blue → purple), with the dark-mode pair lightened to `#6fa8ff` → `#c2a4ff`. CSS-only — no AuthenticationStep or EmailVerificationStep JSX, copy, validation, or i18n key was touched. Phase OB-2 of the onboarding redesign.
- **Onboarding wizard now sits on the same Liquid Glass atmosphere as the Control Panel.** The 4-orb atmosphere layer is mounted as the first child of `.onboarding-shell` and runs at `--glass-orb-opacity: 0.55` (vs the Control Panel's `0.42`) — onboarding is a once-per-install moment, so the atmosphere leans more vivid for first-impression weight. `.onboarding-shell` gained `position: relative` + `isolation: isolate` so the atmosphere can absolute-position behind everything via document order. `.wizard-rail-panel`, `.wizard-panel` and `.wizard-auth-panel` all now consume `var(--mp-card-shadow)` plus `backdrop-filter: blur(36px) saturate(135%)` and a 1 px specular `::before` highlight, with `border-radius` lifted from 8 px to 14 px so they match the Control Panel cards. `.wizard-footer` now blurs the panel bg at 28 px / saturate 160% with a 70% panel-bg color-mix, so it reads as a frosted action bar instead of a flat slab. CSS-only plus a single 6-line atmosphere injection in `OnboardingFlow.tsx` — no step content, validation, copy, IPC, or routing changed. Phase OB-1 of the onboarding Liquid Glass redesign.
- **Liquid Glass polish — atmosphere is now subtle, every card shares one elevation, and a couple of stragglers were brought into the system.** This pass tunes the demo→production gap reported on screenshots: (a) `.control-panel-titlebar` is now fully transparent so the seam between sidebar and main vanishes, (b) atmosphere orbs are halved in size (`60vw` → `min(36vw, 540px)` etc.) and dropped from `0.78` → `0.42` opacity light / `0.6` → `0.32` dark, with their internal `saturate(160%)` brought back to `100%` so they read as soft halos instead of dominant blobs, (c) glass surfaces saturate is `180%` → `135%` so refracted colors no longer get double-amplified, (d) the sidebar diagonal gloss loses `mix-blend-mode: overlay` (which was amplifying hue contrast) and drops to `0.18` opacity, (e) all card surfaces (`.history-panel`, `.history-empty`, `.settings-group`, `.dictionary-loose-card`, `.permission-card`, `.control-panel-banner`) now share a single `--mp-card-shadow` token — a 4-layer stack (inset top specular + 0.5 px hairline + 1 px close lift + 18 px diffuse drop) with separate dark-mode values that use `rgba(0,0,0,…)` instead of the previous `rgba(13,18,30,…)` so the elevation is actually visible against charcoal. Border-radius is unified to `14 px` across primary cards. The Phase-4 `[class*="bg-card"]` / `[class*="bg-surface-2"]` scope override now also applies `box-shadow`, `border-color`, and `border-radius`, so SettingsGroup, DeveloperSection, PromptStudio, TerminologySettingsCard etc. are visually identical to my CSS-defined cards. DictionaryView's populated-state header / input / chips / hint cluster is wrapped in a new `.dictionary-loose-card` glass surface (replacing the original "loose chips floating on bg" layout that read fine on a flat bg but not on the atmospheric one). ReasoningModelSelector's cloud-mode wrapper at line 839 — a `border border-border rounded-lg` with no background — gets a `bg-card/40` so the global override picks it up and it stops reading as a flat white slab on the Intelligence page. Phase 5 of the Liquid Glass restyle.
- **Permission cards, ModelCardList tiles and ProviderTabs containers now match the Liquid Glass system.** `.permission-card` gained a 12 px radius, a 1 px specular top edge, an inset highlight and the same `backdrop-filter` as panels. Inside `.control-panel-shell`, the Tailwind utilities `.bg-surface-1`, `.bg-surface-raised` and `dark:bg-surface-1` are now scope-overridden to translucent glass values plus a soft inset border, with separate light/dark variants — this propagates the glass treatment to ModelCardList default tiles and the ProviderTabs container without touching their JSX or the global Tailwind tokens (so dialogs, shadcn cards and the onboarding wizard remain untouched). Phase 4 of the Liquid Glass restyle.
- **Form inputs, the active sidebar item and history rows pick up the Liquid Glass material.** All `.control-panel-shell` inputs, textareas and select triggers now carry `backdrop-filter: blur(20px) saturate(160%)` plus an inset top highlight, with the focus glow becoming a layered `inset highlight + 3 px primary ring` and `[data-state="open"]` select triggers using the same focus state. The active sidebar item gained a 3-layer shadow (0.5 px tint border + inset highlight + soft primary glow), making it pop against the now-translucent sidebar. Transcription list rows gained an explicit `hover` background tinted via `color-mix(... var(--color-foreground) 4%)` so hover stays visible on the new transparent main area. CSS-only — no component, IPC, or i18n change. Phase 3 of the Liquid Glass restyle.
- **Control Panel sidebar and panels now refract the atmosphere as Liquid Glass.** The sidebar bumps from `blur(18px) saturate(140%)` to `blur(36px) saturate(180%)` and gains a 1 px specular top-edge highlight plus a soft diagonal gloss. The history panel, settings groups, settings inline cards, banner and date headers now all use `backdrop-filter` with the same blur/saturate, with semi-transparent fills so the atmosphere's color shows through. Card corner radius was lifted from 8 px to 14 px (12 px for banners, 10 px for inline cards) and a soft layered shadow replaces the previous flat `0 1px 2px`. No view, sidebar order, copy, or component structure changed — this is Phase 2 of the Liquid Glass restyle.
- **Control Panel now sits on a Liquid Glass atmosphere layer.** The window background gained four slowly-drifting pastel orbs (peach / lavender / blue / mint in light mode, deep purple / teal / wine in dark mode) sitting behind the sidebar and main content. The main scroll area is now transparent so cards float over the atmosphere instead of a flat slab. New `--glass-*` design tokens were added for use by subsequent Liquid Glass passes. The atmosphere respects `prefers-reduced-motion` and uses `pointer-events: none` so it can never block interactions. This is Phase 1 of a larger Liquid Glass restyle that preserves all existing UI structure, naming, and ordering.

### Fixed

- **Linux uninstaller and clipboard helper now match the current `mouthpiece` cache namespace.** `resources/linux/after-remove.sh` previously only cleaned `~/.cache/openwhispr/`, leaving the live `~/.cache/mouthpiece/` model directory behind on uninstall; it now removes both. `resources/linux-fast-paste.c` no longer claims an `openwhispr` D-Bus session token or registers its uinput device as `openwhispr-paste` — both identifiers are now `mouthpiece`, matching the rest of the runtime (the `gnomeShortcut` D-Bus service is `com.mouthpiece.App`).
- **History panel keeps its rounded top corners while scrolling, and the date scrim now matches the panel's atmospheric tint.** Two issues from the prior pass: (a) once the user started scrolling, the panel's rounded top corners disappeared because the panel itself was scrolling along with the outer `.control-panel-content-scroll` — the corners scrolled out of the visible viewport, leaving a flat top edge; (b) the sticky scrim was hard `rgba(255,255,255,0.96)` pure white, which read as a stark white strip against the panel's atmospheric pink/lavender wash. Fix is structural: the History view now scrolls **internally**. `.history-view` is a flex column with `height: 100%`; the `.w-full` wrapper gets `flex: 1; min-height: 0;`; `.history-panel` / `.history-empty` go back from `overflow: clip` to `overflow: hidden` and pick up `flex: 1; display: flex; flex-direction: column; justify-content: center;`; a new `.history-scroll-area` (flex: 1, overflow-y: auto, overscroll-behavior: contain) wraps the day groups and is the actual scroller. Result: the panel chrome (border, glass background, rounded corners, shadow) stays anchored in the viewport at all scroll positions, and the sticky date row resolves against the inner scroll container — so it never escapes the rounded clip. The scrim background also shifts from pure white to `rgba(250, 247, 251, 0.95)` (light) / `rgba(31, 33, 41, 0.95)` (dark) — a faint lavender/cool tint at 95% opacity, so the 5% bleed-through inherits whatever atmosphere is behind the panel and the scrim reads as a continuation of the panel rather than a separate white slab. Loading and empty states center vertically inside the new flex panel via `justify-content: center` (no JSX changes needed; their single inner div is the only flex child).
- **History date pill is now a true scrollbar barrier — rows can't poke around it.** The previous implementation made the bubble itself sticky, so transcription rows scrolled up and "passed alongside" the bubble's right edge (the pill is fit-content, not full-width), leaving wrapped Chinese text visible to the right of the pill on the same vertical line. The pill is now wrapped in a full-width `.history-date-row` element that holds the sticky behavior — `position: sticky; top: 0; padding: 12px 16px 10px;` with an opaque `rgba(255,255,255,0.96)` (light) / `rgba(28,32,44,0.96)` (dark) background. The visible bubble (`.history-date-pill`) sits inside the scrim as a normal inline-flex element, retaining its tinted glass surface but losing its own sticky / heavy shadow (the scrim now handles obscuring). Item padding moves from the day-group onto `.history-day-items` (`padding: 0 16px 0 32px`), the rail offset shifts from `left: 0` to `left: 16px`, and last-group bottom padding moves to `.history-day-group:last-child .history-day-items` so the bottom-most row keeps its breathing room.
- **History date pill no longer bleeds the row beneath it through its background.** The previous pill background was a single `linear-gradient(rgba(56,116,240, 0.14 → 0.06))` plus `backdrop-filter: blur`, which works on a static page but leaves the pill ~85% transparent — so as a `<TranscriptionItem>` row scrolled underneath the sticky pill, the row's text (e.g. "11:36 这个，你检查一下") visibly overlapped the pill's own label, making the pill look broken. The pill now layers the blue tint on top of an opaque card base (`rgba(255,255,255,0.94)` light, `rgba(28,32,44,0.94)` dark), boosts the gradient to `0.18 → 0.08` (light) / `0.22 → 0.10` (dark) so the tint stays visible after the opaque layer joins, strengthens the border to 28% / 32% primary, and adds a softer 12 px diffuse drop shadow + 2 px close shadow so it reads as elevated above the scrolling content. Backdrop-filter is kept for fallback aesthetics but is no longer load-bearing.
- **History date pill now actually sticks to the top while scrolling.** `.history-panel` was using `overflow: hidden`, which per CSS spec turns it into a "scroll container" — and since the panel itself doesn't scroll (the real scroller is `.control-panel-content-scroll` higher up in the tree), the sticky pill was scoped to a non-scrolling ancestor and never engaged. Switched the panel and `.history-empty` to `overflow: clip`, which still clips overflow against the 14 px rounded corners but does NOT create a scroll container — so `position: sticky; top: 8px;` now resolves against the actual `.control-panel-content-scroll` and the pill anchors to the panel's top edge as the user scrolls through a day's items.
- **Renderer build no longer fails on `buildCustomDictionaryPrompt`.** The custom-dictionary helper was authored as CommonJS (`module.exports`) but imported by the Vite-bundled `audioManager`, which Rollup's static analyzer rejected with `"buildCustomDictionaryPrompt" is not exported`. The helper is now an ES module (`customDictionaryPrompt.mjs` with `export`), the `audioManager` import points at the new extension, and the unit test loads it via dynamic `import()` to match.

### Internal

- **Dropped stale OpenWhispr / VoiceInk references across docs, scripts and CI.** `CLAUDE.md`, `AGENTS.md`, `DEBUG.md`, `LOCAL_WHISPER_SETUP.md`, `TROUBLESHOOTING.md` and `WINDOWS_TROUBLESHOOTING.md` now describe the project as Mouthpiece, point at the `~/.cache/mouthpiece/` cache and the `MOUTHPIECE_LOG_LEVEL` env var, and only mention the legacy paths / variables in their explicit "upgrading from older builds" notes. `scripts/lib/download-utils.js` ships a `Mouthpiece-Downloader` User-Agent and `scripts/check-download-utils-fallback.js` mocks the real `NotWizard/Mouthpiece` repo. The C source header for `resources/windows-fast-paste.c` is updated to match. The `release.yml` and `build-and-notarize.yml` workflows now export `VITE_MOUTHPIECE_API_URL` / `VITE_MOUTHPIECE_OAUTH_CALLBACK_URL` (preferred by `runtimeConfig.ts`) and read from either the new `vars.VITE_MOUTHPIECE_*` or the legacy `vars.VITE_OPENWHISPR_*` repository variables, so CI keeps building whether or not the GitHub repo variables have been renamed yet.

## [1.3.1] - 2026-05-17

### Fixed

- **Globe / right-side modifier hotkey now self-heals after a TCC reset.** When macOS revokes Accessibility (e.g. on the v1.2 → v1.3 self-signing migration), the Swift `macos-globe-listener` exits with `Failed to create event tap` and stays dead. The app now retries the spawn whenever the user brings a window back to focus or activates the app from the dock, so once Accessibility is re-granted the `RightCommand` / `Globe` hotkey resumes without the user needing to manually toggle the hotkey in Settings.
- **Windows Push-to-Talk listener no longer self-disables on hotkey change.** `windowsKeyManager.start()` would replace its child process while the previous child's async `exit` handler was still pending; when that handler eventually fired it called `reportError` against the new child and emitted `windows-ptt-unavailable`, which disabled the freshly-started listener. Each listener handler now identity-checks against its own child reference, and an `_isStopping` flag suppresses the spurious error path.
- **Windows Push-to-Talk listener self-heals on focus.** Mirroring the macOS Globe recovery: when the keyboard hook is detached (AV interception, sleep / wake, UAC), the listener now respawns the next time the user returns to the app instead of staying dead until the user re-selects the hotkey.
- **macOS fast-paste binary recovers within the session after Accessibility is re-granted.** Previously a single CGEvent failure permanently set `fastPasteChecked = true; fastPastePath = null`, forcing every subsequent paste through the slow AppleScript fallback for the rest of the run. The negative cache is now TTL-based (60 s by default) and is invalidated immediately when `isTrustedAccessibilityClient` flips back to true.
- **`update-hotkey` IPC now triggers native-listener restart on its own.** `HotkeyManager` extends `EventEmitter` and emits `hotkey-changed` after every successful update, so callers no longer need to remember to also call `notifyHotkeyChanged` for the macOS Globe / Windows native listener to refresh.
- **macOS hotkey capture mode no longer fires dictation while recording a new hotkey.** Entering the capture flow now stops `globeKeyManager` when the active hotkey is `GLOBE` or a right-side modifier, and exiting capture mode restarts the listener.
- **OpenAI empty response no longer silently masquerades as a successful cleanup.** `processWithOpenAI` previously logged `OPENAI_EMPTY_RESPONSE_FALLBACK` and returned the raw transcript, hiding the failure from upstream metrics and toasts. It now throws so the existing `audioManager` reasoning catch-and-fall-back-to-raw path runs and any future toast / telemetry can react.
- **Anthropic IPC handler stops crashing on empty `content` arrays.** Refusal / safety-stop responses can return `content: []`, which would throw `Cannot read properties of undefined (reading 'text')`. The handler now defensively extracts the first `type === "text"` block and returns `{ success: false, error }` with a refusal-aware message. The header was also corrected to canonical lowercase `x-api-key`.
- **`llama-server` lazily restarts when inference finds it dead.** Previously `inference()` threw `"llama-server is not running"` after an OOM / sleep / crash, requiring the user to toggle the model. The function now retries `start(modelPath, lastOptions)` once before failing, matching the lazy-restart behavior already present in `whisperServer` and `qwenAsrServer`.
- **GNOME Wayland accepts `RightX` modifiers and refuses modifier-only hotkeys.** `convertToGnomeFormat` previously silently dropped `RightControl`, `RightAlt`, etc. (registering a bare key like `K`) and turned modifier-only hotkeys like `RightCommand` into invalid keysyms. `Right` is now stripped before mapping so left/right modifiers produce the same GNOME binding, and modifier-only hotkeys return `""` so `hotkeyManager` falls back to X11 globalShortcut.
- **`userDataPathResolver` always picks the current Mouthpiece directory once it has real state.** Previously the score-based ranking could hand the user back to a fat legacy `OpenWhispr` directory and make recently-saved keys / DB writes appear to vanish. The current directory now wins as soon as it has a non-zero state score; only-legacy boots still pick legacy but now report `migratedFrom` / `migrationTarget` so callers can run a one-time copy.
- **`saveAllKeysToEnvFile` no longer drops user comments and unknown env vars.** The function now reads the existing `.env`, merges allow-listed keys via the new pure `mergeEnvFile` helper, and preserves comments / unknown keys verbatim. `QWEN_ASR_MODEL` was added to `PERSISTED_KEYS` so it stops being silently deleted on every save.
- **`reasoningProvider` switching to a cloud provider now persists to `.env`.** The previous logic only persisted `REASONING_PROVIDER` when the value was `"local"`, and actively cleared it for cloud providers — leaving any main-process code that read `process.env.REASONING_PROVIDER` directly with a stale value. Provider switching is now driven by a pure `computeReasoningEnvUpdate` helper that always persists non-empty values and clears `LOCAL_REASONING_MODEL` plus stops `llama-server` for any non-`local` choice (including empty / disabled reasoning).
- **Project-root `.env` no longer permanently shadows `userData/.env`.** The early-init `require("dotenv").config({ path: __dirname/.env })` at `main.js:5` ran before `EnvironmentManager`, and dotenv's no-override semantics meant any value the user typed in the UI could be silently reverted on next launch by a stale dev `.env`. The early call is gone, and `EnvironmentManager` no longer falls back to `__dirname/../../.env`.
- **OAuth deep links arriving before `windowManager` is built are now queued.** macOS delivers `open-url` before `app.whenReady()` during cold launch, and second-instance launches arrived in the first ~300 ms while `startApp` was still wiring `windowManager`. Both paths now wait on a new `startupReadyPromise` and replay queued `mouthpiece://` URLs once the control panel exists.
- **macOS `globeKeyManager` and Windows native listener wait for the real hotkey to load before starting.** `globeKeyManager.start()` used to fire while `currentHotkey` was still the platform default `GLOBE`, so a real `Fn` press during the first second of startup could falsely trigger dictation. The Windows listener startup similarly raced a hardcoded 3-second timer. Both now bind to `hotkeyManager.once("hotkey-ready", ...)`.
- **Hotkey load failure leaves the session with at least a default hotkey.** `loadSavedHotkeyOrDefault` previously only logged on exception, leaving the session unbound until restart. The catch arm now retries with `process.env.DICTATION_KEY` or the platform default and still emits `hotkey-ready`.
- **`will-quit` now waits for every server / streaming helper to release.** The handler `event.preventDefault()`s once, runs synchronous teardown for `hotkeyManager` / `globeKeyManager` / `windowsKeyManager` / `macOSPermissionFlowManager` / `updateManager`, then awaits a `Promise.allSettled` over `whisperManager.stopServer()`, `parakeetManager.stopServer()`, `qwenAsrManager.stopServer()`, the local `modelManager.stopServer()`, and the streaming helpers (`assemblyAiStreaming.cleanupAll`, `deepgramStreaming.cleanupAll`, `sonioxStreaming.disconnect`, `bailianRealtimeStreaming.disconnect`) before calling `app.exit(0)`. Hard quits no longer leave whisper / llama / parakeet child processes orphaned.
- **`authBridgeServer` stops hanging on quit during in-flight OAuth callbacks.** A new module-level `Set<Socket>` tracks every accepted connection; on `will-quit` the sockets are destroyed and `closeAllConnections()` is called before `close(callback)` resolves, so a long-lived keep-alive connection can no longer block app exit.
- **Custom dictionary prompt is bounded so the most recently added words survive Whisper's 224-token cap.** `getCustomDictionaryPrompt` now delegates to a new `buildCustomDictionaryPrompt` helper that walks the words newest-first, joins until a 600-character budget is exhausted, and returns the result in original order. Newly-added terms are no longer silently dropped, and runaway dictionaries no longer balloon cloud reasoning token costs.

### Internal

- `CLAUDE.md` now requires every commit that touches user-visible behavior, fixes a bug, or alters developer workflow to update `CHANGELOG.md` in the same commit (Keep a Changelog format under `[Unreleased]`).
- New pure helper modules with focused unit tests, all callable outside Electron: `src/helpers/envFile.js` (mergeEnvFile), `src/helpers/reasoningEnvUpdate.js` (computeReasoningEnvUpdate), `src/helpers/fastPasteCache.js` (createFastPasteCache), `src/helpers/customDictionaryPrompt.js` (buildCustomDictionaryPrompt).
- `HotkeyManager` now extends `EventEmitter`, emitting `hotkey-changed` after every successful `updateHotkey` and a one-shot `hotkey-ready` once `loadSavedHotkeyOrDefault` settles.
- `IPCHandlers` exposes a `getGlobeKeyManager` accessor so `set-hotkey-listening-mode` can manipulate the macOS Globe listener without circular imports.
- 58 new test cases across 9 files (`tests/env-file-merge.test.mjs`, `tests/reasoning-env-update.test.mjs`, `tests/dotenv-shadow-removal.test.mjs`, `tests/windows-key-listener-recovery.test.mjs`, `tests/clipboard-fast-paste-ttl.test.mjs`, `tests/hotkey-manager-events.test.mjs`, `tests/capture-mode-stops-globe.test.mjs`, `tests/reasoning-error-paths.test.mjs`, `tests/gnome-shortcut-format.test.mjs`, `tests/user-data-current-priority.test.mjs`, `tests/startup-ordering.test.mjs`, `tests/cleanup-and-dictionary-cap.test.mjs`).

## [1.3.0] - 2026-05-16

### ⚠️ One-time re-authorization required after this update

After updating to v1.3.0 you will be asked to re-grant **Accessibility** (and **Microphone**, if you use voice dictation) **one final time**. macOS treats the new build as a different app because the code-signing identity changed. Once you re-grant, every future Mouthpiece update will retain your permissions automatically.

### Changed

- **Stable code-signing identity for persistent macOS permissions**: macOS releases are now signed with a 10-year self-signed code-signing certificate (CN `Mouthpiece Code Signing`) instead of ad-hoc signing. The codesign Designated Requirement is now anchored to that certificate, so TCC (the system that tracks Accessibility / Microphone grants) recognizes every future update as the same app and preserves your permissions across releases. No Apple Developer ID is involved; this works without notarization. See `docs/release/code-signing-runbook.md` for the full mechanism.
- Homebrew cask now strips the Gatekeeper quarantine attribute on install via a `postflight` block, so first-launch from `brew install --cask` no longer needs the right-click → Open dance.

### Internal

- New `scripts/setup-self-signed-cert.sh` that generates the cert + .p12 (one-time, saved outside the repo at `~/.mouthpiece-signing/`).
- Release workflow validates the Designated Requirement on every macOS build and hard-fails if signing silently fell back to ad-hoc.
- New `MAC_SELFSIGN_CERT_BASE64`, `MAC_SELFSIGN_CERT_PASSWORD`, `MAC_SELFSIGN_IDENTITY` GitHub Actions secrets replace the previous Apple Developer ID gating.

## [1.2.0] - 2026-05-16

### Removed

- **Auto-Learn Correction Monitoring**: Removed the feature that monitored user edits in the target app after a paste and automatically appended corrected words to the custom dictionary. The required AppleScript `AXEnhancedUserInterface` flip caused 1-2 second freezes in Chromium-based target apps (Chrome, VS Code, Cursor, Slack, Discord, Notion, etc.) every time a paste finished, because each invocation forced the app to rebuild its accessibility tree on the main thread. Manual custom dictionary, glossary terms, blacklist, and homophone mappings remain available.
- Removed dependent surfaces along with the feature: the `Auto-learn corrections` toggle in Settings → Dictionary, the pending-suggestions review panel inside the terminology card, the dictionary-suggestion overlay toast, the `setAutoLearnEnabled` / `onCorrectionsLearned` / `undoLearnedCorrections` IPC bridges, the `block_auto_learn` sensitive-app policy action, and the `allowSensitiveAppAutoLearn` privacy switch.
- Removed the platform text-monitor binaries (`macos-text-monitor`, `linux-text-monitor`, `windows-text-monitor`), their compile / download scripts, and the matching GitHub Actions release workflows.

### Changed

- Renamed `src/helpers/textEditMonitor.js` to `src/helpers/targetAppCapture.js`, retaining only the foreground-app PID capture used by paste targeting at hotkey press.
- Existing words that had previously been auto-learned into the user dictionary are kept as ordinary custom dictionary entries; no migration is required.

## [1.1.2] - 2026-03-19

### Added

- Added Deepgram as a dedicated cloud transcription provider with a provider-level realtime streaming toggle
- Added Soniox as a dedicated cloud transcription provider with separate async and realtime transcription paths
- Added live partial transcript display in the dictation overlay while realtime transcription is active

### Changed

- Exposed Alibaba Bailian as a dedicated cloud transcription provider in Settings instead of routing DashScope through the generic custom provider
- Clarified the custom transcription provider as the generic OpenAI-compatible endpoint path and automatically migrate legacy `custom` + DashScope transcription settings on startup
- Tightened renderer network boundaries and consolidated API key persistence to reduce secret exposure across transcription providers
- Fixed CommonJS and ESM import compatibility in the main branch packaging path

### Fixed

- Fixed error toast close behavior and refreshed its visual styling
- Removed the signed-out sidebar hint and unified the model cache directory layout

## [1.1.1] - 2026-03-18

### Added

- Restored automatic app update checks on startup with a 12-hour background polling interval
- Added a control panel sidebar update action that appears after a new version finishes downloading in the background

### Changed

- Update installation now waits for explicit user confirmation before restarting the app
- Release publishing is now aligned with the current `NotWizard/Mouthpiece` repository so packaged builds and update metadata ship from the same source

## [1.0.0] - 2026-03-17

### Changed

- Reset the release numbering for this standalone repository so the first official Mouthpiece release starts at `1.0.0`
- Improved API key setup with direct input, blur-time masking, and an eye toggle for reveal/hide
- Added Alibaba Bailian as a dedicated reasoning provider
- Fixed mac packaging preflight so local builds can reuse bundled whisper binaries without failing on unnecessary release lookups

## [1.5.5] - 2026-03-01

### Added

- **Mode-Aware File Size Validation**: Upload UI now enforces file size limits per transcription mode — local is unlimited, BYOK and Cloud free are capped at 25 MB, Cloud pro at 500 MB — with contextual messaging and CTA buttons (Create Account, Upgrade, Switch to Cloud)
- **Large File Chunking**: Files over 25 MB are automatically split via FFmpeg and transcribed in parallel with per-chunk progress reporting
- **Gemma 3 Local Models**: Added Gemma 3 (1B, 4B, 12B, 27B) to the local model registry with provider icon
- **Groq Model Updates**: Added new Groq models and removed deprecated ones (Maverick, Kimi K2 Instruct)
- **Notes Editor Formatting Shortcuts**: Cmd+B (bold), Cmd+I (italic), Cmd+E (code) keyboard shortcuts in the notes editor
- **Linux Wayland Paste Improvements**: Added ydotool support and improved wl-copy reliability for Wayland paste
- **Granular Build Scripts**: Added individual build target scripts for more flexible CI/CD

### Fixed

- **Fn/Globe Hotkey**: Fn key now correctly treated as equivalent to Globe key on macOS
- **GPU Activation**: Fixed GPU activation flow and Vulkan fallback behavior
- **Groq i18n**: Updated Groq model descriptions and added missing translations across all locales

## [1.5.4] - 2026-02-25

### Added

- **Auto-Learn Correction Monitoring**: Detects user edits after paste and automatically updates the custom dictionary with learned corrections; native text monitor binaries for macOS (AXObserver with PID-based AX targeting), Windows, and Linux (with download-first strategy and CI workflow for prebuilt binaries); undo button on auto-learned dictionary toast; dictionary settings UI with translations across all locales
- **Config-Driven STT Routing**: STT mode (batch vs streaming) now driven by `/api/stt-config` per context (dictation vs notes); streaming provider adapter map supports Deepgram and AssemblyAI, replacing hardcoded Deepgram IPC calls with a generic interface
- **Live Toggle in Notes**: "Live" toggle in NoteEditor lets users override between streaming and batch transcription for notes

### Fixed

- **STT Metadata Forwarding**: Forward complete STT metadata (`sttWordCount`, `sttLanguage`, actual Deepgram model, audio bytes, `stt_processing_ms`) and client end-to-end latency (`client_total_ms`) to API logging
- **BYOK Transcription Logging**: Fixed BYOK reasoning incorrectly suppressing transcribe logs

## [1.5.3] - 2026-02-24

### Added

- **Unified GPU Banners**: Replaced dual CUDA/Vulkan banners on the home screen with a single GPU acceleration banner; added GPU banners to Transcription Settings and AI Text Enhancement Settings
- **GpuStatusBadge Redesign**: Auto-retry flow (download → activating → GPU active) with 15s timeout, replacing confusing "CPU Only" and "Re-detect GPU" states; swapped hardcoded hex colors for `bg-success`/`bg-warning` design tokens
- **Streaming Usage Tracking**: Wired up the previously-uncalled `/api/streaming-usage` endpoint so Deepgram streaming transcriptions report word counts to the server
- **Cloud API Telemetry**: Forward STT metadata (`sttProvider`, `sttModel`, processing time, audio duration/size/format) and `clientVersion`/`clientType`/`appVersion` to all cloud API requests
- **Internationalization**: Added 15 missing i18n keys (`app.mic.*`, `app.commandMenu.*`, `app.toasts.*`, `app.oauth.*`, `notes.enhance.title`) across all 10 locale files

### Fixed

- **Windows Blank Screen**: Fixed blank screen on return from sleep/minimize by adding `render-process-gone` handler, `isCrashed()` health checks on show/tray/second-instance paths, `backgroundColor` and `backgroundThrottling` to window config, and `disable-gpu-compositing` for win32
- **IPC Echo Loop**: Broke infinite IPC bounce in floating icon auto-hide toggle by guarding the setter with an early return when the value hasn't changed
- **GPU Banner Navigation**: GPU banner "Enable GPU" button now navigates to the correct `"intelligence"` settings section instead of invalid `"reasoning"` ID
- **AI CTA Deep Link**: Replaced legacy `"aiModels"` alias with canonical `"intelligence"` section ID in the AI enhancement CTA button
- **Custom Endpoint Routing** (#311): Moved `reasoningProvider === "custom"` check to the top of `getModelProvider()` so custom endpoint models are never misrouted through built-in providers; custom models now show a neutral Globe icon
- **KDE Wayland Terminal Detection**: Detect Konsole via `kdotool` (fast path) or KWin `supportInformation` via `qdbus` (zero-install fallback) so terminals receive `Ctrl+Shift+V` instead of `Ctrl+V`
- **RAM Leak on Provider Switch**: Whisper, Parakeet, and llama-server processes now stop when switching to cloud providers, freeing loaded models from RAM
- **Streaming Usage Session Refresh**: Wrapped `cloudStreamingUsage` in `withSessionRefresh` so expired sessions auto-refresh instead of silently dropping word counts
- **Duplicate Transcription Logs**: Skip telemetry logging in streaming-usage and transcribe endpoints when reasoning is enabled (the `/api/reason` endpoint already creates the combined row)
- **Usage Cache Invalidation**: `useUsage` hook now listens for `usage-changed` events to invalidate its cache and refetch immediately after transcription
- **macOS Binary Architecture**: Added Mach-O header verification to globe-listener and fast-paste build scripts; force rebuild when architecture-specific hash file is missing; runtime architecture check before spawning binary
- **Globe Key Listener Resilience**: Auto-restart globe key listener on unexpected exit code 0 (sleep/wake invalidation); reset restart counter after sustained uptime; only treat "Failed to create event tap" as fatal
- **Parakeet Long Recordings**: Lowered max segment duration from 30s to 15s for more reliable chunked transcription; downgraded reasoning failure log from error to warn

## [1.5.2] - 2026-02-24

### Fixed

- **Reasoning Output**: Resolved empty output for Qwen3/GPT-OSS models by raising local inference minimum tokens from 100 to 512; fixed custom endpoint models misrouting by checking `reasoningProvider` setting before name heuristics
- **Google OAuth**: Added `newUserCallbackURL` to desktop Google OAuth flow for proper new user registration
- **Linux KDE Taskbar**: Prevented dictation panel from appearing in KDE taskbar
- **Intel Mac CI Builds**: Fixed binary architecture mismatch by installing x64 ffmpeg-static binary and preventing prebuild hooks from deleting x64 binaries on arm64 CI runners (#196)

## [1.5.1] - 2026-02-23

### Added

- **GPU-Accelerated Local Inference**: Vulkan (Windows/Linux) and Metal (macOS) support for llama-server with automatic CPU fallback and GPU status badge in the reasoning model selector
- **CUDA GPU Acceleration for Whisper**: NVIDIA GPU acceleration for local Whisper transcription with automatic GPU detection, upgrade banner for existing users, and shared download progress UI
- **On-Demand Vulkan Download**: Vulkan llama-server binary downloads on-demand when the user opts in, saving 40-46MB from the app installer

### Changed

- **Vulkan Llama-Server Architecture**: Switched from bundling the Vulkan binary to on-demand download into userData, mirroring the Whisper CUDA download pattern

### Fixed

- **macOS Paste Failure**: Replaced osascript-based accessibility check with Electron's native `isTrustedAccessibilityClient()` and fixed focus transfer using hide()+showInactive() instead of blur() on NSPanel (#313)
- **Windows Sherpa-onnx Extraction**: Fixed tar extraction failing on Windows due to GNU tar interpreting drive letter colons as remote host separators — now uses relative paths (#284)
- **macOS Auto-Update Architecture**: Detect Rosetta translation via `sysctl.proc_translated` so Apple Silicon users stuck on an x64 build from older releases self-heal to the native arm64 build on next update

## [1.5.0] - 2026-02-23

### Added

- **Notes System**: Full-featured note-taking built into the control panel
  - Create, edit, and organize notes with a rich Markdown editor
  - Organize notes into custom folders with a default Personal folder
  - Upload audio files for transcription directly into notes
  - Real-time dictation widget for transcribing directly into a note
  - Drag-and-drop to reorder notes and move between folders
  - Guided onboarding flow for first-time notes users
- **AI Actions on Notes**: Apply AI-powered actions to note content
  - Action picker with customizable processing prompts
  - Action manager dialog for creating and editing action templates
  - Processing overlay with live progress feedback
- **Sidebar Navigation**: Redesigned control panel with persistent sidebar
  - New `ControlPanelSidebar` replaces the old tab-based layout
  - Dedicated views for History, Notes, Dictionary, and Settings
  - Collapsible sidebar for more content space
- **Referral Program**: Invite friends to earn free Pro months
  - Referral dashboard with invite tracking and status badges
  - Email invitation flow
  - Animated spectrogram share card with unique referral code
- **New AI Models**: Added Claude 4.6 (Opus), Gemini 3 Flash, and Gemini 3.1 Pro to the model registry
- **Settings Store**: Migrated settings state management to Zustand store for better performance and shared access across components
- **Note Store & Action Store**: New Zustand stores for notes and AI action state

### Changed

- **Control Panel Architecture**: Extracted History, Dictionary, and Settings into standalone views, reducing ControlPanel complexity
- **Settings Refactor**: Extracted bulk of `useSettings` hook logic into `settingsStore.ts` for cleaner separation of concerns
- **UI Polish**: Updated numerous components with improved dark mode support, consistent spacing, and refined typography
- **Locale Updates**: Extended all 10 language files with notes, referral, and sidebar translation keys

### Fixed

- **macOS Auto-Update Architecture**: Detect Rosetta translation via `sysctl.proc_translated` so Apple Silicon users stuck on an x64 build from older releases self-heal to the native arm64 build on next update
- **Linux GTK Crash**: Force GTK3 on Linux startup to avoid GTK symbol crash on systems with GTK4 installed (#291)
- **CI Pipeline**: Added Windows paste binary and key listener download steps to the build workflow (#298)
- **Buy Me a Coffee**: Updated funding link username

## [1.4.11] - 2026-02-13

### Added

- **Japanese Locale**: Full Japanese UI and prompt translations
- **Windows Paste Terminal Detection**: Added kitty to the Windows fast paste binary's terminal class list

### Changed

- **Windows Push-to-Talk Refactor**: Moved PTT state management (hold timing, recording tracking, cooldown) from main process into `windowManager` for cleaner separation and consistency with macOS PTT patterns
- **Audio Recording Reentrancy Guards**: Added lock refs to `useAudioRecording` start/stop to prevent concurrent calls from rapid key presses
- **Synchronous Activation Mode**: `getActivationMode()` is now synchronous (reads from cache), removing unnecessary async overhead in all PTT and hotkey handlers
- **Default Agent Name**: Set default agent name to OpenWhispr

### Fixed

- **Hide vs Minimize**: Dictation panel now consistently hides (rather than minimizing on Windows/Linux) for uniform cross-platform behavior
- **Minimized Window Restore**: Dictation panel restores from minimized state before showing, preventing invisible panel on Windows

## [1.4.10] - 2026-02-13

### Added

- **Deepgram Streaming Liveness Check**: Detects unresponsive warm connections within 2.5s and transparently reconnects with audio replay
- **Batch Transcription Fallback**: If streaming produces no text, automatically falls back to batch transcription via OpenWhispr Cloud
- **Full Locale Codes**: Pass full locale codes (e.g. en-US, zh-CN) to Deepgram instead of stripping to base codes, preserving dialect precision

### Fixed

- **Deepgram Token Expiry**: Fixed token expiry clock resetting on every re-warm cycle, which prevented detection of expired tokens and caused persistent 401 errors
- **Deepgram 401 Recovery**: Invalidate cached tokens on authentication failures so subsequent attempts fetch fresh tokens instead of retrying stale ones

## [1.4.9] - 2026-02-12

### Fixed

- **Deepgram Nova-3 Language Fallback**: Automatically fall back to Nova-2 for languages not yet supported by Nova-3 (e.g., Chinese, Thai), preventing 400 Bad Request errors. Also switches from `keyterm` to `keywords` parameter when using Nova-2.

## [1.4.8] - 2026-02-12

### Added
- **Referral Program**: Invite friends to earn free Pro months with referral dashboard, email invitations, invite tracking with status badges, and animated spectrogram share card with unique referral code
- **Notes System**: Added sidebar navigation with notes system and dictionary view for organizing transcriptions
- **Folder Organization**: Notes can be organized into custom folders with a default Personal folder, folder management UI, and folder-aware note filtering. Upload flow now includes folder selection
- **Internationalization v1**: Full desktop localization across auth, settings, hooks, and UI with centralized renderer locale resources (#258)
- **Chinese Language Split**: Split Chinese into Simplified (zh-CN) and Traditional (zh-TW) with tailored AI instructions and one-time migration for existing users (#267)
- **Russian Interface Language**: Added Russian to interface language options
- **Deepgram Token Refresh & Keyterms**: Proactive token rotation for warm connections before expiry and keyterms pass-through for improved transcription accuracy

### Fixed

- **macOS Non-English Keyboard Paste**: Fixed paste not working on non-English keyboard layouts (Russian, Ukrainian, etc.) by using physical key code instead of character-based keystroke in AppleScript fallback
- **Whisper Language Auto-Detection**: Pass `--language auto` to whisper.cpp explicitly so non-English audio isn't forced to English (#260)
- **Model Download Pipeline**: Inline redirect handling, deferred write stream creation, indeterminate progress bar for unknown sizes, and Parakeet ONNX file validation after extraction
- **Sherpa-onnx Shared Libraries**: Always overwrite shared libraries during download to prevent stale architecture-mismatched binaries, with `--force` support
- **Chinese Translation Fixes**: Minor translation corrections for Chinese interface strings
- **Neon Auth Build Config**: Fixed auth build configuration

## [1.4.7] - 2026-02-11

### Added

- **Deepgram Streaming Transcription**: Migrated real-time streaming transcription from AssemblyAI to Deepgram for improved reliability and accuracy (#249)

### Fixed

- **BYOK After Upgrade**: Prefer localStorage API keys over process.env so Bring Your Own Key mode works correctly after upgrading (#263)
- **PTT Double-Fire Prevention**: Applied post-stop cooldown and press-identity checks to both macOS and Windows push-to-talk handlers
- **Archive Extraction Retry**: Reuse existing archive on extraction retry with improved error handling
- **Email Verification Polling**: Pass email param in verification polling and stop on 401 responses
- **Auth Build Bundling**: Added @neondatabase/auth packages to rollup externals for correct production bundling (#256)
- **Neon Auth Build Config**: Fixed Vite build configuration for Neon Auth packages (#266)

### Changed

- **Build System**: Bumped Node version in build files

## [1.4.6] - 2026-02-10

### Added

- **Robust Model Downloads**: Hardened download pipeline with stall detection, disk space checks, and file validation for more reliable model installs
- **Prompt Handling Improvements**: Improved agent name resolution, prompt studio enhancements, and smarter prompt context assembly
- **Past-Due Subscription Handling**: Users with past-due subscriptions now see clear messaging and recovery options

### Fixed

- **Parakeet Long Audio**: Fixed empty transcriptions for long audio by segmenting input before sending to Parakeet
- **Plus-Addressed Emails**: Reject plus-addressed emails (e.g., user+tag@example.com) during authentication
- **Double-Click Prevention**: Prevent duplicate requests when double-clicking checkout and billing buttons
- **Auth Initialization Race**: Await init-user before completing auth flow and fix missing user dependency

### Changed

- **Startup Performance**: Preload lazy chunks during auth initialization for faster page transitions
- **Code Cleanup**: Removed excess comments and simplified window management logic

## [1.4.5] - 2026-02-09

### Added

- **Dictation Sound Effects Toggle**: New setting to enable/disable dictation audio cues with refined tones (warmer, softer frequencies, gentler attack, distinct start/stop)
- **Toast Notification Redesign**: Redesigned toast notifications as dark HUD surfaces for a more polished look
- **Floating Icon Auto-Hide**: New setting to auto-hide the floating dictation icon
- **Loading Screen Redesign**: Branded loading screen with logo and spinner
- **Discord Support Link**: Added Discord link to the support menu
- **Auth-Aware Routing**: Returning signed-out users now see a re-authentication screen instead of a broken state

### Fixed

- **Dropdown Dark Mode**: Fixed dropdown styling in dark mode
- **Toast Dark Mode**: Fixed toast colouring in dark mode
- **Globe Key Persistence**: Globe key now persists to .env and dictation key syncs to localStorage
- **Globe Listener Cross-Compilation**: Cross-compiled globe listener for x64

### Changed

- **Startup Performance**: Deferred non-critical manager initialization after window creation, lazy-loaded ControlPanel/OnboardingFlow/SettingsModal, converted env file writes to async, extracted SettingsProvider context, and split Radix/lucide into separate vendor chunks
- **Scrollbar Styling**: Subtle transparent-track scrollbar with thinner floating thumb

## [1.4.4] - 2026-02-08

### Fixed

- **AI Enhancement CTA Persistence**: Dismissing the "Enable AI Enhancement" banner now persists to localStorage so it stays hidden across sessions

### Changed

- **Code Cleanup**: Removed excess comments and section dividers in ControlPanel

## [1.4.3] - 2026-02-08

### Added

- **Mistral Voxtral Transcription**: Added Mistral as a cloud transcription provider with Voxtral Mini model and custom dictionary support via context_bias
- **TypeScript Compilation**: Added TypeScript as an explicit dev dependency with project-level `tsconfig.json`

### Fixed

- **Linux Wayland Clipboard**: Persistent clipboard ownership on Wayland so Ctrl+V works reliably after transcription
- **Linux Window Flickering**: Fixed transparent window flickering on Wayland and X11 compositors
- **Windows Modifier-Only Hotkeys**: Support modifier-only hotkeys on Windows via native keyboard hook
- **Update Installation**: Resolved quitAndInstall hang by removing close listeners that block window shutdown during updates
- **Custom System Prompts**: Pass custom system prompt to local and Anthropic BYOK reasoning
- **Audio Cue Audibility**: Improved dictation start/stop audio cue volume
- **Language Selector**: Fixed dropdown positioning and sizing inside settings modal
- **Type Safety**: Tightened Electron IPC callback return types, model picker styles, toast variant types, and event handler signatures across the codebase

### Changed

- **Code Cleanup**: Removed excess comments, section dividers, and redundant JSDoc across components, hooks, and utilities

## [1.4.2] - 2026-02-07

### Fixed

- **AssemblyAI Streaming Reliability**: Fixed real-time WebSocket going silent after idle periods by adding keep-alive pings, readyState validation, re-warm recovery, and connection death handling

## [1.4.1] - 2026-02-07

### Added

- **Runtime .env Configuration**: Environment variables now reload at runtime without requiring app restart
- **Settings Retention on Pro**: Pro subscribers retain their settings when managing their subscription

### Fixed

- **macOS Microphone Permission**: Resolved hardened-runtime mic permission prompt by routing through main-process IPC and unifying API key cache invalidation with event-based AudioManager sync
- **AudioWorklet ASAR Loading**: Inlined AudioWorklet as blob URL to fix module loading failure in packaged ASAR builds
- **Google OAuth Flow**: OAuth now opens in the system browser with deep link callback instead of navigating the Electron window
- **Auth Security Hardening**: Safe JSON parsing, guarded URL constructor, and fixed error information leaks in auth code
- **Deep Link Focus**: Control panel now correctly receives focus when opened via deep link
- **Neon Auth Electron Compatibility**: Routed auth flows through API proxy and fixed Origin header rejection for desktop app
- **Billing Error Visibility**: Checkout and billing errors now surface as toast notifications instead of failing silently
- **Hotkey Persistence**: Added file-based hotkey storage for reliable startup persistence (#181)
- **Email Verification**: Disabled Neon Auth email verification step for smoother onboarding

### Changed

- **Build Optimization**: Binary dependencies are now cached during build for faster CI
- **UI Polish**: Fixed scrollbar styling, provider button styling, and voice recorder icon fill

## [1.4.0] - 2026-02-06

### Added

- **OpenWhispr Cloud**: Cloud-native transcription service — sign in and transcribe without managing API keys
  - Google OAuth and email/password authentication via Neon Auth
  - Email verification flow with polling and resend support
  - Password reset via email magic links
- **Subscription & Billing**: Free and Pro plans with Stripe-powered payments
  - Free plan with rolling weekly word limits (2,000 words/week)
  - Pro plan with unlimited transcriptions
  - 7-day free trial for new accounts with countdown display
  - In-app upgrade prompts when approaching or reaching usage limits
  - Stripe billing portal access for Pro subscribers
- **Usage Tracking**: Real-time usage display with progress bar, color-coded thresholds, and next billing date
- **Account Section in Settings**: Profile display, plan status badge, usage bar, billing management, and sign out
- **Upgrade Prompt Dialog**: When usage limit is reached, offers three paths — upgrade to Pro, bring your own key, or switch to local
- **Cancel Processing Button**: Cancel ongoing transcription processing mid-flight
- **Dynamic Window Resizing**: Window automatically resizes based on command menu and toast visibility
- **Dark Mode Icon Inversion**: Monochrome provider icons now automatically invert in dark mode for better visibility

### Changed

- **Onboarding Redesign**: Auth-first onboarding flow
  - Signed-in users get a streamlined 3-step flow (Welcome → Setup → Activation)
  - Non-signed-in users get a 4-step flow with transcription mode selection
  - Permissions merged into Setup step for signed-in users
- **Transcription Mode Architecture**: Unified mode selection across OpenWhispr Cloud, Bring Your Own Key (BYOK), and Local
  - Signed-in users default to OpenWhispr Cloud
  - Non-signed-in users choose between BYOK and Local
- **Design System Overhaul**: Complete refactor of styling to use design tokens throughout the codebase
  - Button component now uses `text-foreground`, `bg-muted`, `border-border` instead of hardcoded hex values
  - Removed hardcoded classes and inline styles across components
  - Improved button and badge consistency
- **Settings UI Redesign**: Overhauled all settings pages with unified panel system, redesigned sidebar, and extracted permissions section
- **Dark Mode Polish**: Premium button styling, glass morphism toasts, and streamlined visuals
- **App Channel Isolation**: Development, staging, and production channels now use isolated user data directories

### Fixed

- **Light Mode UI Visibility**: Fixed multiple UI elements that were invisible or hard to see in light mode:
  - Settings gear icon in permission cards now uses `text-foreground`
  - Troubleshoot button uses proper foreground color
  - Reset button in developer settings now correctly shows destructive color
  - Settings and Help icons in the toolbar are now properly visible
  - Check for Updates button now renders correctly in light mode
- **Provider Tab Flashing**: Resolved TranscriptionModelPicker tab flashing by extracting ModeToggle component and syncing internal state with props
- **Local Reasoning Model Persistence**: Fixed local reasoning model selection not persisting correctly
- **Parakeet Model Status**: Added dedicated IPC channel for Parakeet model status checks
- **Groq Qwen3 Models**: Removed thinking tokens from Qwen3 models on Groq provider
- **OAuth Session Grace Period**: Automatic session refresh with exponential backoff retry during initial OAuth establishment

## [1.3.3] - 2026-01-28

### Added

- **ONNX Warm-up Inference**: Parakeet server now runs warm-up inference on start to eliminate first-request latency from JIT compilation
- **Startup Preferences Sync**: Renderer startup preferences are now synced to `.env` for server pre-warming on restart

### Changed

- **macOS Tray Behavior**: Hide to tray on macOS for consistent cross-platform behavior

### Fixed

- **macOS Launch Crash**: Added `disable-library-validation` entitlement to resolve macOS launch crash (#120)
- **Reasoning Model Default**: Fixed `useReasoningModel` not correctly defaulting to enabled by persisting useLocalStorage defaults and aligning direct reads
- **Windows Non-ASCII Usernames**: Resolved whisper-server crash on Windows with non-ASCII usernames by pre-converting audio to WAV and routing temp files through ASCII-safe directory
- **Windows Paths with Spaces**: Fixed temp directory fallback to also detect paths with spaces on Windows

## [1.3.2] - 2026-01-27

### Changed

- **Linux Paste Tools**: Prefer xdotool over ydotool for better compatibility

### Fixed

- **Windows Zip Extraction**: Use tar instead of PowerShell Expand-Archive for zip extraction on Windows to avoid issues with special characters

## [1.3.1] - 2026-01-27

### Changed

- **Download System Refactor**: Consolidated model download logic into shared utilities with resume support, retry logic, abort signals, and improved installing state UI
- **Throttled Progress Display**: Whisper model download progress updates are now throttled for smoother UI

## [1.3.0] - 2026-01-26

### Added

- **NVIDIA Parakeet Support**: Fast local transcription via sherpa-onnx runtime with INT8 quantized models
  - `parakeet-tdt-0.6b-v3`: Multilingual (25 languages), ~680MB
- **Windows Push-to-Talk**: Native Windows key listener with low-level keyboard hook for true push-to-talk functionality
  - Supports compound hotkeys like `Ctrl+Shift+F11` or `CommandOrControl+Space`
  - Prebuilt binary automatically downloaded from GitHub releases
  - Fallback to tap mode if binary unavailable
- **Custom Dictionary**: Improve transcription accuracy for specific words, names, and technical terms
  - Add custom words through Settings → Custom Dictionary
  - Words are passed as hints to Whisper for better recognition
  - Works with both local and cloud transcription
- **GitHub Actions Workflow**: Automated CI workflow to build and release Windows key listener binary
- **Shared Download Utilities**: New `scripts/lib/download-utils.js` module with reusable download, extraction, and GitHub release fetching functions

### Changed

- **Download Scripts Refactored**: All download scripts now use shared utilities for consistency
- **GitHub API Authentication**: Download scripts support `GITHUB_TOKEN` to avoid API rate limits in CI
- **Debug Logging Cleanup**: Extracted common window loading code and cleaned up debug logging

### Fixed

- **GNOME Wayland Hotkey Improvements**: Improved hotkey handling on GNOME Wayland
- **Hotkey Persistence**: Fixed hotkey selection not persisting correctly
- **Custom Endpoint API Keys**: Fixed custom endpoint API keys not persisting to `.env` file
- **Custom Endpoint State**: Fixed custom endpoint using shared state instead of its own
- **Linux Stale Hotkey Registrations**: Clear stale hotkey registrations on startup on Linux
- **Wayland XWayland Paste**: Try xdotool on Wayland when XWayland is available
- **llama-server Libraries**: Bundle llama-server shared libraries and search from extract root for varying archive structures
- **STT/Reasoning Debug Logging**: Added missing debug logging for STT and reasoning pipelines

## [1.2.16] - 2026-01-24

### Fixed

- **App Startup Hang**: Fixed app initialization timing issues with Electron 36+
- **Manager Initialization**: Deferred manager initialization until after `app.whenReady()` to prevent hangs
- **Debug Logger Initialization**: Deferred debugLogger file initialization until `app.whenReady()`
- **Config Bundling**: Fixed missing config files in production builds
- **whisper.cpp Binary Version**: Updated whisper.cpp release names and bumped binary version

## [1.2.15] - 2026-01-22

### Added

- **ydotool Fallback for Linux**: Added ydotool as additional fallback option for clipboard paste operations on Linux systems

### Changed

- **Unified Prompt System**: Refactored to single intelligent prompt system for improved consistency and maintainability
- **whisper.cpp Remote**: Refactored remote whisper.cpp integration for better reliability

## [1.2.14] - 2026-01-22

### Added

- **Troubleshooting Mode**: New debug logging section in settings with toggle for detailed diagnostic logs, log file path display, and direct folder access for easier support
- **Custom Transcription Endpoint**: Support for custom OpenAI-compatible transcription endpoints with configurable base URLs
- **Enhanced Clipboard Debugging**: Detailed clipboard operation logging for diagnosing paste issues across platforms

### Changed

- **API Key Management**: Consolidated and refactored API key persistence with improved .env file handling and recovery mechanisms
- **Local Network Detection**: Refactored URL detection into reusable utility for better code organization
- **Electron Builder**: Updated to latest version for improved build performance

### Fixed

- **Windows/Linux Taskbar**: Prevented dual taskbar entries on Windows and Linux by properly configuring window behavior
- **Single Instance Lock**: Enforced single instance lock with cleaner window state checks
- **Model Provider Consistency**: Removed redundant fallbacks and ensured consistent use of getModelProvider()
- **Cross-env Support**: Fixed Windows compatibility in pack script using cross-env
- **Linux X11 Paste**: Improved paste reliability by capturing target window ID upfront with windowactivate --sync, added xdotool type fallback for terminals
- **Tray Minimize**: Fixed minimize to tray functionality

## [1.2.12] - 2026-01-20

### Added

- **LLM Download Cancellation**: Added ability to cancel in-progress local LLM model downloads with throttled progress updates to prevent UI flashing

### Changed

- **Gemini Model Updates**: Updated Gemini models to latest versions
- **Linux Wayland Improvements**: Improved Wayland paste detection with GNOME-specific handling and XWayland fallback support
- **whisper.cpp CUDA Support**: Updated whisper.cpp download script to include CUDA-enabled binaries

### Fixed

- **Windows Paste Delay**: Adjusted paste delay timing on Windows for more reliable text insertion
- **Blank Audio Prevention**: Fixed issue where blank/silent audio recordings would paste empty text
- **Newline Handling**: Fixed newline formatting issues in transcribed text

## [1.2.11] - 2026-01-18

### Fixed

- **ASAR Path Resolution**: Fixed path resolution issues for bundled resources in packaged builds
- **Update Checker**: Fixed auto-update checker initialization
- **Build Includes**: Ensured services and models are properly included in production builds
- **OS Module Import**: Fixed OS module import ordering

## [1.2.10] - 2026-01-17

### Fixed

- **Streaming Backpressure**: Fixed proper streaming backpressure handling in audio processing
- **Quit and Install**: Fixed update installation on app quit

## [1.2.9] - 2026-01-17

### Fixed

- **Path Resolution**: Improved path resolution for better cross-platform compatibility

## [1.2.8] - 2026-01-16

### Added

- **Microphone Input Selection**: Choose your preferred microphone input device in settings, with built-in mic preference to prevent Bluetooth audio interruptions
- **Push to Talk Mode**: New recording mode option alongside the existing toggle mode
- **Hotkey Listening Mode**: Prevents conflicts when capturing new hotkeys by temporarily disabling the global hotkey
- **Hotkey Fallback System**: Automatic fallback with user notifications when preferred hotkey is unavailable
- **Cross-Platform Accessibility Settings**: Quick access to system accessibility settings on macOS

### Changed

- **Streamlined Onboarding**: Removed redundant "How it Works" section, success dialogs, and manual save buttons for a smoother setup experience
- **Improved Select Styling**: Enhanced dropdown select component appearance

### Fixed

- **FFmpeg Availability Types**: Corrected type definitions and optimized whisper-cpp download process
- **Whisper Models Path**: Fixed model storage path resolution
- **Better Path Resolution**: Improved error handling for file paths
- **Open Mic Settings**: Fixed system settings link for microphone configuration

## [1.2.7] - 2026-01-13

### Added

- **Whisper Server HTTP Mode**: Added persistent whisper-server for faster repeated transcriptions with automatic CLI fallback
- **Pipeline Timing Instrumentation**: Added detailed timing logs for each stage of the transcription pipeline
- **Whisper Server Pre-warming**: Server pre-warms on startup for faster first transcription

### Changed

- **Windows Clipboard**: Reduced clipboard delays for faster text pasting on Windows

### Fixed

- **Windows Update Install**: Simplified Windows update installation by using silent mode and removing redundant before-quit handling
- **Mac Build Workflows**: Fixed CI/CD to run separate workflows for Mac builds
- **Mac DMG Build Race Condition**: Fixed release workflow DMG build failure caused by concurrent arm64/x64 builds mounting same volume
- **Windows Download Script**: Fixed PowerShell Expand-Archive failure with bracket characters in directory names

## [1.2.6] - 2026-01-13

### Changed

- **Settings Layout**: Moved settings navigation to left side on Windows and Linux for improved consistency

### Fixed

- **Linux Whisper Detection**: Fixed issue where Python-based Whisper could be used instead of whisper.cpp on Linux systems

## [1.2.5] - 2026-01-13

### Added

- **Model Validation**: Added validation when deleting or loading Whisper models to ensure model integrity
- **Download Cancellation**: Added ability to cancel in-progress model downloads in whisper pickers
- **Windows Paste Performance**: Added nircmd for faster text pasting on Windows

### Fixed

- **EventEmitter Memory Leak**: Fixed memory leak caused by duplicate listener registration in useUpdater hook across ControlPanel and SettingsPage components
- **FFmpeg Path Resolution**: Fixed FFmpeg path resolution in unpacked ASAR for local whisper.cpp transcription

### Changed

- **UI Cleanup**: Removed redundant UI elements for a cleaner interface

## [1.2.4] - 2026-01-13

### Changed

- **whisper.cpp Packaging**: Moved whisper.cpp binaries from ASAR to extraResources for improved reliability and faster startup

### Fixed

- **Package Lock Sync**: Fixed package-lock.json synchronization with package.json dependencies

## [1.2.3] - 2026-01-13

### Added

- **Extended Hotkey Support**: Added numpad keys, media keys, and additional special keys (Pause, ScrollLock, PrintScreen, NumLock) for hotkey selection
- **Improved Hotkey Error Messages**: Registration failures now include helpful suggestions for alternative hotkeys

### Changed

- **Linux Paste Tools**: Only show paste tools installation prompt on Linux when tools are not available

### Fixed

- **Hotkey Debugging**: Added comprehensive debug logging to hotkey manager for troubleshooting registration issues

## [1.2.2] - 2026-01-13

### Fixed

- **React Version Mismatch**: Fixed blank screen caused by incompatible React and React-DOM versions in package-lock.json

## [1.2.1] - 2026-01-13

### Fixed

- **Blank Screen on Upgrade**: Fixed white screen issue for users upgrading from older versions with different onboarding step counts. The onboarding step index is now properly clamped to valid range.

## [1.2.0] - 2026-01-13

### Added

- **Delete All Whisper Models**: New option to delete all downloaded Whisper models at once
- **Model Deletion Confirmation**: Added confirmation dialog when deleting models in settings

### Changed

- **Migrated to whisper.cpp**: Replaced Python-based Whisper with native whisper.cpp for faster, more reliable transcription
  - No longer requires Python installation
  - WebM-to-WAV audio conversion built-in
  - Significantly improved startup and transcription speed
- **Streamlined Onboarding**: Simplified setup flow with fewer steps now that Python is not required
- **Download Cancellation**: Added ability to cancel in-progress model downloads
- **CI/CD Updates**: Updated build and release workflows

### Fixed

- **IPC Handler**: Fixed broken IPC handler for model operations
- **Logging**: Standardized logging across the application
- **React Hook Dependencies**: Improved React hook dependency arrays for better performance
- **Button Styling**: Fixed button styling consistency across the application

### Removed

- **Python Dependency**: Removed Python requirement and all related installation code
- **whisper_bridge.py**: Removed Python-based Whisper bridge in favor of native whisper.cpp

## [1.1.2] - 2026-01-12

### Added

- **Linux Package Dependencies**: Recommended xdotool, wtype, and python3 packages for Linux users

### Fixed

- **Python Installation Race Condition**: Fixed race condition in Python installation check that could cause installation to fail or hang

## [1.1.1] - 2026-01-12

### Added

- **Cross-Platform Paste Tools Detection**: Onboarding now detects and guides users through installing paste tools on Linux and Windows with auto-grant accessibility

### Changed

- **Qwen Model Compatibility**: Disabled thinking mode for Qwen models on Groq to prevent compatibility issues
- **Model Registry Refactor**: disableThinking flag now uses the centralized model registry
- **Consolidated ColorScheme Types**: Removed redundant default exports and cleaned up inline font styles
- **Provider Icons**: Use static imports for provider icons to fix Vite bundling issues

### Fixed

- **Recording Cancellation**: Restored cancel recording functionality that was accidentally removed
- **Model Downloads**: Implemented atomic downloads with temp file pattern and robust cleanup handling for cross-platform reliability
- **Incomplete Download Prevention**: Model file size validation now prevents incomplete downloads from showing as complete
- **Windows PowerShell Performance**: Optimized paste startup time on Windows

## [1.1.0] - 2026-01-10

### Added

- **Compound Hotkey Support**: Use multi-key combinations like `Cmd+Shift+K` or `Ctrl+Alt+D` for dictation
- **Groq API Integration**: Ultra-fast AI inference with Groq's cloud API
- **Auto-Update UI**: Download progress bars and install button in settings
- **Recording Cancellation**: Cancel an in-progress recording without transcribing
- **Release Notes Viewer**: Markdown-rendered release notes in settings

### Changed

- **Major Hotkey Refactor**: Complete rewrite of hotkey selection with improved reliability and validation
- **Consolidated Model Registry**: Single source of truth for all AI models (`modelRegistryData.json`)
- **Unified Model Picker**: Reusable component for both transcription and reasoning model selection
- **Improved Latency Logging**: Numbered stage logs for recording, transcription, reasoning, and paste timing
- **Reduced Paste Delay**: Lowered from 100ms to 50ms for faster text insertion
- **Code Quality**: Added ESLint, Prettier for JS/TS, and Ruff for Python

### Fixed

- **Windows 11 Compatibility**: Fixed PATH separator, cache directories, and process termination
- **Python Virtual Environment**: Fixed race condition and added Arch Linux venv support
- **Microphone Detection**: Improved onboarding flow for missing inputs with deep-linking to system settings
- **Recording State Alignment**: Recording now aligns to MediaRecorder's actual start/stop events
- **Caching Optimizations**: Cached accessibility, paste tool, and FFmpeg checks to reduce process spawns
- **Window Titles**: Electron window titles now set correctly after page load

## [1.0.15] - 2026-01-05

### Added

- Button to fully quit OpenWhispr processes from the application
- Linux terminal detection with automatic paste key switching (Ctrl+Shift+V for terminals)

### Changed

- Standardized logging on log levels with renderer IPC and `.env` refresh for consistent debug output

### Fixed

- Use `kdotool` for Wayland terminal detection, improving clipboard paste reliability
- Increased delay before restoring clipboard to avoid race conditions during paste operations
- Persist OpenAI key before onboarding test to prevent key loss during setup
- Windows Python discovery now correctly handles output parsing
- Keep FFmpeg debug schema as boolean type
- Fixed OpenWhispr documentation paths
- Windows: Resolved issue #16 with WAV validation, registry-based Python detection, and normalized FFmpeg paths

## [1.0.13] - 2025-12-24

### Added

- Enhanced Linux support with Wayland compatibility, multiple package formats (AppImage, deb, rpm, Flatpak), and native window controls
- Auto-detect existing Python during onboarding and gate the installer with a recheck option
- "Use Existing Python" skip flow to onboarding with confirmation dialog

### Changed

- Reuse audio manager and stabilize dictation toggle callback to fix recording latency
- Add cleanup functions to IPC listeners to prevent memory leaks
- Make Flatpak opt-in for local builds only

### Fixed

- Optimized transcription pipeline with caching, batched reads, and non-blocking operations for improved performance
- Reference error in settings page
- Removed redundant audio listener causing unnecessary processing
- Added IPC listener cleanup to prevent memory leaks
- Performance improvements: removed duplicate useEffect, fixed blur causing re-renders

### CI/CD

- Add caching for Electron and Flatpak downloads
- Add Flatpak runtime installation to workflow
- Add Linux packaging dependencies to GitHub Actions workflow

## [1.0.12] - 2025-11-13

### Added

- Added `scripts/complete-uninstall.sh` plus a new TROUBLESHOOTING guide so you can collect arch diagnostics, clean caches, and reset permissions before reinstalling stubborn builds.
- Control Panel history now auto-refreshes through a shared store and IPC events, so new, deleted, or cleared transcripts sync instantly without a manual refresh.
- Distribution artifacts now include both Apple Silicon and Intel macOS DMG/ZIP outputs, and the README documents Debian/Ubuntu packaging along with optional `xdotool` support.

### Changed

- The onboarding flow now validates dictation hotkeys before letting you continue, remembers whether cloud auth was skipped, and only persists sanitized API keys once supplied.
- History entries normalize timestamps and no longer run the removed legacy text cleanup helper, so the UI shows the exact Whisper output that was saved.

### Fixed

- Local Whisper now finds Python on Windows more reliably by scanning typical install paths, honoring `OPENWHISPR_PYTHON`, and surfacing actionable ENOENT guidance.
- Whisper installs automatically retry pip operations that hit PEP‑668, TOML, or permission errors, sanitizing the output and falling back to `--user` + legacy resolver when needed.

## [1.0.11] - 2025-10-13

### Added

- Settings, onboarding, and the AI model selector now accept OpenAI-compatible custom base URLs for both transcription and reasoning providers, complete with validation and reset helpers.
- Windows now gets full tray behavior: closing the control panel hides it to the tray, left-click reopens it, and the UI adds a native close button.

### Changed

- ReasoningService sends both `input` and `messages` payloads and automatically falls back between `/responses` and `/chat/completions` so older OpenAI-compatible endpoints keep working.

### Fixed

- Successful endpoint detection is cached per base URL, so the app remembers whether to call `/responses` or `/chat/completions` instead of retrying the wrong path forever.
- Custom endpoint fields now enforce HTTPS (with localhost as the lone exception) across the UI and services, preventing API keys from ever leaving over plain HTTP.

## [1.0.10] - 2025-10-07

### Added

- Added a `compile:globe` build step that emits a macOS Globe listener binary into `resources/bin` before every dev, pack, or dist command so the hotkey ships with all builds.

### Fixed

- Globe key failures now raise a macOS dialog, verify the bundled binary is executable, and kill/restart the listener cleanly so the shortcut survives packaging.

## [1.0.9] - 2025-10-07

### Changed

- Simplified the release workflow by removing the bespoke GitHub release job and letting electron-builder upload draft releases directly.

## [1.0.8] - 2025-10-03

### Fixed

- Globe/Fn hotkey reliability improved by showing the dictation panel before toggling, making focus optional, and surfacing listener spawn errors instead of failing silently.

## [1.0.7] - 2025-10-03

### Added

- Settings update controls now show download progress bars, install countdowns, and clearer messaging while fetching or installing new builds.

### Changed

- Auto-update internals now track listeners, cache the last release metadata, and keep auto-download/auto-install disabled until the user explicitly triggers an update, eliminating the previous memory leaks.

### Fixed

- `Install & Restart` now emits `before-quit`, enables `autoInstallOnAppQuit`, logs progress, and calls `quitAndInstall(false, true)` so updates actually apply when quitting or pressing the button.

## [1.0.6] - 2025-09-11

### Added

- **Dictation Panel Command Menu**: Clicking the floating panel reveals quick actions, including a one-click "Hide this for now" option.
- **macOS Globe Key Support**: Added a lightweight Swift listener so the Globe/Fn key can toggle dictation across the system.
- **Globe Key Selection UI**: Settings and onboarding keyboards now include a dedicated Globe key option.
- **Hotkey Validation**: Settings and onboarding now verify shortcut registration immediately, alerting users when a key can’t be bound.
- **Model Cache Cleanup**: Added an in-app command (and installer/uninstaller hooks) to delete all cached Whisper models.
- **Tray Controls**: macOS tray menu gained quick actions to show or hide the dictation panel.

### Changed

- **Dictation Overlay Placement**: Window now anchors to the active workspace's bottom-right corner with a safety margin, preventing it from sliding off-screen on multi-monitor setups.
- **Dictation Overlay Canvas**: Enlarged the floating window so tooltips, menus, and error states render without being clipped while keeping click-through behaviour outside interactive elements.
- **Keyboard UX**: Virtual keyboard hides macOS-exclusive keys on Windows/Linux and standardises hotkey labels.

### Fixed

- **macOS Window Lifecycle**: Ensured the dictation panel keeps the app visible in Dock and Command-Tab while retaining floating behaviour across spaces.
- **Control Panel Stability**: Reworked close/minimize handling so the panel stays interactive when switching apps and reopens cleanly without spawning duplicate windows.
- **Always-On-Top Enforcement**: Centralised the logic that reapplies floating window levels, eliminating redundant timers and focus quirks.
- **Menu Labelling**: macOS application menu items now display the correct OpenWhispr casing instead of "open-whispr".
- **Non-mac Hotkey Guard**: Prevented the mac-only Globe shortcut from being saved on Windows/Linux.

## [1.0.5] - 2025-09-10

### Fixed

- **Build System**: Fixed native module signing conflicts on macOS
  - Added `npmRebuild: true` to force rebuild of native modules during packaging
  - Added `buildDependenciesFromSource: true` to compile native dependencies from source
  - Added `better-sqlite3` to `asarUnpack` array to properly unpack SQLite3 native module
  - Resolves "different Team IDs" error when launching notarized macOS apps
- **CI/CD Pipeline**: Fixed automated release workflow issues
  - Removed automatic version update step from release workflow (version should be set before tagging)
  - Added `contents: write` permission to allow workflow to create GitHub releases
  - Fixes "Resource not accessible by integration" error during releases

### Technical Details

- This is a maintenance release focusing on build reliability and deployment infrastructure
- No feature changes or user-facing functionality updates
- All changes related to packaging, signing, and automated release processes

## [1.0.4] - 2025-09-09

### Added

- **Multi-Provider AI Support**: Integrated three major AI providers for text processing
  - OpenAI: Complete model suite including:
    - GPT-5 Series (Nano/Mini/Full) - Latest generation with deep reasoning
    - GPT-4.1 Series (Nano/Mini/Full) - Enhanced coding, 1M token context, June 2024 knowledge
    - o-series (o3/o3-pro/o4-mini) - Advanced reasoning models with extended thinking time
    - GPT-4o/4o-mini - Multimodal models with vision support
  - Anthropic: Claude Opus 4.1, Sonnet 4, and 3.5 variants for frontier intelligence
  - Google: Gemini 2.5 Pro/Flash/Flash-Lite and 2.0 Flash for advanced processing
- **OpenAI Responses API Integration**: Migrated from Chat Completions to the new Responses API
  - Simplified request format with `input` array instead of `messages`
  - New response parsing for `output` items with typed content
  - Automatic handling of model-specific requirements
  - Better support for GPT-5 and o-series reasoning models
- **Enhanced Reasoning Service**: Complete TypeScript rewrite with provider abstraction
  - Automatic provider detection based on selected model
  - Secure API key caching with TTL
  - Unified retry strategies across all providers
  - Provider-specific token optimization (up to 8192 for Gemini)
- **Comprehensive Debug Logging**: Enhanced reasoning pipeline with stage-by-stage logging
  - Provider selection and routing logs
  - API key retrieval and validation logs
  - Request/response details for all providers
  - Error tracking with full stack traces
- **Improved Settings UI**: Comprehensive API key management for all providers
  - Color-coded provider sections (OpenAI=green, Anthropic=purple, Gemini=blue)
  - Inline API key validation and secure storage
  - Provider-specific model selection with descriptions

### Changed

- **Default AI Model**: Updated from GPT-3.5 Turbo to GPT-4o Mini for cost-efficient multimodal support
- **Model Updates**: Refreshed all AI models to their latest 2025 versions
  - OpenAI: Added GPT-5 family (released August 2025), migrated to Responses API
  - Anthropic: Updated to Claude Opus 4.1 and Sonnet 4, fixed model naming
  - Gemini: Added latest 2.5 series models, increased token limits
- **ReasoningService**: Migrated from JavaScript to TypeScript for better type safety
- **API Endpoint Updates**:
  - OpenAI: Migrated from `/v1/chat/completions` to `/v1/responses`
  - Request format simplified for better performance
  - Response parsing updated for new output structure
- **Model Configuration Improvements**:
  - Fixed Anthropic model names (using hyphens instead of dots)
  - Increased Gemini 2.5 Pro token limits (2000 minimum)
  - Removed temperature parameter for GPT-5 and o-series models
- **Documentation**: Updated CLAUDE.md, README.md with comprehensive provider information

### Fixed

- **API Key Persistence**: All provider keys now properly save to `.env` file
  - Added `saveAllKeysToEnvFile()` method for consistent persistence
  - Keys reload automatically on app restart
  - Fixed Gemini and Anthropic key storage issues
- **CORS Issues**: Anthropic API calls now route through IPC handler
  - Avoids browser CORS restrictions in renderer process
  - Proper error handling in main process
- **Empty Response Handling**: Fixed "No text transcribed" error when AI returns empty
  - Falls back to original text when API returns nothing
  - Properly handles edge cases in response parsing
- **Parameter Compatibility**: Fixed OpenAI API parameter errors
  - GPT-5 models use simplified parameters (no max_tokens)
  - o-series models configured without temperature
  - Older models retain full parameter support

### Technical Improvements

- Added Gemini API integration with proper authentication flow
- Implemented SecureCache utility for API key management
- Enhanced IPC handlers for multi-provider support
- Updated environment manager with Gemini key storage
- Improved error handling with provider-specific messages
- Added comprehensive retry logic with exponential backoff
- Enhanced error messages with detailed logging
- Better fallback strategies for API failures
- Improved response validation and parsing
- Centralized API configuration in constants file
- Unified debugging system across all providers

## [1.0.3] - 2024-12-20

### Added

- **Local AI Models**: Integration with community models for complete privacy
  - Support for Llama, Mistral, and other open-source models
  - Local model management UI with download progress
  - Automatic model validation and testing
- **Enhanced Security**: Improved API key storage and management
  - System keychain integration where available
  - Encrypted localStorage fallback
  - Automatic key rotation support

### Fixed

- Resolved issues with Whisper model downloads on slow connections
- Fixed clipboard pasting reliability on Windows 11
- Improved error messages for better debugging
- Fixed memory leaks in long-running sessions

### Changed

- Optimized audio processing pipeline for 30% faster transcription
- Reduced app bundle size by 15MB through dependency optimization
- Improved startup time by lazy-loading heavy components

## [1.0.2] - 2024-12-19

### Added

- **Automatic Python Installation**: The app now detects and offers to install Python automatically
  - macOS: Uses Homebrew if available, falls back to official installer
  - Windows: Downloads and installs official Python with proper PATH configuration
  - Linux: Uses system package manager (apt, yum, or pacman)
- **Enhanced Developer Experience**:
  - Added MIT LICENSE file
  - Improved documentation for personal vs distribution builds
  - Added FAQ section to README
  - Added security information section
  - Clearer prerequisites and setup instructions
  - Added comprehensive CLAUDE.md technical reference
- **Dock Icon Support**: App now appears in the dock with activity indicator
  - Changed LSUIElement from true to false in electron-builder.json
  - App shows in dock on macOS with the standard dot indicator when running

### Changed

- Updated supported language count from 90+ to 58 (actual count in codebase)
- Improved README structure for better open source experience

## [1.0.1] - 2024-XX-XX

### Added

- **Agent Naming System**: Personalize your AI assistant with a custom name for more natural interactions
  - Name your agent during onboarding (step 6 of 8)
  - Address your agent directly: "Hey [AgentName], make this more professional"
  - Update agent name anytime through settings
  - Smart AI processing distinguishes between commands and regular dictation
  - Clean output automatically removes agent name references
- **Draggable Interface**: Click and drag the dictation panel to any position on screen
- **Dynamic Hotkey Display**: Tooltip shows your actual hotkey setting instead of generic text
- **Flexible Hotkey System**: Fixed hardcoded hotkey limitation - now fully respects user settings

### Changed

- **[BREAKING]** Removed click-to-record functionality to prevent conflicts with dragging
- **UI Behavior**: Recording is now exclusively controlled via hotkey (no accidental triggering)
- **Tooltip Text**: Shows "Press {your-hotkey} to speak" with actual configured hotkey
- **Cursor Styles**: Changed to grab/grabbing cursors to indicate draggable interface

### Fixed

- **Hotkey Bug**: Fixed issue where hotkey setting was stored but not actually used by global shortcut
- **Documentation**: Updated all docs to reflect current UI behavior and hotkey system
- **User Experience**: Eliminated confusion between drag and click actions

### Technical Details

- **Agent Naming Implementation**:
  - Added centralized agent name utility (`src/utils/agentName.ts`)
  - Enhanced onboarding flow with agent naming step
  - Updated ReasoningService with context-aware AI processing
  - Added agent name settings section with comprehensive UI
  - Implemented smart prompt generation for agent-addressed vs regular text
- Added IPC handlers for dynamic hotkey updates (`update-hotkey`)
- Implemented window-level dragging using screen cursor tracking
- Added real-time hotkey loading from localStorage in main dictation component
- Updated WindowManager to support runtime hotkey changes
- Added proper drag state management with smooth 60fps window positioning
- **Code Organization**: Extracted functionality into dedicated managers and React hooks:
  - HotkeyManager, DragManager, AudioManager, MenuManager, DevServerManager
  - useAudioRecording, useWindowDrag, useHotkey React hooks
  - WindowConfig utility for centralized window configuration
  - Reduced WindowManager from 465 to 190 lines through composition pattern

## [0.1.0] - 2024-XX-XX

### Added

- Initial release of OpenWhispr (formerly OpenWispr)
- Desktop dictation application using OpenAI Whisper
- Local and cloud-based speech-to-text transcription
- Real-time audio recording and processing
- Automatic text pasting via accessibility features
- SQLite database for transcription history
- macOS tray icon integration
- Global hotkey support (backtick key)
- Control panel for settings and configuration
- Local Whisper model management
- OpenAI API integration
- Cross-platform support (macOS, Windows, Linux)

### Features

- **Speech-to-Text**: Convert voice to text using OpenAI Whisper
- **Dual Processing**: Choose between local processing (private) or cloud processing (fast)
- **Model Management**: Download and manage local Whisper models (tiny, base, small, medium, large)
- **Transcription History**: View, copy, and delete past transcriptions
- **Accessibility Integration**: Automatic text pasting with proper permission handling
- **API Key Management**: Secure storage and management of OpenAI API keys
- **Real-time UI**: Live feedback during recording and processing
- **Global Hotkey**: Quick access via customizable keyboard shortcut
- **Database Storage**: Persistent storage of transcriptions with SQLite
- **Permission Management**: Streamlined macOS accessibility permission setup

### Technical Stack

- **Frontend**: React 19, Vite, TailwindCSS, Shadcn/UI components
- **Backend**: Electron 36, Node.js
- **Database**: better-sqlite3 for local storage
- **AI Processing**: OpenAI Whisper (local and API)
- **Build System**: Electron Builder for cross-platform packaging

### Security

- Local-first approach with optional cloud processing
- Secure API key storage and management
- Sandboxed renderer processes with context isolation
- Proper clipboard and accessibility permission handling
