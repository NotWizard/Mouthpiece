import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./button";
import { Copy, Trash2 } from "lucide-react";
import type { TranscriptionItem as TranscriptionItemType } from "../../types/electron";
import { cn } from "../lib/utils";

interface TranscriptionItemProps {
  item: TranscriptionItemType;
  onCopy: (text: string) => Promise<boolean>;
  onDelete: (id: number) => void;
}

export default function TranscriptionItem({ item, onCopy, onDelete }: TranscriptionItemProps) {
  const { i18n, t } = useTranslation();
  const [isHovered, setIsHovered] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const copiedResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copiedResetTimeoutRef.current) {
        clearTimeout(copiedResetTimeoutRef.current);
      }
    };
  }, []);

  const showCopiedState = () => {
    setIsCopied(true);
    if (copiedResetTimeoutRef.current) {
      clearTimeout(copiedResetTimeoutRef.current);
    }
    copiedResetTimeoutRef.current = setTimeout(() => {
      setIsCopied(false);
      copiedResetTimeoutRef.current = null;
    }, 1600);
  };

  const handleCopy = async () => {
    const copied = await onCopy(item.text);
    if (copied) {
      showCopiedState();
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    void handleCopy();
  };

  const handleCopyButtonClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    void handleCopy();
  };

  const handleDeleteButtonClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onDelete(item.id);
  };

  const timestampSource = item.timestamp.endsWith("Z") ? item.timestamp : `${item.timestamp}Z`;
  const timestampDate = new Date(timestampSource);
  const formattedTime = Number.isNaN(timestampDate.getTime())
    ? ""
    : timestampDate.toLocaleTimeString(i18n.language, {
        hour: "2-digit",
        minute: "2-digit",
      });

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={t("controlPanel.history.copyRow")}
      className="transcription-list-item group cursor-pointer px-3 py-2.5 transition-colors duration-150 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 dark:hover:bg-white/4"
      onClick={handleCopy}
      onKeyDown={handleKeyDown}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="flex items-start gap-3">
        {formattedTime && (
          <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums pt-0.5">
            {formattedTime}
          </span>
        )}

        <p className="flex-1 min-w-0 text-foreground text-sm leading-[1.5] break-words">
          {item.text}
        </p>

        <div
          className={cn(
            "flex min-w-[4.5rem] shrink-0 items-center justify-end gap-1 transition-opacity duration-150 group-focus-within:opacity-100",
            isHovered || isCopied ? "opacity-100" : "opacity-0"
          )}
        >
          {isCopied && (
            <span className="mr-1 whitespace-nowrap text-xs font-medium text-emerald-600 dark:text-emerald-400">
              {t("controlPanel.history.copiedInline")}
            </span>
          )}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label={t("controlPanel.history.copyAction")}
            onClick={handleCopyButtonClick}
            className="h-6 w-6 rounded-sm text-muted-foreground hover:text-foreground hover:bg-foreground/10"
          >
            <Copy size={12} />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label={t("controlPanel.history.deleteAction")}
            onClick={handleDeleteButtonClick}
            className="h-6 w-6 rounded-sm text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          >
            <Trash2 size={12} />
          </Button>
        </div>
      </div>
    </div>
  );
}
