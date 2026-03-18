import { useState, useMemo, useRef, useEffect } from "react";
import { Search, ChevronDown, Check, Globe } from "lucide-react";
import { cn } from "../lib/utils";

export interface SearchableModelOption {
  value: string;
  label: string;
  description?: string;
  ownedBy?: string;
  icon?: string;
  invertInDark?: boolean;
}

interface SearchableModelSelectProps {
  models: SearchableModelOption[];
  selectedModel: string;
  onModelSelect: (modelId: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  className?: string;
}

export default function SearchableModelSelect({
  models,
  selectedModel,
  onModelSelect,
  placeholder = "Select a model...",
  searchPlaceholder = "Search models...",
  emptyMessage = "No models available",
  className,
}: SearchableModelSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedModelData = useMemo(
    () => models.find((m) => m.value === selectedModel),
    [models, selectedModel]
  );

  const filteredModels = useMemo(() => {
    if (!searchQuery.trim()) return models;
    const query = searchQuery.toLowerCase();
    return models.filter(
      (model) =>
        model.label.toLowerCase().includes(query) ||
        model.ownedBy?.toLowerCase().includes(query) ||
        model.description?.toLowerCase().includes(query)
    );
  }, [models, searchQuery]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchQuery("");
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      // Focus search input when opened
      setTimeout(() => inputRef.current?.focus(), 0);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const handleSelect = (modelId: string) => {
    onModelSelect(modelId);
    setIsOpen(false);
    setSearchQuery("");
  };

  const handleToggle = () => {
    setIsOpen(!isOpen);
    if (isOpen) {
      setSearchQuery("");
    }
  };

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      {/* Trigger button */}
      <button
        type="button"
        onClick={handleToggle}
        className={cn(
          "flex w-full items-center justify-between rounded-xl border border-border bg-input px-3.5 py-2.5 text-sm",
          "shadow-none ring-offset-background transition-colors duration-200",
          "hover:border-border-hover",
          "focus:outline-none focus:ring-[3px] focus:ring-primary/15 focus:border-primary",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "dark:bg-surface-1 dark:border-border-subtle",
          "dark:focus:ring-ring/10 dark:focus:border-border-active",
          isOpen && "border-primary ring-[3px] ring-primary/15 dark:ring-ring/10"
        )}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {selectedModelData?.icon ? (
            <img
              src={selectedModelData.icon}
              alt=""
              className={cn(
                "w-4 h-4 shrink-0",
                selectedModelData.invertInDark && "icon-monochrome"
              )}
            />
          ) : (
            <Globe className="w-4 h-4 shrink-0 text-muted-foreground" />
          )}
          <span className={cn("truncate", !selectedModelData && "text-muted-foreground")}>
            {selectedModelData?.label || placeholder}
          </span>
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground shrink-0 ml-2 transition-transform duration-200",
            isOpen && "rotate-180"
          )}
        />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div
          className={cn(
            "absolute z-50 w-full mt-1 rounded-xl border border-border/60 bg-popover shadow-xl",
            "dark:bg-surface-3 dark:border-border-hover dark:shadow-elevated",
            "animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 duration-150"
          )}
        >
          {/* Search input */}
          <div className="p-2 border-b border-border/60 dark:border-border-subtle">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                ref={inputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={searchPlaceholder}
                className={cn(
                  "w-full h-9 pl-9 pr-3 text-sm rounded-lg",
                  "bg-muted/50 border-0",
                  "placeholder:text-muted-foreground",
                  "focus:outline-none focus:ring-2 focus:ring-primary/20",
                  "dark:bg-surface-2 dark:focus:ring-primary/15"
                )}
              />
            </div>
          </div>

          {/* Model list */}
          <div className="max-h-60 overflow-y-auto p-1">
            {filteredModels.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                {searchQuery ? "No matching models found" : emptyMessage}
              </div>
            ) : (
              <div className="space-y-0.5">
                {filteredModels.map((model) => {
                  const isSelected = model.value === selectedModel;
                  return (
                    <button
                      key={model.value}
                      type="button"
                      onClick={() => handleSelect(model.value)}
                      className={cn(
                        "w-full flex items-start gap-2 px-2.5 py-2 rounded-lg text-left",
                        "transition-colors duration-150",
                        "hover:bg-muted dark:hover:bg-primary/8",
                        isSelected && "bg-primary/10 dark:bg-primary/8"
                      )}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {model.icon ? (
                            <img
                              src={model.icon}
                              alt=""
                              className={cn(
                                "w-3.5 h-3.5 shrink-0",
                                model.invertInDark && "icon-monochrome"
                              )}
                            />
                          ) : (
                            <Globe className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                          )}
                          <span
                            className={cn(
                              "text-sm font-medium truncate",
                              isSelected && "text-primary"
                            )}
                          >
                            {model.label}
                          </span>
                        </div>
                        {(model.description || model.ownedBy) && (
                          <p className="text-xs text-muted-foreground mt-0.5 truncate pl-5.5">
                            {model.description || model.ownedBy}
                          </p>
                        )}
                      </div>
                      {isSelected && <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer with count */}
          {filteredModels.length > 0 && (
            <div className="px-3 py-1.5 border-t border-border/60 dark:border-border-subtle">
              <p className="text-xs text-muted-foreground text-center">
                {filteredModels.length} of {models.length} models
                {searchQuery && " matching"}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
