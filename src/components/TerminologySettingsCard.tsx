import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CornerDownLeft, X } from "lucide-react";
import { Input } from "./ui/input";
import { useSettings } from "../hooks/useSettings";
import type { TerminologyMapping, TerminologyProfile } from "../utils/terminologyProfile";

interface TerminologySettingsCardProps {
  terminologyProfile: TerminologyProfile;
}

function parseCommaSeparatedTerms(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function Chip({ label, onRemove }: { label: string; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-[5px] border border-border/60 bg-background/70 px-2 py-1 text-xs text-foreground/80">
      {label}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-destructive"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

function EmptyText({ children }: { children: React.ReactNode }) {
  return <p className="text-xs leading-relaxed text-muted-foreground/70">{children}</p>;
}

function TerminologySettingsCard({ terminologyProfile }: TerminologySettingsCardProps) {
  const { t } = useTranslation();
  const { setTerminologyProfile } = useSettings();
  const [glossaryInput, setGlossaryInput] = useState("");
  const [blacklistInput, setBlacklistInput] = useState("");
  const [mappingInput, setMappingInput] = useState("");

  const addTerms = (field: "glossaryTerms" | "blacklistedTerms", rawValue: string) => {
    const nextTerms = parseCommaSeparatedTerms(rawValue);
    if (nextTerms.length === 0) return;

    setTerminologyProfile({
      [field]: [...terminologyProfile[field], ...nextTerms],
    });
  };

  const removeTerm = (field: "glossaryTerms" | "blacklistedTerms", term: string) => {
    setTerminologyProfile({
      [field]: terminologyProfile[field].filter((item) => item !== term),
    });
  };

  const addMapping = () => {
    const [source, target] = mappingInput.split("=").map((item) => item?.trim());
    if (!source || !target) return;

    setTerminologyProfile({
      homophoneMappings: [...terminologyProfile.homophoneMappings, { source, target }],
    });
    setMappingInput("");
  };

  const removeMapping = (mapping: TerminologyMapping) => {
    setTerminologyProfile({
      homophoneMappings: terminologyProfile.homophoneMappings.filter(
        (item) => !(item.source === mapping.source && item.target === mapping.target)
      ),
    });
  };

  return (
    <div className="terminology-settings settings-group">
      <div className="grid gap-4 p-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <div className="text-xs font-medium text-foreground">
              {t("settingsPage.terminology.glossaryTitle")}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {terminologyProfile.glossaryTerms.length > 0 ? (
                terminologyProfile.glossaryTerms.map((term) => (
                  <Chip
                    key={term}
                    label={term}
                    onRemove={() => removeTerm("glossaryTerms", term)}
                  />
                ))
              ) : (
                <EmptyText>{t("settingsPage.terminology.glossaryEmpty")}</EmptyText>
              )}
            </div>
            <div className="relative">
              <Input
                value={glossaryInput}
                onChange={(event) => setGlossaryInput(event.target.value)}
                placeholder={t("settingsPage.terminology.glossaryPlaceholder")}
                className="h-9 pr-9 text-xs"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    addTerms("glossaryTerms", glossaryInput);
                    setGlossaryInput("");
                  }
                }}
              />
              <button
                type="button"
                onClick={() => {
                  addTerms("glossaryTerms", glossaryInput);
                  setGlossaryInput("");
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-primary/60 transition-colors hover:text-primary"
                aria-label={t("settingsPage.terminology.addGlossary")}
              >
                <CornerDownLeft className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-medium text-foreground">
              {t("settingsPage.terminology.blacklistTitle")}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {terminologyProfile.blacklistedTerms.length > 0 ? (
                terminologyProfile.blacklistedTerms.map((term) => (
                  <Chip
                    key={term}
                    label={term}
                    onRemove={() => removeTerm("blacklistedTerms", term)}
                  />
                ))
              ) : (
                <EmptyText>{t("settingsPage.terminology.blacklistEmpty")}</EmptyText>
              )}
            </div>
            <div className="relative">
              <Input
                value={blacklistInput}
                onChange={(event) => setBlacklistInput(event.target.value)}
                placeholder={t("settingsPage.terminology.blacklistPlaceholder")}
                className="h-9 pr-9 text-xs"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    addTerms("blacklistedTerms", blacklistInput);
                    setBlacklistInput("");
                  }
                }}
              />
              <button
                type="button"
                onClick={() => {
                  addTerms("blacklistedTerms", blacklistInput);
                  setBlacklistInput("");
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-primary/60 transition-colors hover:text-primary"
                aria-label={t("settingsPage.terminology.addBlacklist")}
              >
                <CornerDownLeft className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-medium text-foreground">
            {t("settingsPage.terminology.homophoneTitle")}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {terminologyProfile.homophoneMappings.length > 0 ? (
              terminologyProfile.homophoneMappings.map((mapping) => (
                <Chip
                  key={`${mapping.source}-${mapping.target}`}
                  label={`${mapping.source} → ${mapping.target}`}
                  onRemove={() => removeMapping(mapping)}
                />
              ))
            ) : (
              <EmptyText>{t("settingsPage.terminology.homophoneEmpty")}</EmptyText>
            )}
          </div>
          <div className="relative">
            <Input
              value={mappingInput}
              onChange={(event) => setMappingInput(event.target.value)}
              placeholder={t("settingsPage.terminology.homophonePlaceholder")}
              className="h-9 pr-9 text-xs"
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  addMapping();
                }
              }}
            />
            <button
              type="button"
              onClick={addMapping}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-primary/60 transition-colors hover:text-primary"
              aria-label={t("settingsPage.terminology.addMapping")}
            >
              <CornerDownLeft className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default TerminologySettingsCard;
