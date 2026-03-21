import { useTranslation } from "react-i18next";
import { Sparkles, Wand2 } from "lucide-react";
import { cn } from "./lib/utils";
import type { OutputStrategy } from "../utils/postProcessingPolicy";

interface PostProcessingStrategyCardProps {
  value: OutputStrategy;
  onChange: (value: OutputStrategy) => void;
}

const STRATEGIES: OutputStrategy[] = [
  "raw_first",
  "light_polish",
  "publishable",
  "structured_rewrite",
];

function PostProcessingStrategyCard({ value, onChange }: PostProcessingStrategyCardProps) {
  const { t } = useTranslation();

  return (
    <div className="rounded-lg border border-border/50 bg-card/50 backdrop-blur-sm">
      <div className="border-b border-border/30 px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Wand2 className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-xs font-semibold text-foreground">
              {t("settingsPage.postProcessingStrategy.title")}
            </h3>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground/80">
              {t("settingsPage.postProcessingStrategy.description")}
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-2 p-3">
        {STRATEGIES.map((strategy) => {
          const selected = value === strategy;
          return (
            <button
              key={strategy}
              type="button"
              onClick={() => onChange(strategy)}
              className={cn(
                "rounded-md border px-3 py-3 text-left transition-colors",
                selected
                  ? "border-primary/40 bg-primary/10 text-foreground"
                  : "border-border/60 bg-background/60 text-foreground/80 hover:border-border-hover hover:bg-muted/50"
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-medium">
                    {t(`settingsPage.postProcessingStrategy.options.${strategy}.label`)}
                  </div>
                  <div className="mt-1 text-xs leading-relaxed text-muted-foreground/80">
                    {t(`settingsPage.postProcessingStrategy.options.${strategy}.description`)}
                  </div>
                </div>
                {selected && <Sparkles className="h-4 w-4 shrink-0 text-primary" />}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default PostProcessingStrategyCard;
