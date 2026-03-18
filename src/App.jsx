import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import DictationCapsule from "./components/DictationCapsule.tsx";
import { useToast } from "./components/ui/Toast";
import { useAudioRecording } from "./hooks/useAudioRecording";
import { useHotkey } from "./hooks/useHotkey";
import { useWindowDrag } from "./hooks/useWindowDrag";
import {
  DICTATION_CAPSULE_BOTTOM_OFFSET_PX,
  DICTATION_WINDOW_IDLE_HIDE_DELAY_MS,
  shouldCaptureDictationWindowInput,
  shouldKeepDictationWindowVisible,
  shouldShowDictationCapsule,
} from "./utils/dictationOverlayState.mjs";
import { formatHotkeyLabel } from "./utils/hotkeys";
import "./index.css";

export default function App() {
  const [isHovered, setIsHovered] = useState(false);
  const [isCommandMenuOpen, setIsCommandMenuOpen] = useState(false);
  const [dragStartPos, setDragStartPos] = useState(null);
  const [hasDragged, setHasDragged] = useState(false);

  const commandMenuRef = useRef(null);
  const buttonRef = useRef(null);
  const hasRecordedSinceShowRef = useRef(false);

  const { toast, dismiss, toastCount } = useToast();
  const { t } = useTranslation();
  const { hotkey } = useHotkey();
  const { isDragging, handleMouseDown, handleMouseUp } = useWindowDrag();

  const setWindowInteractivity = React.useCallback((shouldCapture) => {
    window.electronAPI?.setMainWindowInteractivity?.(shouldCapture);
  }, []);

  useEffect(() => {
    setWindowInteractivity(false);
    return () => setWindowInteractivity(false);
  }, [setWindowInteractivity]);

  useEffect(() => {
    const unsubscribeFallback = window.electronAPI?.onHotkeyFallbackUsed?.((data) => {
      toast({
        title: t("app.toasts.hotkeyChanged.title"),
        description: data.message,
        duration: 8000,
      });
    });

    const unsubscribeFailed = window.electronAPI?.onHotkeyRegistrationFailed?.(() => {
      toast({
        title: t("app.toasts.hotkeyUnavailable.title"),
        description: t("app.toasts.hotkeyUnavailable.description"),
        duration: 10000,
      });
    });

    const unsubscribeCorrections = window.electronAPI?.onCorrectionsLearned?.((words) => {
      if (!words || words.length === 0) {
        return;
      }

      const wordList = words.map((word) => `\u201c${word}\u201d`).join(", ");
      let toastId;
      toastId = toast({
        title: t("app.toasts.addedToDict", { words: wordList }),
        variant: "success",
        duration: 6000,
        action: (
          <button
            onClick={async () => {
              try {
                const result = await window.electronAPI?.undoLearnedCorrections?.(words);
                if (result?.success) {
                  dismiss(toastId);
                }
              } catch {
                // Silently fail and keep the learned corrections.
              }
            }}
            className="rounded-sm border border-emerald-400/20 bg-emerald-500/15 px-2.5 py-1 text-[10px] font-medium whitespace-nowrap text-emerald-100/90 transition-all duration-150 hover:border-emerald-400/35 hover:bg-emerald-500/25 hover:text-white"
          >
            {t("app.toasts.undo")}
          </button>
        ),
      });
    });

    return () => {
      unsubscribeFallback?.();
      unsubscribeFailed?.();
      unsubscribeCorrections?.();
    };
  }, [dismiss, t, toast]);

  const handleDictationToggle = React.useCallback(() => {
    setIsCommandMenuOpen(false);
    setWindowInteractivity(false);
  }, [setWindowInteractivity]);

  const {
    isRecording,
    isProcessing,
    isTranscribing,
    audioLevel,
    toggleListening,
    cancelRecording,
    cancelProcessing,
  } = useAudioRecording(toast, {
    onToggle: handleDictationToggle,
    dismiss,
  });

  const capsuleIsBusy = isTranscribing || isProcessing;
  const shouldRenderCapsule = shouldShowDictationCapsule({
    isRecording,
    isTranscribing,
    isProcessing,
  });
  const shouldKeepWindowVisible = shouldKeepDictationWindowVisible({
    isRecording,
    isTranscribing,
    isProcessing,
    isCommandMenuOpen,
    toastCount,
  });
  const shouldCaptureWindowInput = shouldCaptureDictationWindowInput({
    isRecording,
    isTranscribing,
    isProcessing,
    isCommandMenuOpen,
    toastCount,
  });

  useEffect(() => {
    if (shouldCaptureWindowInput) {
      setWindowInteractivity(true);
    } else if (!isHovered) {
      setWindowInteractivity(false);
    }
  }, [isHovered, setWindowInteractivity, shouldCaptureWindowInput]);

  useEffect(() => {
    if (isCommandMenuOpen && toastCount > 0) {
      window.electronAPI?.resizeMainWindow?.("EXPANDED");
      return;
    }

    if (isCommandMenuOpen) {
      window.electronAPI?.resizeMainWindow?.("WITH_MENU");
      return;
    }

    if (toastCount > 0) {
      window.electronAPI?.resizeMainWindow?.("WITH_TOAST");
      return;
    }

    window.electronAPI?.resizeMainWindow?.("BASE");
  }, [isCommandMenuOpen, toastCount]);

  useEffect(() => {
    if (isRecording) {
      hasRecordedSinceShowRef.current = true;
      return;
    }

    setIsCommandMenuOpen(false);
  }, [isRecording]);

  useEffect(() => {
    let hideTimeout;

    if (!shouldKeepWindowVisible) {
      const hideDelay = hasRecordedSinceShowRef.current ? DICTATION_WINDOW_IDLE_HIDE_DELAY_MS : 900;
      hideTimeout = setTimeout(() => {
        hasRecordedSinceShowRef.current = false;
        setWindowInteractivity(false);
        window.electronAPI?.hideWindow?.();
      }, hideDelay);
    }

    return () => clearTimeout(hideTimeout);
  }, [setWindowInteractivity, shouldKeepWindowVisible]);

  const handleClose = () => {
    window.electronAPI.hideWindow();
  };

  useEffect(() => {
    if (!isCommandMenuOpen) {
      return;
    }

    const handleClickOutside = (event) => {
      if (
        commandMenuRef.current &&
        !commandMenuRef.current.contains(event.target) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target)
      ) {
        setIsCommandMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isCommandMenuOpen]);

  useEffect(() => {
    const handleKeyPress = (event) => {
      if (event.key === "Escape") {
        // If recording, cancel it first
        if (isRecording) {
          cancelRecording();
          return;
        }
        if (isTranscribing || isProcessing) {
          cancelProcessing();
          return;
        }
        if (isCommandMenuOpen) {
          setIsCommandMenuOpen(false);
        } else {
          handleClose();
        }
      }
    };

    document.addEventListener("keydown", handleKeyPress);
    return () => document.removeEventListener("keydown", handleKeyPress);
  }, [
    isCommandMenuOpen,
    isRecording,
    isTranscribing,
    isProcessing,
    cancelRecording,
    cancelProcessing,
  ]);

  const hotkeyLabel = formatHotkeyLabel(hotkey);
  const secondaryLabel = isRecording
    ? t("app.mic.recording")
    : isProcessing
      ? t("app.mic.processing")
      : isTranscribing
        ? t("app.mic.transcribing")
        : t("app.mic.processing");

  return (
    <div className="dictation-window">
      {(shouldRenderCapsule || isCommandMenuOpen) && (
        <div
          className="fixed inset-x-0 z-50 flex justify-center"
          style={{ bottom: `${DICTATION_CAPSULE_BOTTOM_OFFSET_PX}px` }}
          onMouseEnter={() => {
            setIsHovered(true);
            setWindowInteractivity(true);
          }}
          onMouseLeave={() => {
            setIsHovered(false);
            if (!isCommandMenuOpen && !shouldCaptureWindowInput) {
              setWindowInteractivity(false);
            }
          }}
        >
          <div className="relative">
            {shouldRenderCapsule && isHovered && (
              <button
                aria-label={
                  isRecording ? t("app.buttons.cancelRecording") : t("app.buttons.cancelProcessing")
                }
                onClick={(event) => {
                  event.stopPropagation();
                  isRecording ? cancelRecording() : cancelProcessing();
                }}
                className="group/cancel absolute -right-1.5 -top-1.5 z-20 flex h-6 w-6 items-center justify-center rounded-full border border-[rgba(255,255,255,0.74)] bg-[rgba(24,24,27,0.72)] shadow-[0_12px_20px_rgba(15,23,42,0.18)] backdrop-blur-md transition-colors duration-150 hover:border-[rgba(255,196,196,0.95)] hover:bg-destructive"
              >
                <X
                  size={11}
                  strokeWidth={2.5}
                  className="text-white transition-colors duration-150 group-hover/cancel:text-destructive-foreground"
                />
              </button>
            )}

            {shouldRenderCapsule && (
              <DictationCapsule
                buttonRef={buttonRef}
                brandLabel="Mouthpiece"
                secondaryLabel={secondaryLabel}
                hotkeyLabel={hotkeyLabel}
                audioLevel={audioLevel}
                isHovered={isHovered}
                isRecording={isRecording}
                isProcessing={isProcessing}
                isTranscribing={capsuleIsBusy}
                isDragging={isDragging}
                onMouseDown={(event) => {
                  setIsCommandMenuOpen(false);
                  setDragStartPos({ x: event.clientX, y: event.clientY });
                  setHasDragged(false);
                  handleMouseDown(event);
                }}
                onMouseMove={(event) => {
                  if (dragStartPos && !hasDragged) {
                    const distance = Math.sqrt(
                      Math.pow(event.clientX - dragStartPos.x, 2) +
                        Math.pow(event.clientY - dragStartPos.y, 2)
                    );

                    if (distance > 5) {
                      setHasDragged(true);
                    }
                  }
                }}
                onMouseUp={(event) => {
                  handleMouseUp(event);
                  setDragStartPos(null);
                }}
                onClick={(event) => {
                  if (!hasDragged) {
                    setIsCommandMenuOpen(false);
                    toggleListening();
                  }
                  event.preventDefault();
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  if (!hasDragged) {
                    setWindowInteractivity(true);
                    setIsCommandMenuOpen((previous) => !previous);
                  }
                }}
                onFocus={() => setIsHovered(true)}
                onBlur={() => setIsHovered(false)}
              />
            )}

            {isCommandMenuOpen && (
              <div
                ref={commandMenuRef}
                className="absolute bottom-full right-2 mb-4 w-56 rounded-2xl border border-[rgba(220,220,220,0.94)] bg-[rgba(255,255,255,0.94)] text-popover-foreground shadow-[0_22px_44px_rgba(15,23,42,0.16)] backdrop-blur-xl"
                onMouseEnter={() => {
                  setWindowInteractivity(true);
                }}
                onMouseLeave={() => {
                  if (!isHovered && !shouldCaptureWindowInput) {
                    setWindowInteractivity(false);
                  }
                }}
              >
                <button
                  className="w-full rounded-t-2xl px-4 py-3 text-left text-sm font-medium text-[rgba(28,28,28,0.88)] transition-colors duration-150 hover:bg-[rgba(24,24,24,0.05)] focus:bg-[rgba(24,24,24,0.05)] focus:outline-none"
                  onClick={() => {
                    toggleListening();
                  }}
                >
                  {isRecording
                    ? t("app.commandMenu.stopListening")
                    : t("app.commandMenu.startListening")}
                </button>
                <div className="h-px bg-border" />
                <button
                  className="w-full rounded-b-2xl px-4 py-3 text-left text-sm text-[rgba(28,28,28,0.78)] transition-colors duration-150 hover:bg-[rgba(24,24,24,0.05)] focus:bg-[rgba(24,24,24,0.05)] focus:outline-none"
                  onClick={() => {
                    setIsCommandMenuOpen(false);
                    setWindowInteractivity(false);
                    handleClose();
                  }}
                >
                  {t("app.commandMenu.hideForNow")}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
