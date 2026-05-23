import { formatHotkeyLabelForPlatform, isGlobeLikeHotkey } from "./hotkeys";

export type Platform = "darwin" | "win32";

export type ValidationErrorCode =
  | "TOO_MANY_KEYS"
  | "NO_MODIFIER_OR_SPECIAL"
  | "LEFT_RIGHT_MIX"
  | "LEFT_MODIFIER_ONLY"
  | "DUPLICATE"
  | "RESERVED"
  | "INVALID_GLOBE";

export interface ValidationResult {
  valid: boolean;
  error?: string;
  errorCode?: ValidationErrorCode;
}

const MODIFIER_ORDER = ["Control", "Command", "Alt", "Shift", "Super", "Fn"];

const MODIFIERS = new Set(MODIFIER_ORDER);

const RIGHT_SIDE_MODIFIERS = new Set([
  "rightcontrol",
  "rightctrl",
  "rightalt",
  "rightoption",
  "rightshift",
  "rightcommand",
  "rightcmd",
  "rightsuper",
  "rightmeta",
  "rightwin",
]);

function isRightSideModifier(part: string): boolean {
  const normalized = part.replace(/[-_ ]/g, "").toLowerCase();
  return RIGHT_SIDE_MODIFIERS.has(normalized);
}

// True when the hotkey contains only modifier keys (no real activation key).
// Such hotkeys can only be served by the native push-to-talk binaries
// (GlobeKeyManager / WindowsKeyManager); Electron's globalShortcut won't accept
// them. Used by the translation hotkey row to inline-reject Right Option / Fn /
// modifier-only combos before they silently fail at register time.
export function isModifierOnlyAccelerator(hotkey: string): boolean {
  if (!hotkey || !hotkey.trim()) return false;
  const parts = hotkey
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return false;
  return parts.every((part) => {
    const normalized = part.replace(/[-_ ]/g, "").toLowerCase();
    if (RIGHT_SIDE_MODIFIERS.has(normalized)) return true;
    return MODIFIERS.has(part);
  });
}

const SPECIAL_KEYS = new Set(
  [
    "GLOBE",
    "Fn",
    "Esc",
    "Tab",
    "Space",
    "Backspace",
    "Insert",
    "Delete",
    "Home",
    "End",
    "PageUp",
    "PageDown",
    "Left",
    "Right",
    "Up",
    "Down",
    "PrintScreen",
    "Pause",
    "ScrollLock",
    "NumLock",
  ].concat(Array.from({ length: 24 }, (_, i) => `F${i + 1}`))
);

const MAC_RESERVED_SHORTCUTS = [
  "Command+C",
  "Command+V",
  "Command+X",
  "Command+Z",
  "Command+Shift+Z",
  "Command+A",
  "Command+Q",
  "Command+W",
  "Command+R",
  "Command+T",
  "Command+S",
  "Command+P",
  "Command+N",
  "Command+M",
  "Command+H",
  "Command+F",
  "Command+G",
  "Command+Shift+G",
  "Command+,",
  "Command+Left",
  "Command+Right",
  "Command+Up",
  "Command+Down",
  "Command+Shift+Left",
  "Command+Shift+Right",
  "Command+Shift+Up",
  "Command+Shift+Down",
  "Command+Control+F",
  "Command+Space",
  "Command+Alt+Space",
  "Command+Shift+3",
  "Command+Shift+4",
  "Command+Shift+5",
  "Command+Alt+Esc",
  "Command+Alt+D",
  "Command+Delete",
  "Command+Shift+Delete",
  "Command+Shift+Q",
  "Command+B",
  "Command+I",
  "Command+U",
  "Command+Shift+T",
  "Command+=",
  "Command+-",
  "Command+Alt+F",
  "Command+Shift+F",
  "Fn+F11",
  "Fn+F12",
] as const;

const WINDOWS_RESERVED_SHORTCUTS = [
  "Control+C",
  "Control+V",
  "Control+X",
  "Control+Z",
  "Control+Y",
  "Control+R",
  "Control+A",
  "Control+F",
  "Control+G",
  "Control+O",
  "Control+S",
  "Control+P",
  "Control+N",
  "Control+T",
  "Control+W",
  "Control+Home",
  "Control+End",
  "Control+Alt+Delete",
  "Control+Shift+Esc",
  "Control+Backspace",
  "Control+Delete",
  "Control+K",
  "Control+Shift+T",
  "Control+=",
  "Control+-",
  "Alt+Tab",
  "Alt+F4",
  "Alt+Left",
  "Alt+Right",
  "Alt+PrintScreen",
  "F5",
  "F11",
  "Home",
  "End",
  "PrintScreen",
  "Super+E",
  "Super+R",
  "Super+L",
  "Super+D",
  "Super+Tab",
  "Super+I",
  "Super+S",
  "Super+X",
  "Super+P",
  "Super+Q",
  "Super+U",
  "Super+B",
  "Super+Up",
  "Super+Down",
] as const;

const MAC_RECOMMENDED = [
  "Fn",
  "Right Cmd",
  "Right Option",
  "Right Cmd or Right Option",
  "One modifier + unused key (e.g., Ctrl + Page Up)",
] as const;

const WINDOWS_RECOMMENDED = [
  "Ctrl",
  "Alt",
  "Ctrl (right) or Alt (right)",
  "One modifier + rarely used key (e.g., Ctrl + Page Up)",
] as const;

const MAC_EXAMPLES = [
  "Control+K",
  "Alt+F7",
  "Command+9",
  "Control+Space",
  "Command+M",
  "Shift+F9",
] as const;

const WINDOWS_EXAMPLES = [
  "Control+K",
  "Alt+F7",
  "Control+Space",
  "Alt+M",
  "Shift+F9",
] as const;

export const VALIDATION_RULES = [
  "Uses three keys or fewer",
  "Uses a supported modifier by itself, or exactly one modifier plus one key",
  "Does not mix left and right versions of the same modifier",
  "Is not reserved by the system",
] as const;

function normalizeModifier(part: string, platform: Platform): string | null {
  const trimmed = part.replace(/\s+/g, "");
  const lowered = trimmed.toLowerCase();

  if (lowered === "commandorcontrol" || lowered === "cmdorctrl") {
    return platform === "darwin" ? "Command" : "Control";
  }

  if (lowered === "command" || lowered === "cmd") {
    return "Command";
  }

  if (lowered === "control" || lowered === "ctrl") {
    return "Control";
  }

  if (lowered === "alt" || lowered === "option") {
    return "Alt";
  }

  if (lowered === "shift") {
    return "Shift";
  }

  if (lowered === "super" || lowered === "win" || lowered === "meta") {
    return platform === "darwin" ? "Command" : "Super";
  }

  if (lowered === "fn") {
    return "Fn";
  }

  // Handle right-side modifiers (e.g., RightControl, RightOption)
  // These are valid modifiers but we preserve their "Right" prefix for single-modifier validation
  if (isRightSideModifier(part)) {
    // Return a normalized form but mark it as a modifier
    if (lowered.includes("control") || lowered.includes("ctrl")) return "RightControl";
    if (lowered.includes("alt") || lowered.includes("option"))
      return platform === "darwin" ? "RightOption" : "RightAlt";
    if (lowered.includes("shift")) return "RightShift";
    if (lowered.includes("command") || lowered.includes("cmd")) return "RightCommand";
    if (lowered.includes("super") || lowered.includes("meta") || lowered.includes("win")) {
      return platform === "darwin" ? "RightCommand" : "RightSuper";
    }
  }

  return null;
}

function normalizeKeyToken(part: string): string {
  const trimmed = part.replace(/\s+/g, "");
  const lowered = trimmed.toLowerCase();

  if (lowered === "arrowleft") return "Left";
  if (lowered === "arrowright") return "Right";
  if (lowered === "arrowup") return "Up";
  if (lowered === "arrowdown") return "Down";
  if (lowered === "escape" || lowered === "esc") return "Esc";
  if (lowered === "printscreen" || lowered === "print") return "PrintScreen";
  if (lowered === "pageup" || lowered === "pgup") return "PageUp";
  if (lowered === "pagedown" || lowered === "pgdown") return "PageDown";
  if (lowered === "scrolllock") return "ScrollLock";
  if (lowered === "numlock") return "NumLock";
  if (lowered === "delete" || lowered === "del") return "Delete";
  if (lowered === "insert" || lowered === "ins") return "Insert";
  if (lowered === "space") return "Space";
  if (lowered === "tab") return "Tab";
  if (lowered === "home") return "Home";
  if (lowered === "end") return "End";
  if (lowered === "backspace") return "Backspace";
  if (lowered === "globe") return "GLOBE";
  if (lowered === "fn") return "Fn";

  const functionMatch = lowered.match(/^f(\d{1,2})$/);
  if (functionMatch) {
    return `F${functionMatch[1]}`;
  }

  if (trimmed.length === 1) {
    return trimmed.toUpperCase();
  }

  return trimmed;
}

function isLeftRightMix(parts: string[]): boolean {
  const sidesByModifier = new Map<string, Set<string>>();

  const patterns = [
    /^(left|right)[-_ ]?(ctrl|control|alt|option|shift|command|cmd|super|meta)$/i,
    /^(ctrl|control|alt|option|shift|command|cmd|super|meta)[-_ ]?(left|right)$/i,
  ];

  for (const rawPart of parts) {
    const part = rawPart.replace(/\s+/g, "");
    for (const pattern of patterns) {
      const match = part.match(pattern);
      if (match) {
        const side = match[1].toLowerCase().includes("left") ? "left" : "right";
        const modifier = match[2]?.toLowerCase() || match[1]?.toLowerCase();
        if (!modifier) continue;
        const normalizedModifier =
          modifier === "ctrl"
            ? "control"
            : modifier === "cmd"
              ? "command"
              : modifier === "option"
                ? "alt"
                : modifier;
        const set = sidesByModifier.get(normalizedModifier) ?? new Set<string>();
        set.add(side);
        sidesByModifier.set(normalizedModifier, set);
      }
    }
  }

  for (const set of sidesByModifier.values()) {
    if (set.size > 1) {
      return true;
    }
  }

  return false;
}

export function normalizeHotkey(hotkey: string, platform: Platform): string {
  if (!hotkey) return "";

  const parts = hotkey
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);

  const modifiers: string[] = [];
  const keys: string[] = [];

  for (const part of parts) {
    const normalizedModifier = normalizeModifier(part, platform);
    if (normalizedModifier) {
      modifiers.push(normalizedModifier);
      continue;
    }

    keys.push(normalizeKeyToken(part));
  }

  modifiers.sort((a, b) => MODIFIER_ORDER.indexOf(a) - MODIFIER_ORDER.indexOf(b));

  return [...modifiers, ...keys].join("+");
}

export function getReservedShortcuts(platform: Platform): readonly string[] {
  switch (platform) {
    case "darwin":
      return MAC_RESERVED_SHORTCUTS;
    case "win32":
      return WINDOWS_RESERVED_SHORTCUTS;
    default:
      return [];
  }
}

export function getRecommendedPatterns(platform: Platform): readonly string[] {
  switch (platform) {
    case "darwin":
      return MAC_RECOMMENDED;
    case "win32":
      return WINDOWS_RECOMMENDED;
    default:
      return [];
  }
}

export function getValidExamples(platform: Platform): readonly string[] {
  switch (platform) {
    case "darwin":
      return MAC_EXAMPLES;
    case "win32":
      return WINDOWS_EXAMPLES;
    default:
      return [];
  }
}

export function getValidationMessage(
  hotkey: string,
  platform: Platform,
  existingHotkeys: string[] = []
): string | null {
  const result = validateHotkey(hotkey, platform, existingHotkeys);
  if (result.valid) return null;

  if (result.errorCode === "RESERVED") {
    const label = formatHotkeyLabelForPlatform(hotkey, platform);
    return `${label} is reserved by the system`;
  }

  return result.error || "That shortcut is not supported";
}

export function validateHotkey(
  hotkey: string,
  platform: Platform,
  existingHotkeys: string[] = []
): ValidationResult {
  if (!hotkey || hotkey.trim() === "") {
    return { valid: false, error: "Please enter a valid shortcut." };
  }

  if (isGlobeLikeHotkey(hotkey)) {
    if (platform !== "darwin") {
      return {
        valid: false,
        error: "The Globe/Fn key is only available on macOS.",
        errorCode: "INVALID_GLOBE",
      };
    }
    return { valid: true };
  }

  const parts = hotkey
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length > 3) {
    return {
      valid: false,
      error: "Shortcuts are limited to three keys.",
      errorCode: "TOO_MANY_KEYS",
    };
  }

  if (isLeftRightMix(parts)) {
    return {
      valid: false,
      error: "Do not mix left and right versions of the same modifier in one shortcut.",
      errorCode: "LEFT_RIGHT_MIX",
    };
  }

  let hasModifier = false;

  for (const part of parts) {
    const normalizedModifier = normalizeModifier(part, platform);
    if (normalizedModifier) {
      hasModifier = true;
      continue;
    }
  }

  // Check for modifier-only hotkeys: require right-side for single modifier, or 2+ modifiers
  const modifierCount = parts.filter((part) => normalizeModifier(part, platform) !== null).length;
  const hasBaseKey = parts.length > modifierCount;

  if (!hasBaseKey && modifierCount === 1) {
    const singleMod = parts[0];
    if (!isRightSideModifier(singleMod)) {
      return {
        valid: false,
        error:
          "Single modifier hotkeys must use the right-side key (e.g., RightOption). Or use two modifiers (e.g., Control+Alt).",
        errorCode: "LEFT_MODIFIER_ONLY",
      };
    }
  }

  if (hasBaseKey && modifierCount !== 1) {
    return {
      valid: false,
      error: "Key combinations must use exactly one modifier and one main key.",
      errorCode: "NO_MODIFIER_OR_SPECIAL",
    };
  }

  const normalizedHotkey = normalizeHotkey(hotkey, platform);
  const normalizedExisting = existingHotkeys.map((existing) => normalizeHotkey(existing, platform));

  if (normalizedExisting.includes(normalizedHotkey)) {
    return {
      valid: false,
      error: "That shortcut is already in use.",
      errorCode: "DUPLICATE",
    };
  }

  const reserved = getReservedShortcuts(platform);
  const normalizedReserved = reserved.map((entry) => normalizeHotkey(entry, platform));

  if (normalizedReserved.includes(normalizedHotkey)) {
    return {
      valid: false,
      error: "That shortcut is reserved by your system.",
      errorCode: "RESERVED",
    };
  }

  return { valid: true };
}
