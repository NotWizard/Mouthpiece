const MODIFIER_ONLY_MODE = "modifier-only";
const SINGLE_KEY_MODE = "single-key";
const KEY_COMBO_MODE = "key-combo";

const MAC_MODIFIER_ONLY_OPTIONS = [
  { hotkey: "GLOBE", exclusive: true },
  { hotkey: "RightCommand", exclusive: true },
  { hotkey: "RightOption", exclusive: true },
  { hotkey: "RightControl", exclusive: true },
  { hotkey: "RightShift", exclusive: true },
];

const WINDOWS_MODIFIER_ONLY_OPTIONS = [
  { hotkey: "Control" },
  { hotkey: "Alt" },
  { hotkey: "Shift" },
  { hotkey: "Super" },
  { hotkey: "RightControl", exclusive: true },
  { hotkey: "RightAlt", exclusive: true },
  { hotkey: "RightShift", exclusive: true },
  { hotkey: "RightSuper", exclusive: true },
];

const COMBO_MODIFIERS_BY_PLATFORM = {
  darwin: [{ hotkey: "Command" }, { hotkey: "Control" }, { hotkey: "Alt" }, { hotkey: "Shift" }],
  win32: [{ hotkey: "Control" }, { hotkey: "Alt" }, { hotkey: "Shift" }, { hotkey: "Super" }],
  linux: [{ hotkey: "Control" }, { hotkey: "Alt" }, { hotkey: "Shift" }, { hotkey: "Super" }],
};

const MODIFIER_SORT_ORDER = [
  "GLOBE",
  "Fn",
  "Command",
  "RightCommand",
  "Control",
  "RightControl",
  "Alt",
  "RightOption",
  "RightAlt",
  "Shift",
  "RightShift",
  "Super",
  "RightSuper",
];

function normalizeModifierToken(part, platform) {
  if (!part) {
    return null;
  }

  const normalized = part.replace(/[\s_-]/g, "").toLowerCase();

  if (normalized === "globe" || normalized === "fn") return "GLOBE";
  if (normalized === "command" || normalized === "cmd") return "Command";
  if (normalized === "control" || normalized === "ctrl") return "Control";
  if (normalized === "alt" || normalized === "option") return "Alt";
  if (normalized === "shift") return "Shift";
  if (normalized === "super" || normalized === "win" || normalized === "meta") {
    return platform === "darwin" ? "Command" : "Super";
  }

  if (normalized === "rightcommand" || normalized === "rightcmd") return "RightCommand";
  if (normalized === "rightcontrol" || normalized === "rightctrl") return "RightControl";
  if (normalized === "rightoption") return "RightOption";
  if (normalized === "rightalt") return platform === "darwin" ? "RightOption" : "RightAlt";
  if (normalized === "rightshift") return "RightShift";
  if (normalized === "rightsuper" || normalized === "rightwin" || normalized === "rightmeta") {
    return platform === "darwin" ? "RightCommand" : "RightSuper";
  }

  return null;
}

function sortModifiers(modifiers) {
  return [...modifiers].sort((left, right) => {
    const leftIndex = MODIFIER_SORT_ORDER.indexOf(left);
    const rightIndex = MODIFIER_SORT_ORDER.indexOf(right);
    const safeLeftIndex = leftIndex === -1 ? MODIFIER_SORT_ORDER.length : leftIndex;
    const safeRightIndex = rightIndex === -1 ? MODIFIER_SORT_ORDER.length : rightIndex;

    if (safeLeftIndex === safeRightIndex) {
      return left.localeCompare(right);
    }

    return safeLeftIndex - safeRightIndex;
  });
}

function normalizePrimaryKeyToken(part) {
  return typeof part === "string" ? part.trim() : "";
}

function splitHotkey(hotkey) {
  return String(hotkey || "")
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function getHotkeyBuilderCapabilities({
  platform = "darwin",
  isUsingGnome = false,
} = {}) {
  if (platform === "darwin") {
    return {
      allowModifierOnlyMode: true,
      allowModifierOnlyMultiSelect: false,
      modifierOnlyOptions: MAC_MODIFIER_ONLY_OPTIONS,
      comboModifierOptions: COMBO_MODIFIERS_BY_PLATFORM.darwin,
    };
  }

  if (platform === "win32") {
    return {
      allowModifierOnlyMode: true,
      allowModifierOnlyMultiSelect: true,
      modifierOnlyOptions: WINDOWS_MODIFIER_ONLY_OPTIONS,
      comboModifierOptions: COMBO_MODIFIERS_BY_PLATFORM.win32,
    };
  }

  return {
    allowModifierOnlyMode: !isUsingGnome,
    allowModifierOnlyMultiSelect: !isUsingGnome,
    modifierOnlyOptions: isUsingGnome ? [] : COMBO_MODIFIERS_BY_PLATFORM.linux,
    comboModifierOptions: COMBO_MODIFIERS_BY_PLATFORM.linux,
  };
}

export function buildHotkeyFromBuilderState({
  mode = KEY_COMBO_MODE,
  selectedModifiers = [],
  primaryKey = "",
  platform = "darwin",
} = {}) {
  const normalizedModifiers = sortModifiers(
    selectedModifiers
      .map((modifier) => normalizeModifierToken(modifier, platform) || modifier)
      .filter(Boolean)
  );

  if (mode === MODIFIER_ONLY_MODE) {
    if (normalizedModifiers.length === 0) {
      return "";
    }

    if (normalizedModifiers.length === 1 && normalizedModifiers[0] === "GLOBE") {
      return "GLOBE";
    }

    return normalizedModifiers.join("+");
  }

  if (mode === SINGLE_KEY_MODE) {
    return normalizePrimaryKeyToken(primaryKey);
  }

  const normalizedPrimaryKey = normalizePrimaryKeyToken(primaryKey);

  if (normalizedModifiers.length === 0 || !normalizedPrimaryKey) {
    return "";
  }

  return [...normalizedModifiers, normalizedPrimaryKey].join("+");
}

export function parseHotkeyToBuilderState({
  hotkey = "",
  platform = "darwin",
  isUsingGnome = false,
} = {}) {
  const capabilities = getHotkeyBuilderCapabilities({ platform, isUsingGnome });
  const parts = splitHotkey(hotkey);

  if (parts.length === 0) {
    return {
      mode: capabilities.allowModifierOnlyMode ? MODIFIER_ONLY_MODE : SINGLE_KEY_MODE,
      selectedModifiers: [],
      primaryKey: "",
    };
  }

  const normalizedModifiers = [];
  const primaryKeys = [];

  for (const part of parts) {
    const normalizedModifier = normalizeModifierToken(part, platform);
    if (normalizedModifier) {
      normalizedModifiers.push(normalizedModifier);
    } else {
      primaryKeys.push(normalizePrimaryKeyToken(part));
    }
  }

  if (primaryKeys.length === 0) {
    return {
      mode: capabilities.allowModifierOnlyMode ? MODIFIER_ONLY_MODE : KEY_COMBO_MODE,
      selectedModifiers: sortModifiers(normalizedModifiers),
      primaryKey: "",
    };
  }

  if (normalizedModifiers.length === 0) {
    return {
      mode: SINGLE_KEY_MODE,
      selectedModifiers: [],
      primaryKey: primaryKeys[0] || "",
    };
  }

  return {
    mode: KEY_COMBO_MODE,
    selectedModifiers: sortModifiers(normalizedModifiers),
    primaryKey: primaryKeys[0] || "",
  };
}

export function isModifierToken(token, platform = "darwin") {
  return Boolean(normalizeModifierToken(token, platform));
}

export const HOTKEY_BUILDER_MODES = {
  modifierOnly: MODIFIER_ONLY_MODE,
  singleKey: SINGLE_KEY_MODE,
  keyCombo: KEY_COMBO_MODE,
};
