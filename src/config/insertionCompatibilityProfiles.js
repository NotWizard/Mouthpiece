const COMPATIBILITY_PROFILES = [
  {
    id: "browser_text_input",
    family: "browser",
    label: "Browser text inputs",
    appMatchers: [/(chrome|safari|firefox|edge|arc|brave|vivaldi|opera)/i],
    retry: {
      autoPasteAttempts: 2,
      retryDelayMs: 140,
    },
    fallback: {
      allowClipboardCopy: true,
      downgradeUnverifiedAutoPaste: false,
      feedbackCode: "browser_manual_paste",
      recoveryHint: "focus_browser_input_then_paste",
      manualAction: "paste_with_shortcut",
    },
    expectedInsertionMode: "replace_preferred",
    knownGap: "Rich contenteditable surfaces can still reject simulated paste intermittently.",
  },
  {
    id: "electron_editor",
    family: "electron",
    label: "Electron editors",
    appMatchers: [/(notion|obsidian|linear|postman|figma|electron)/i],
    retry: {
      autoPasteAttempts: 2,
      retryDelayMs: 120,
    },
    fallback: {
      allowClipboardCopy: true,
      downgradeUnverifiedAutoPaste: false,
      feedbackCode: "electron_manual_paste",
      recoveryHint: "refocus_editor_then_paste",
      manualAction: "paste_with_shortcut",
    },
    expectedInsertionMode: "intent_driven",
    knownGap: "Embedded editors may steal focus after overlays or toast updates.",
  },
  {
    id: "chat_app",
    family: "chat",
    label: "Chat applications",
    appMatchers: [/(slack|discord|teams|telegram|wechat|whatsapp|messages|signal)/i],
    retry: {
      autoPasteAttempts: 2,
      retryDelayMs: 120,
    },
    fallback: {
      allowClipboardCopy: true,
      downgradeUnverifiedAutoPaste: false,
      feedbackCode: "chat_manual_paste",
      recoveryHint: "reopen_compose_box_then_paste",
      manualAction: "paste_with_shortcut",
    },
    expectedInsertionMode: "replace_preferred",
    knownGap: "Some chat apps reopen slash-command pickers and replace selection unexpectedly.",
  },
  {
    id: "document_editor",
    family: "document",
    label: "Document editors",
    appMatchers: [/(word|pages|docs|google docs|craft|bear|ulysses)/i],
    retry: {
      autoPasteAttempts: 2,
      retryDelayMs: 180,
    },
    fallback: {
      allowClipboardCopy: true,
      downgradeUnverifiedAutoPaste: false,
      feedbackCode: "document_manual_paste",
      recoveryHint: "confirm_caret_position_then_paste",
      manualAction: "paste_with_shortcut",
    },
    expectedInsertionMode: "intent_driven",
    knownGap: "Heavy document editors sometimes delay focus restoration after window switches.",
  },
  {
    id: "terminal_ide",
    family: "terminal",
    label: "Terminals and IDEs",
    appMatchers: [
      /(terminal|iterm|warp|ghostty|wezterm|alacritty|kitty|hyper|powershell|cmd|cursor|vscode|visual studio code|intellij|pycharm|webstorm|goland|xcode)/i,
    ],
    retry: {
      autoPasteAttempts: 1,
      retryDelayMs: 0,
    },
    fallback: {
      allowClipboardCopy: true,
      downgradeUnverifiedAutoPaste: true,
      feedbackCode: "terminal_manual_review",
      recoveryHint: "confirm_shell_focus_before_manual_paste",
      manualAction: "paste_with_terminal_shortcut",
    },
    expectedInsertionMode: "manual_review",
    knownGap: "Unverified paste automation is intentionally downgraded to avoid accidental command execution.",
  },
  {
    id: "generic",
    family: "generic",
    label: "Generic text fields",
    appMatchers: [],
    retry: {
      autoPasteAttempts: 2,
      retryDelayMs: 120,
    },
    fallback: {
      allowClipboardCopy: true,
      downgradeUnverifiedAutoPaste: false,
      feedbackCode: "generic_manual_paste",
      recoveryHint: "paste_with_shortcut",
      manualAction: "paste_with_shortcut",
    },
    expectedInsertionMode: "intent_driven",
    knownGap: "Unknown apps fall back to generic assumptions until they are explicitly profiled.",
  },
];

function cloneProfile(profile, matchedAppName = null, matchedPattern = null) {
  return {
    ...profile,
    appMatchers: [...profile.appMatchers],
    retry: { ...profile.retry },
    fallback: { ...profile.fallback },
    matchedAppName,
    matchedPattern,
  };
}

function normalizeAppName(targetApp) {
  if (!targetApp || typeof targetApp.appName !== "string") {
    return "";
  }

  return targetApp.appName.trim();
}

function getInsertionCompatibilityProfiles() {
  return COMPATIBILITY_PROFILES.map((profile) => cloneProfile(profile));
}

function resolveInsertionCompatibilityProfile({ targetApp } = {}) {
  const appName = normalizeAppName(targetApp);

  for (const profile of COMPATIBILITY_PROFILES) {
    const matchedPattern = profile.appMatchers.find((matcher) => matcher.test(appName));
    if (matchedPattern) {
      return cloneProfile(profile, appName || null, matchedPattern.source);
    }
  }

  return cloneProfile(COMPATIBILITY_PROFILES[COMPATIBILITY_PROFILES.length - 1], appName || null);
}

module.exports = {
  getInsertionCompatibilityProfiles,
  resolveInsertionCompatibilityProfile,
};

module.exports.default = module.exports;
