import registry from "../config/languageRegistry.json";

export interface LanguageOption {
  value: string;
  label: string;
  flag: string;
}

export const REGISTRY_OPTIONS: LanguageOption[] = registry.languages.map(
  ({ code, label, flag }) => ({
    value: code,
    label,
    flag,
  })
);

export function getLanguageLabel(code: string): string {
  if (!code) return "";
  return REGISTRY_OPTIONS.find((o) => o.value === code)?.label ?? code;
}

// Short uppercase code suitable for a 2-3 char badge (e.g., "EN", "ZH", "JA").
// Strips the region suffix so "en-US" → "EN", "zh-CN" → "ZH". Region collapse
// is intentional: pill width budget can't fit "ZH-CN" without crowding.
export function getLanguageShortCode(code: string): string {
  if (!code) return "";
  return code.split("-")[0].toUpperCase();
}
