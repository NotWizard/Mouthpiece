import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "./input";
import logger from "../../utils/logger";

interface ApiKeyInputProps {
  apiKey: string;
  setApiKey: (key: string) => void;
  className?: string;
  placeholder?: string;
  label?: string;
  ariaLabel?: string;
  helpText?: React.ReactNode;
  variant?: "default" | "purple";
  saveMode?: "manual" | "immediate";
}

function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "*".repeat(Math.max(8, key.length));
  return key.slice(0, 4) + "*".repeat(Math.max(4, key.length - 8)) + key.slice(-4);
}

export default function ApiKeyInput({
  apiKey,
  setApiKey,
  className = "",
  placeholder,
  label,
  ariaLabel,
  helpText,
  variant = "default",
  saveMode = "manual",
}: ApiKeyInputProps) {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t("apiKeyInput.placeholder");
  const resolvedLabel = label ?? t("apiKeyInput.label");
  const [draft, setDraft] = useState(apiKey);
  const [isFocused, setIsFocused] = useState(false);
  const [isRevealed, setIsRevealed] = useState(false);
  const variantClasses = variant === "purple" ? "border-primary focus:border-primary" : "";
  const showPlaintext = isFocused || isRevealed || !draft;
  const displayValue = showPlaintext ? draft : maskKey(draft);
  const hasKey = draft.length > 0;

  useEffect(() => {
    if (!isFocused || saveMode === "immediate") {
      setDraft(apiKey);
    }
  }, [apiKey, isFocused, saveMode]);

  const persistApiKey = (nextValue: string) => {
    try {
      setApiKey(nextValue);
    } catch (err) {
      logger.warn("Failed to save API key", { error: (err as Error).message }, "settings");
    }
  };

  const commitDraft = () => {
    const nextValue = draft.trim();
    if (nextValue !== draft) {
      setDraft(nextValue);
    }
    if (nextValue !== apiKey) {
      persistApiKey(nextValue);
    }
  };

  const handleFocus = () => {
    setDraft(apiKey);
    setIsFocused(true);
  };

  const handleBlur = () => {
    commitDraft();
    setIsFocused(false);
    setIsRevealed(false);
  };

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value;
    setDraft(nextValue);
    if (saveMode === "immediate") {
      persistApiKey(nextValue);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setDraft(apiKey);
      setIsRevealed(false);
      event.currentTarget.blur();
    }
  };

  return (
    <div className={className}>
      {resolvedLabel && (
        <label className="block text-xs font-medium text-foreground mb-1">{resolvedLabel}</label>
      )}

      <div className="relative">
        <Input
          type="text"
          placeholder={resolvedPlaceholder}
          value={displayValue}
          onChange={handleChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          aria-label={ariaLabel || resolvedLabel || t("apiKeyInput.label")}
          className={`h-8 text-sm font-mono pr-10 ${variantClasses}`}
          autoComplete="off"
          spellCheck={false}
        />

        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setIsRevealed((current) => !current)}
          aria-label={isRevealed ? t("apiKeyInput.hide") : t("apiKeyInput.show")}
          disabled={!hasKey}
          className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 flex items-center justify-center rounded text-muted-foreground/60 hover:text-foreground hover:bg-muted/60 disabled:opacity-30 disabled:hover:text-muted-foreground/60 disabled:hover:bg-transparent transition-colors"
        >
          {isRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        </button>
      </div>

      {helpText && <p className="text-xs text-muted-foreground/70 mt-1">{helpText}</p>}
    </div>
  );
}
