import type { TargetAppInfo } from "../types/electron";
import type { InsertionIntent } from "../utils/insertionIntent";

export type InsertionCompatibilityProfileId =
  | "generic"
  | "browser_text_input"
  | "electron_editor"
  | "chat_app"
  | "document_editor"
  | "terminal_ide";

export interface InsertionCompatibilityProfile {
  id: InsertionCompatibilityProfileId;
  family: string;
  label: string;
  appMatchers: RegExp[];
  retry: {
    autoPasteAttempts: number;
    retryDelayMs: number;
  };
  fallback: {
    allowClipboardCopy: boolean;
    downgradeUnverifiedAutoPaste: boolean;
    feedbackCode: string;
    recoveryHint: string;
    manualAction: string;
  };
  expectedInsertionMode: "intent_driven" | "replace_preferred" | "manual_review";
  knownGap: string;
}

export interface ResolvedInsertionCompatibilityProfile extends InsertionCompatibilityProfile {
  matchedAppName: string | null;
  matchedPattern: string | null;
}

const COMPATIBILITY_PROFILES: InsertionCompatibilityProfile[] = [
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
    knownGap:
      "Unverified paste automation is intentionally downgraded to avoid accidental command execution.",
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

function normalizeAppName(targetApp?: Partial<TargetAppInfo> | null): string {
  if (!targetApp || typeof targetApp.appName !== "string") {
    return "";
  }

  return targetApp.appName.trim();
}

export function getInsertionCompatibilityProfiles(): InsertionCompatibilityProfile[] {
  return COMPATIBILITY_PROFILES.map((profile) => ({
    ...profile,
    appMatchers: [...profile.appMatchers],
    retry: { ...profile.retry },
    fallback: { ...profile.fallback },
  }));
}

export function resolveInsertionCompatibilityProfile({
  targetApp,
}: {
  platform?: string;
  intent?: InsertionIntent | string;
  targetApp?: Partial<TargetAppInfo> | null;
} = {}): ResolvedInsertionCompatibilityProfile {
  const appName = normalizeAppName(targetApp);

  for (const profile of COMPATIBILITY_PROFILES) {
    const matchedPattern = profile.appMatchers.find((matcher) => matcher.test(appName));
    if (matchedPattern) {
      return {
        ...profile,
        retry: { ...profile.retry },
        fallback: { ...profile.fallback },
        matchedAppName: appName || null,
        matchedPattern: matchedPattern.source,
      };
    }
  }

  const fallbackProfile = COMPATIBILITY_PROFILES[COMPATIBILITY_PROFILES.length - 1];
  return {
    ...fallbackProfile,
    retry: { ...fallbackProfile.retry },
    fallback: { ...fallbackProfile.fallback },
    matchedAppName: appName || null,
    matchedPattern: null,
  };
}
