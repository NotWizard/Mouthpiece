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
