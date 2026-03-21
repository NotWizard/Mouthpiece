import * as React from "react";
import { AlertCircle } from "lucide-react";

import { cn } from "../lib/utils";
import { Alert, AlertDescription } from "./alert";

interface ErrorNoticeProps {
  message: React.ReactNode;
  className?: string;
  compact?: boolean;
  action?: React.ReactNode;
}

export function ErrorNotice({ message, className, compact = false, action }: ErrorNoticeProps) {
  return (
    <Alert
      variant="destructive"
      className={cn(
        "inline-error-notice",
        compact ? "px-3 py-2.5 rounded-[16px]" : "px-3.5 py-3 rounded-[18px]",
        className
      )}
    >
      <AlertCircle className={cn("shrink-0", compact ? "size-3.5 !top-3" : "size-4 !top-3.5")} />

      <div className={cn("flex items-start justify-between gap-3", compact ? "gap-2" : "gap-3.5")}>
        <AlertDescription className={compact ? "text-xs leading-snug" : "text-sm leading-relaxed"}>
          {message}
        </AlertDescription>

        {action ? <div className="shrink-0 self-start">{action}</div> : null}
      </div>
    </Alert>
  );
}

export default ErrorNotice;
