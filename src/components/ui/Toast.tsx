import * as React from "react";
import { X, Copy, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import ERROR_SURFACE_LAYOUT from "../../config/errorSurfaceLayout.json";
import { cn } from "../lib/utils";

export interface ToastProps {
  id?: string;
  title?: string;
  description?: string;
  action?: React.ReactNode;
  variant?: "default" | "destructive" | "success";
  duration?: number;
  onClose?: () => void;
}

export interface ToastContextType {
  toast: (props: Omit<ToastProps, "id">) => void;
  dismiss: (id?: string) => void;
  toastCount: number;
}

const ToastContext = React.createContext<ToastContextType | undefined>(undefined);

export const useToast = () => {
  const context = React.useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
};

interface ToastState extends ToastProps {
  id: string;
  isExiting?: boolean;
  createdAt: number;
}

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = React.useState<ToastState[]>([]);
  const timersRef = React.useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const exitingToastIdsRef = React.useRef<Set<string>>(new Set());

  const clearTimer = React.useCallback((id: string) => {
    const timer = timersRef.current[id];
    if (timer) {
      clearTimeout(timer);
      delete timersRef.current[id];
    }
  }, []);

  const startExitAnimation = React.useCallback((id: string) => {
    if (exitingToastIdsRef.current.has(id)) {
      return;
    }

    exitingToastIdsRef.current.add(id);
    setToasts((prev) =>
      prev.map((toast) => (toast.id === id ? { ...toast, isExiting: true } : toast))
    );

    setTimeout(() => {
      exitingToastIdsRef.current.delete(id);
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 200);
  }, []);

  const dismissToast = React.useCallback(
    (toast: ToastState) => {
      if (exitingToastIdsRef.current.has(toast.id)) {
        return;
      }

      clearTimer(toast.id);
      toast.onClose?.();
      startExitAnimation(toast.id);
    },
    [clearTimer, startExitAnimation]
  );

  const toast = React.useCallback(
    (props: Omit<ToastProps, "id">) => {
      const id = Math.random().toString(36).substring(2, 11);
      const newToast: ToastState = { ...props, id, createdAt: Date.now() };

      setToasts((prev) => [...prev, newToast]);

      const duration = props.duration ?? (props.variant === "destructive" ? 6000 : 3500);
      if (duration > 0) {
        const timer = setTimeout(() => {
          dismissToast(newToast);
        }, duration);
        timersRef.current[id] = timer;
      }

      return id;
    },
    [dismissToast]
  );

  const dismiss = React.useCallback(
    (id?: string) => {
      if (id) {
        const toast = toasts.find((item) => item.id === id);
        if (toast) {
          dismissToast(toast);
        }
      } else {
        const lastToast = toasts[toasts.length - 1];
        if (lastToast) {
          dismissToast(lastToast);
        }
      }
    },
    [toasts, dismissToast]
  );

  const pauseTimer = React.useCallback(
    (id: string) => {
      clearTimer(id);
    },
    [clearTimer]
  );

  const resumeTimer = React.useCallback(
    (id: string, remainingTime: number) => {
      if (remainingTime > 0) {
        const timer = setTimeout(() => {
          startExitAnimation(id);
        }, remainingTime);
        timersRef.current[id] = timer;
      }
    },
    [startExitAnimation]
  );

  React.useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const id in timers) {
        clearTimeout(timers[id]);
      }
    };
  }, []);

  return (
    <ToastContext.Provider value={{ toast, dismiss, toastCount: toasts.length }}>
      {children}
      <ToastViewport
        toasts={toasts}
        onDismiss={dismiss}
        onPauseTimer={pauseTimer}
        onResumeTimer={resumeTimer}
      />
    </ToastContext.Provider>
  );
};

const ToastViewport: React.FC<{
  toasts: ToastState[];
  onDismiss: (id: string) => void;
  onPauseTimer: (id: string) => void;
  onResumeTimer: (id: string, remainingTime: number) => void;
}> = ({ toasts, onDismiss, onPauseTimer, onResumeTimer }) => {
  const isDictationPanel = React.useMemo(() => {
    return (
      window.location.pathname.indexOf("control") === -1 &&
      window.location.search.indexOf("panel=true") === -1
    );
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div
      className={cn(
        "fixed z-[100] flex flex-col gap-1.5 pointer-events-none",
        isDictationPanel ? "bottom-20 right-6" : "bottom-5 right-5"
      )}
      style={
        isDictationPanel ? { right: ERROR_SURFACE_LAYOUT.dictationToast.rightInsetPx } : undefined
      }
    >
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          {...toast}
          onClose={() => onDismiss(toast.id)}
          onPauseTimer={() => onPauseTimer(toast.id)}
          onResumeTimer={(remaining) => onResumeTimer(toast.id, remaining)}
        />
      ))}
    </div>
  );
};

const variantConfig = {
  default: {
    accentClass: "bg-white/20",
    progressClass: "bg-white/15",
  },
  destructive: {
    accentClass: "bg-[linear-gradient(180deg,rgba(251,146,60,0.95),rgba(244,114,182,0.86))]",
    progressClass: "bg-[linear-gradient(90deg,rgba(249,115,22,0.55),rgba(244,114,182,0.45))]",
  },
  success: {
    accentClass: "bg-emerald-400",
    progressClass: "bg-emerald-400/30",
  },
};

const Toast: React.FC<
  ToastState & {
    onClose?: () => void;
    onPauseTimer: () => void;
    onResumeTimer: (remaining: number) => void;
  }
> = ({
  title,
  description,
  action,
  variant = "default",
  duration = 3500,
  isExiting,
  createdAt,
  onClose,
  onPauseTimer,
  onResumeTimer,
}) => {
  const { t } = useTranslation();
  const config = variantConfig[variant];
  const pausedAtRef = React.useRef<number | null>(null);
  const [copied, setCopied] = React.useState(false);
  const isDestructive = variant === "destructive";
  const hasDetail = Boolean(title && description);

  const handleMouseEnter = () => {
    pausedAtRef.current = Date.now();
    onPauseTimer();
  };

  const handleMouseLeave = () => {
    if (pausedAtRef.current && duration > 0) {
      const elapsed = pausedAtRef.current - createdAt;
      const remaining = Math.max(duration - elapsed, 500);
      onResumeTimer(remaining);
    }
    pausedAtRef.current = null;
  };

  const handleCopyError = async () => {
    if (!description) return;
    try {
      await navigator.clipboard.writeText(description);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Silently fail
    }
  };

  const message = title || description;
  const detail = title && description ? description : undefined;
  const destructiveToastStyle = isDestructive
    ? {
        width: ERROR_SURFACE_LAYOUT.dictationToast.widthPx,
        maxWidth: `calc(100vw - ${ERROR_SURFACE_LAYOUT.dictationToast.leftSafeInsetPx}px)`,
      }
    : undefined;

  return (
    <div
      className={cn(
        "group pointer-events-auto relative flex w-75 overflow-hidden",
        isDestructive ? "toast-error-surface rounded-[18px]" : "toast-surface rounded-[5px]",
        "transition-[opacity,transform] duration-200 ease-out",
        isExiting
          ? "opacity-0 translate-x-2 scale-[0.98]"
          : "opacity-100 translate-x-0 scale-100 animate-in slide-in-from-right-4 fade-in-0 duration-300"
      )}
      style={destructiveToastStyle}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className={cn("relative z-[1] w-0.5 shrink-0", config.accentClass)} />

      <div
        className={cn(
          "relative z-[1] flex items-start gap-2 flex-1 min-w-0",
          isDestructive ? "px-3.5 py-3.5 pr-13" : "px-2.5 py-2 pr-7"
        )}
      >
        <div className={cn("flex-1 min-w-0", isDestructive && hasDetail ? "space-y-2" : "")}>
          {message && (
            <div
              className={cn(
                isDestructive
                  ? "pr-9 text-[13px] font-semibold leading-[1.35] tracking-[-0.01em] text-[rgba(72,31,21,0.92)] dark:text-[rgba(255,241,236,0.94)]"
                  : "text-xs font-medium leading-tight text-white/90"
              )}
            >
              {message}
            </div>
          )}
          {detail &&
            (isDestructive ? (
              <div
                className={cn(
                  "toast-error-detail overflow-hidden rounded-[14px]",
                  "shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_10px_24px_-16px_rgba(91,37,23,0.18)]"
                )}
              >
                <div className="flex items-center justify-between gap-3 border-b border-[rgba(171,90,70,0.12)] px-3 py-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[rgba(150,78,60,0.78)] dark:text-[rgba(255,198,178,0.72)]">
                    {t("developerSection.whatGetsLogged.items.errorDetails")}
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyError}
                    className={cn(
                      "shrink-0 rounded-[9px] border border-[rgba(171,90,70,0.14)] bg-white/55 p-1.5",
                      "text-[rgba(124,58,45,0.6)] hover:border-[rgba(171,90,70,0.22)] hover:bg-white/76 hover:text-[rgba(88,40,29,0.86)]",
                      "transition-colors duration-150 dark:border-[rgba(255,173,144,0.12)] dark:bg-white/6 dark:text-[rgba(255,214,198,0.62)] dark:hover:bg-white/10 dark:hover:text-[rgba(255,238,230,0.86)]"
                    )}
                    aria-label={t("referral.inviteLink.copy")}
                  >
                    {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
                  </button>
                </div>
                <div
                  className={cn(
                    "overflow-y-auto px-3 py-2.5",
                    "font-mono text-[13px] leading-6 text-[rgba(90,39,30,0.82)] whitespace-pre-wrap break-all dark:text-[rgba(255,236,230,0.82)]"
                  )}
                  style={{ maxHeight: ERROR_SURFACE_LAYOUT.dictationToast.detailMaxHeightPx }}
                >
                  <span className="select-text">{detail}</span>
                </div>
              </div>
            ) : (
              <div className="text-xs leading-snug mt-0.5 text-white/45">{detail}</div>
            ))}
        </div>

        {action && <div className="shrink-0 self-center">{action}</div>}
      </div>

      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className={cn(
            "absolute right-2 top-2 z-10 pointer-events-auto p-1.5 rounded-[8px]",
            isDestructive
              ? "border border-[rgba(171,90,70,0.12)] bg-white/58 text-[rgba(116,54,41,0.62)] hover:border-[rgba(171,90,70,0.22)] hover:bg-white/76 hover:text-[rgba(77,34,25,0.88)] dark:border-[rgba(255,173,144,0.12)] dark:bg-white/6 dark:text-[rgba(255,214,198,0.62)] dark:hover:bg-white/10 dark:hover:text-[rgba(255,239,232,0.9)]"
              : "text-white/0 group-hover:text-white/50 hover:!text-white/80 hover:bg-white/6",
            "transition-colors duration-150",
            "focus:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
          )}
          aria-label={t("common.close")}
        >
          <X className="size-3" />
          <span className="sr-only">{t("common.close")}</span>
        </button>
      )}

      {duration > 0 && !isExiting && (
        <div className="absolute bottom-0 left-0.5 right-0 h-px overflow-hidden">
          <div
            className={cn("h-full", config.progressClass)}
            style={{
              animation: `toast-progress ${duration}ms linear forwards`,
            }}
          />
        </div>
      )}
    </div>
  );
};
