import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import { formatHotkeyLabel } from "../../utils/hotkeys";
import { getPlatform } from "../../utils/platform";
import {
  HOTKEY_BUILDER_MODES,
  buildHotkeyFromBuilderState,
  getHotkeyBuilderCapabilities,
  parseHotkeyToBuilderState,
} from "../../utils/hotkeyBuilder.js";

const PRIMARY_KEY_CODES: Record<string, string> = {
  Backquote: "`",
  Digit1: "1",
  Digit2: "2",
  Digit3: "3",
  Digit4: "4",
  Digit5: "5",
  Digit6: "6",
  Digit7: "7",
  Digit8: "8",
  Digit9: "9",
  Digit0: "0",
  Minus: "-",
  Equal: "=",
  KeyQ: "Q",
  KeyW: "W",
  KeyE: "E",
  KeyR: "R",
  KeyT: "T",
  KeyY: "Y",
  KeyU: "U",
  KeyI: "I",
  KeyO: "O",
  KeyP: "P",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  KeyA: "A",
  KeyS: "S",
  KeyD: "D",
  KeyF: "F",
  KeyG: "G",
  KeyH: "H",
  KeyJ: "J",
  KeyK: "K",
  KeyL: "L",
  Semicolon: ";",
  Quote: "'",
  KeyZ: "Z",
  KeyX: "X",
  KeyC: "C",
  KeyV: "V",
  KeyB: "B",
  KeyN: "N",
  KeyM: "M",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Space: "Space",
  Escape: "Esc",
  Tab: "Tab",
  Enter: "Enter",
  Backspace: "Backspace",
  Delete: "Delete",
  Insert: "Insert",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Pause: "Pause",
  ScrollLock: "ScrollLock",
  PrintScreen: "PrintScreen",
  F1: "F1",
  F2: "F2",
  F3: "F3",
  F4: "F4",
  F5: "F5",
  F6: "F6",
  F7: "F7",
  F8: "F8",
  F9: "F9",
  F10: "F10",
  F11: "F11",
  F12: "F12",
  F13: "F13",
  F14: "F14",
  F15: "F15",
  F16: "F16",
  F17: "F17",
  F18: "F18",
  F19: "F19",
  F20: "F20",
  F21: "F21",
  F22: "F22",
  F23: "F23",
  F24: "F24",
};

const MODIFIER_EVENT_CODES = new Set([
  "ShiftLeft",
  "ShiftRight",
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
  "Fn",
  "CapsLock",
]);

export interface HotkeyInputProps {
  value: string;
  onChange: (hotkey: string) => void;
  onBlur?: () => void;
  disabled?: boolean;
  autoFocus?: boolean;
  validate?: (hotkey: string) => string | null | undefined;
}

export interface HotkeyInputVariant {
  variant?: "default" | "hero";
}

function getPrimaryKeyFromEvent(event: React.KeyboardEvent<HTMLButtonElement>): string | null {
  if (MODIFIER_EVENT_CODES.has(event.nativeEvent.code)) {
    return null;
  }

  return PRIMARY_KEY_CODES[event.nativeEvent.code] ?? null;
}

function getVariantClasses(variant: "default" | "hero") {
  if (variant === "hero") {
    return {
      container: "space-y-4",
      modeButton: "px-3.5 py-2 text-sm rounded-md",
      chip: "px-3 py-2 text-sm rounded-md",
      primaryKey:
        "min-h-28 rounded-md border border-border/60 bg-surface-1 px-4 py-4 text-center text-sm",
      preview: "rounded-md border border-border/60 bg-surface-1 px-4 py-4",
    };
  }

  return {
    container: "space-y-3",
    modeButton: "px-3 py-1.5 text-xs rounded-md",
    chip: "px-2.5 py-1.5 text-xs rounded-md",
    primaryKey:
      "min-h-20 rounded-md border border-border/60 bg-surface-1 px-3 py-3 text-center text-xs",
    preview: "rounded-md border border-border/60 bg-surface-1 px-3 py-3",
  };
}

export function HotkeyInput({
  value,
  onChange,
  onBlur,
  disabled = false,
  autoFocus = false,
  variant = "default",
  validate,
}: HotkeyInputProps & HotkeyInputVariant) {
  const { t } = useTranslation();
  const platform = getPlatform();
  const [isUsingGnome, setIsUsingGnome] = useState(false);
  const [validationWarning, setValidationWarning] = useState<string | null>(null);
  const [isCapturingPrimaryKey, setIsCapturingPrimaryKey] = useState(false);
  const primaryKeyButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let isMounted = true;

    const loadModeInfo = async () => {
      try {
        const info = await window.electronAPI?.getHotkeyModeInfo?.();
        if (isMounted && info?.isUsingGnome) {
          setIsUsingGnome(true);
        }
      } catch {
        if (isMounted) {
          setIsUsingGnome(false);
        }
      }
    };

    void loadModeInfo();

    return () => {
      isMounted = false;
    };
  }, []);

  const capabilities = useMemo(
    () => getHotkeyBuilderCapabilities({ platform, isUsingGnome }),
    [platform, isUsingGnome]
  );

  const [draft, setDraft] = useState(() =>
    parseHotkeyToBuilderState({
      hotkey: value,
      platform,
      isUsingGnome,
    })
  );

  useEffect(() => {
    const nextDraft = parseHotkeyToBuilderState({
      hotkey: value,
      platform,
      isUsingGnome,
    });
    setDraft(nextDraft);
  }, [value, platform, isUsingGnome]);

  useEffect(() => {
    if (autoFocus && primaryKeyButtonRef.current && !disabled) {
      primaryKeyButtonRef.current.focus();
    }
  }, [autoFocus, disabled]);

  const applyDraft = useCallback(
    (nextDraft: { mode: string; selectedModifiers: string[]; primaryKey: string }) => {
      setDraft(nextDraft);

      const hotkey = buildHotkeyFromBuilderState({
        ...nextDraft,
        platform,
      });

      if (!hotkey) {
        setValidationWarning(null);
        return;
      }

      const validationMessage = validate?.(hotkey) ?? null;
      if (validationMessage) {
        setValidationWarning(validationMessage);
        return;
      }

      setValidationWarning(null);
      onChange(hotkey);
    },
    [onChange, platform, validate]
  );

  const handleModeChange = useCallback(
    (mode: string) => {
      if (disabled) {
        return;
      }

      applyDraft({
        mode,
        selectedModifiers:
          mode === HOTKEY_BUILDER_MODES.keyCombo && draft.mode === HOTKEY_BUILDER_MODES.keyCombo
            ? draft.selectedModifiers.slice(0, 1)
            : [],
        primaryKey: mode === HOTKEY_BUILDER_MODES.modifierOnly ? "" : draft.primaryKey,
      });
      setIsCapturingPrimaryKey(false);
    },
    [applyDraft, disabled, draft.mode, draft.primaryKey, draft.selectedModifiers]
  );

  const handleModifierToggle = useCallback(
    (modifier: string) => {
      if (disabled) {
        return;
      }

      const isSelected = draft.selectedModifiers.includes(modifier);
      const modifierOption =
        draft.mode === HOTKEY_BUILDER_MODES.modifierOnly
          ? capabilities.modifierOnlyOptions.find((option) => option.hotkey === modifier)
          : capabilities.comboModifierOptions.find((option) => option.hotkey === modifier);
      let nextModifiers: string[];

      if (
        draft.mode === HOTKEY_BUILDER_MODES.modifierOnly &&
        (!capabilities.allowModifierOnlyMultiSelect || modifierOption?.exclusive)
      ) {
        nextModifiers = isSelected ? [] : [modifier];
      } else if (draft.mode === HOTKEY_BUILDER_MODES.keyCombo) {
        nextModifiers = isSelected ? [] : [modifier];
      } else {
        const hasExclusiveModifier = draft.selectedModifiers.some((selectedModifier) =>
          capabilities.modifierOnlyOptions.some(
            (option) => option.hotkey === selectedModifier && option.exclusive
          )
        );

        if (draft.mode === HOTKEY_BUILDER_MODES.modifierOnly && hasExclusiveModifier && !isSelected) {
          nextModifiers = [modifier];
        } else {
          nextModifiers = isSelected
            ? draft.selectedModifiers.filter((item) => item !== modifier)
            : [...draft.selectedModifiers, modifier];
        }
      }

      if (
        draft.mode === HOTKEY_BUILDER_MODES.modifierOnly &&
        !modifierOption?.exclusive &&
        nextModifiers.some((selectedModifier) =>
          capabilities.modifierOnlyOptions.some(
            (option) => option.hotkey === selectedModifier && option.exclusive
          )
        )
      ) {
        nextModifiers = isSelected
          ? draft.selectedModifiers.filter((item) => item !== modifier)
          : [modifier];
      }

      applyDraft({
        ...draft,
        selectedModifiers: nextModifiers,
      });
    },
    [
      applyDraft,
      capabilities.allowModifierOnlyMultiSelect,
      capabilities.comboModifierOptions,
      capabilities.modifierOnlyOptions,
      disabled,
      draft,
    ]
  );

  const handlePrimaryKeyCapture = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      const requiresComboModifier =
        draft.mode === HOTKEY_BUILDER_MODES.keyCombo && draft.selectedModifiers.length === 0;

      if (disabled || requiresComboModifier) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const primaryKey = getPrimaryKeyFromEvent(event);
      if (!primaryKey) {
        return;
      }

      applyDraft({
        ...draft,
        primaryKey,
      });
      setIsCapturingPrimaryKey(false);
      primaryKeyButtonRef.current?.blur();
    },
    [applyDraft, disabled, draft]
  );

  const previewHotkey = buildHotkeyFromBuilderState({
    ...draft,
    platform,
  });

  const classes = getVariantClasses(variant);
  const showModifierOnlyMode = capabilities.allowModifierOnlyMode;
  const comboNeedsModifier =
    draft.mode === HOTKEY_BUILDER_MODES.keyCombo && draft.selectedModifiers.length === 0;
  const showModifierPicker =
    draft.mode === HOTKEY_BUILDER_MODES.modifierOnly || draft.mode === HOTKEY_BUILDER_MODES.keyCombo;
  const showPrimaryKeyInput =
    draft.mode === HOTKEY_BUILDER_MODES.singleKey || draft.mode === HOTKEY_BUILDER_MODES.keyCombo;
  const modifierOnlyOptions =
    draft.mode === HOTKEY_BUILDER_MODES.modifierOnly ? capabilities.modifierOnlyOptions : [];
  const comboModifierOptions = capabilities.comboModifierOptions;

  return (
    <div className={classes.container}>
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground/80">{t("hotkeyInput.modeLabel")}</p>
        <div className="flex flex-wrap gap-2">
          {showModifierOnlyMode && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => handleModeChange(HOTKEY_BUILDER_MODES.modifierOnly)}
              className={`${classes.modeButton} border transition-colors ${
                draft.mode === HOTKEY_BUILDER_MODES.modifierOnly
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border/60 bg-surface-1 text-foreground hover:border-border-hover"
              } disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {t("hotkeyInput.modes.modifierOnly")}
            </button>
          )}
          <button
            type="button"
            disabled={disabled}
            onClick={() => handleModeChange(HOTKEY_BUILDER_MODES.keyCombo)}
            className={`${classes.modeButton} border transition-colors ${
              draft.mode === HOTKEY_BUILDER_MODES.keyCombo
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border/60 bg-surface-1 text-foreground hover:border-border-hover"
            } disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {t("hotkeyInput.modes.keyCombo")}
          </button>
        </div>
      </div>

      {showModifierPicker && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground/80">
            {t("hotkeyInput.modifiersLabel")}
          </p>
          <div className="flex flex-wrap gap-2">
            {(draft.mode === HOTKEY_BUILDER_MODES.modifierOnly
              ? modifierOnlyOptions
              : comboModifierOptions
            ).map((option) => {
              const isSelected = draft.selectedModifiers.includes(option.hotkey);
              return (
                <button
                  key={option.hotkey}
                  type="button"
                  disabled={disabled}
                  onClick={() => handleModifierToggle(option.hotkey)}
                  className={`${classes.chip} border transition-colors ${
                    isSelected
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border/60 bg-surface-1 text-foreground hover:border-border-hover"
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  {formatHotkeyLabel(option.hotkey)}
                </button>
              );
            })}
          </div>
          {draft.mode === HOTKEY_BUILDER_MODES.keyCombo && (
            <p className="text-xs leading-relaxed text-muted-foreground/70">
              {t("hotkeyInput.comboModifierHint")}
            </p>
          )}
          {!showModifierOnlyMode && draft.mode === HOTKEY_BUILDER_MODES.keyCombo && isUsingGnome && (
            <p className="text-xs leading-relaxed text-muted-foreground/70">
              {t("hotkeyInput.modifierOnlyUnavailable")}
            </p>
          )}
        </div>
      )}

      {showPrimaryKeyInput && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground/80">
            {t("hotkeyInput.primaryKeyLabel")}
          </p>
          <button
            ref={primaryKeyButtonRef}
            type="button"
            disabled={disabled || comboNeedsModifier}
            onClick={() => {
              if (disabled || comboNeedsModifier) {
                return;
              }
              setIsCapturingPrimaryKey(true);
            }}
            onBlur={() => {
              setIsCapturingPrimaryKey(false);
              onBlur?.();
            }}
            onKeyDown={handlePrimaryKeyCapture}
            className={`${classes.primaryKey} w-full transition-colors ${
              comboNeedsModifier
                ? "border-dashed border-border/60 bg-surface-0 text-muted-foreground/70"
                : isCapturingPrimaryKey
                  ? "border-primary/40 bg-primary/5 text-primary"
                  : "text-foreground hover:border-border-hover"
            } disabled:cursor-not-allowed disabled:opacity-50`}
          >
            <div className="flex flex-col items-center justify-center gap-2">
              <span className="text-sm font-semibold">
                {comboNeedsModifier
                  ? t("hotkeyInput.primaryKeyRequiresModifier")
                  : draft.primaryKey
                    ? formatHotkeyLabel(draft.primaryKey)
                    : t("hotkeyInput.primaryKeyUnset")}
              </span>
              <span className="text-xs text-muted-foreground/70">
                {comboNeedsModifier
                  ? t("hotkeyInput.comboModifierHint")
                  : isCapturingPrimaryKey
                    ? t("hotkeyInput.primaryKeyListening")
                    : t("hotkeyInput.primaryKeyHint")}
              </span>
            </div>
          </button>
        </div>
      )}

      <div className={classes.preview}>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground/80">
            {t("hotkeyInput.previewLabel")}
          </span>
          <span className="text-sm font-semibold text-foreground">
            {previewHotkey ? formatHotkeyLabel(previewHotkey) : t("hotkeyInput.previewEmpty")}
          </span>
        </div>
      </div>

      {validationWarning && (
        <div className="flex items-start gap-2 rounded-md border border-warning/25 bg-warning/10 px-3 py-2 text-xs text-warning dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{validationWarning}</span>
        </div>
      )}
    </div>
  );
}

export default HotkeyInput;
