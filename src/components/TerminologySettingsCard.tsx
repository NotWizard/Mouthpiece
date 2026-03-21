import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, CornerDownLeft, Languages, Trash2, X } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { useSettings } from "../hooks/useSettings";
import type {
  TerminologyMapping,
  TerminologyProfile,
  TerminologySuggestion,
} from "../utils/terminologyProfile";

interface TerminologySettingsCardProps {
  terminologyProfile: TerminologyProfile;
  approveTerminologySuggestion: (term: string) => void;
  rejectTerminologySuggestion: (term: string) => void;
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

function TerminologySettingsCard({
  terminologyProfile,
  approveTerminologySuggestion,
  rejectTerminologySuggestion,
}: TerminologySettingsCardProps) {
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

  const renderSuggestion = (suggestion: TerminologySuggestion) => (
    <div
      key={`${suggestion.term}-${suggestion.sourceTerm}`}
      className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-background/60 px-3 py-2"
    >
      <div>
        <div className="text-xs font-medium text-foreground">
          {suggestion.sourceTerm} → {suggestion.term}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground/70">
          {t("settingsPage.terminology.pendingSuggestionSource", { source: suggestion.source })}
        </div>
      </div>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => approveTerminologySuggestion(suggestion.term)}
        >
          <Check className="h-3 w-3" />
          {t("settingsPage.terminology.approve")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => rejectTerminologySuggestion(suggestion.term)}
        >
          <Trash2 className="h-3 w-3" />
          {t("settingsPage.terminology.reject")}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="rounded-lg border border-border/50 bg-card/50 backdrop-blur-sm">
      <div className="border-b border-border/30 px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Languages className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-xs font-semibold text-foreground">
              {t("settingsPage.terminology.title")}
            </h3>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground/80">
              {t("settingsPage.terminology.description")}
            </p>
          </div>
        </div>
      </div>

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

        <div className="space-y-2">
          <div className="text-xs font-medium text-foreground">
            {t("settingsPage.terminology.pendingSuggestionsTitle")}
          </div>
          <div className="space-y-2">
            {terminologyProfile.pendingSuggestions.length > 0 ? (
              terminologyProfile.pendingSuggestions.map(renderSuggestion)
            ) : (
              <EmptyText>{t("settingsPage.terminology.pendingSuggestionsEmpty")}</EmptyText>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default TerminologySettingsCard;
