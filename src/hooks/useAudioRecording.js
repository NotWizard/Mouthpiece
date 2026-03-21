import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import AudioManager from "../helpers/audioManager";
import logger from "../utils/logger";
import { playStartCue, playStopCue } from "../utils/dictationCues";
import { getSettings } from "../stores/settingsStore";
import { getRecordingErrorTitle } from "../utils/recordingErrors";
import { resolveAsrFeatureFlags } from "../utils/asrFeatureFlags.mjs";
import {
  createAsrSessionTimeline,
  finalizeAsrSessionTimeline,
  hasAsrSessionEvent,
  markAsrSessionEvent,
  summarizeAsrSessionTimeline,
} from "../utils/asrSessionTimeline.mjs";
import { getDictationSessionState } from "../utils/dictationSessionState.mjs";
import {
  advanceLiveTranscriptStabilizer,
  commitLiveTranscriptStabilizer,
  createLiveTranscriptStabilizerState,
} from "../utils/liveTranscriptStabilizer.mjs";
import { buildInsertionRequest } from "../utils/insertionIntent";

const STABLE_PARTIAL_SETTLE_MS = 260;
const SINGLE_OCCURRENCE_SESSION_EVENTS = new Set([
  "capture_ready",
  "speech_detected",
  "first_partial",
  "first_stable_partial",
  "final_ready",
  "paste_started",
  "paste_finished",
  "fallback_used",
  "permission_required",
  "inserted",
  "cancelled",
  "error",
]);
const EMPTY_LIVE_TRANSCRIPT_SEGMENTS = Object.freeze({
  stableText: "",
  activeText: "",
  fullText: "",
});

function isPermissionError(error, title) {
  if (title === "Microphone Access Denied") {
    return true;
  }

  const description = error?.description || "";
  return /grant microphone permission/i.test(description);
}

function shouldShowFallbackToast(result) {
  if (!result) {
    return false;
  }

  if (result.fallbackUsed) {
    return true;
  }

  return typeof result.source === "string" && result.source.includes("fallback");
}

function buildLiveTranscriptSegments(state) {
  const nextState =
    state && typeof state === "object"
      ? { ...createLiveTranscriptStabilizerState(), ...state }
      : createLiveTranscriptStabilizerState();
  const stableText = `${nextState.frozenText || ""}${nextState.semiStableText || ""}`;
  const activeText = nextState.activeText || "";
  const fullText = nextState.displayText || stableText + activeText;

  if (!stableText && !activeText && !fullText) {
    return EMPTY_LIVE_TRANSCRIPT_SEGMENTS;
  }

  return {
    stableText,
    activeText,
    fullText,
  };
}

function normalizeProviderLiveTranscriptSegments(text) {
  if (!(text && typeof text === "object" && typeof text.fullText === "string")) {
    return null;
  }

  const stableText = typeof text.stableText === "string" ? text.stableText : "";
  const activeText = typeof text.activeText === "string" ? text.activeText : "";
  const fullText = typeof text.fullText === "string" ? text.fullText : `${stableText}${activeText}`;

  if (!stableText && !activeText && !fullText) {
    return EMPTY_LIVE_TRANSCRIPT_SEGMENTS;
  }

  return {
    stableText,
    activeText,
    fullText,
  };
}

export const useAudioRecording = (toast, options = {}) => {
  const { t } = useTranslation();
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [partialTranscript, setPartialTranscript] = useState("");
  const [partialTranscriptSegments, setPartialTranscriptSegments] = useState(
    EMPTY_LIVE_TRANSCRIPT_SEGMENTS
  );
  const [sessionSummary, setSessionSummary] = useState(null);
  const audioManagerRef = useRef(null);
  const sessionTimelineRef = useRef(null);
  const stablePartialTimeoutRef = useRef(null);
  const lastPartialTranscriptRef = useRef("");
  const partialStabilizerRef = useRef(createLiveTranscriptStabilizerState());
  const featureFlagsRef = useRef(resolveAsrFeatureFlags());
  const startLockRef = useRef(false);
  const stopLockRef = useRef(false);
  const pasteFallbackToastIdRef = useRef(null);
  const { onToggle, dismiss } = options;
  const isDictationActive = isRecording || isProcessing || isTranscribing;

  const clearPasteFallbackToast = useCallback(() => {
    if (pasteFallbackToastIdRef.current && typeof dismiss === "function") {
      dismiss(pasteFallbackToastIdRef.current);
    }
    pasteFallbackToastIdRef.current = null;
  }, [dismiss]);

  const clearStablePartialTimer = useCallback(() => {
    if (stablePartialTimeoutRef.current) {
      clearTimeout(stablePartialTimeoutRef.current);
      stablePartialTimeoutRef.current = null;
    }
  }, []);

  const resetPartialStabilizer = useCallback(
    ({ clearPreview = true } = {}) => {
      partialStabilizerRef.current = createLiveTranscriptStabilizerState();
      lastPartialTranscriptRef.current = "";
      clearStablePartialTimer();

      if (clearPreview) {
        setPartialTranscript("");
        setPartialTranscriptSegments(EMPTY_LIVE_TRANSCRIPT_SEGMENTS);
      }
    },
    [clearStablePartialTimer]
  );

  const trackSessionEvent = useCallback((eventType, data = {}) => {
    if (!featureFlagsRef.current.sessionTimeline || !sessionTimelineRef.current) {
      return null;
    }

    if (
      SINGLE_OCCURRENCE_SESSION_EVENTS.has(eventType) &&
      hasAsrSessionEvent(sessionTimelineRef.current, eventType)
    ) {
      return summarizeAsrSessionTimeline(sessionTimelineRef.current);
    }

    const summary = markAsrSessionEvent(
      sessionTimelineRef.current,
      eventType,
      data,
      performance.now()
    );
    setSessionSummary(summary);
    return summary;
  }, []);

  const finalizeSession = useCallback(
    (status) => {
      clearStablePartialTimer();

      if (!featureFlagsRef.current.sessionTimeline || !sessionTimelineRef.current) {
        audioManagerRef.current?.clearActiveSession?.();
        return null;
      }

      const summary = finalizeAsrSessionTimeline(sessionTimelineRef.current, {
        status,
        completedAtMs: performance.now(),
      });

      setSessionSummary(summary);
      logger.info(
        "ASR session summary",
        {
          sessionId: summary.sessionId,
          status: summary.status,
          lastEventType: summary.lastEventType,
          metrics: summary.metrics,
          flags: summary.flags,
        },
        "dictation-session"
      );
      sessionTimelineRef.current = null;
      audioManagerRef.current?.clearActiveSession?.();
      return summary;
    },
    [clearStablePartialTimer]
  );

  const beginSession = useCallback(
    (mode) => {
      if (!featureFlagsRef.current.sessionTimeline) {
        return null;
      }

      resetPartialStabilizer();
      const provider =
        mode === "streaming" ? audioManagerRef.current?.getStreamingProviderName?.() || null : null;
      const timeline = createAsrSessionTimeline({
        mode,
        context: "dictation",
        provider,
        startedAtMs: performance.now(),
      });

      sessionTimelineRef.current = timeline;
      const summary = summarizeAsrSessionTimeline(timeline);
      setSessionSummary(summary);
      audioManagerRef.current?.beginSession?.({
        sessionId: timeline.sessionId,
        mode,
        context: timeline.context,
        provider: timeline.provider,
        startedAtIso: timeline.startedAtIso,
      });
      return summary;
    },
    [resetPartialStabilizer]
  );

  const performStartRecording = useCallback(async () => {
    if (startLockRef.current) return false;
    startLockRef.current = true;
    try {
      if (!audioManagerRef.current) return false;

      const currentState = audioManagerRef.current.getState();
      if (currentState.isRecording || currentState.isProcessing) return false;

      const shouldUseStreaming = audioManagerRef.current.shouldUseStreaming();
      beginSession(shouldUseStreaming ? "streaming" : "batch");

      const didStart = shouldUseStreaming
        ? await audioManagerRef.current.startStreamingRecording()
        : await audioManagerRef.current.startRecording();

      if (didStart) {
        void playStartCue();
      } else {
        finalizeSession("cancelled");
      }

      return didStart;
    } finally {
      startLockRef.current = false;
    }
  }, [beginSession, finalizeSession]);

  const performStopRecording = useCallback(async () => {
    if (stopLockRef.current) return false;
    stopLockRef.current = true;
    try {
      if (!audioManagerRef.current) return false;

      const currentState = audioManagerRef.current.getState();
      if (!currentState.isRecording && !currentState.isStreamingStartInProgress) return false;

      if (currentState.isStreaming || currentState.isStreamingStartInProgress) {
        void playStopCue();
        return await audioManagerRef.current.stopStreamingRecording();
      }

      const didStop = audioManagerRef.current.stopRecording();

      if (didStop) {
        void playStopCue();
        setIsTranscribing(true);
      }

      return didStop;
    } finally {
      stopLockRef.current = false;
    }
  }, []);

  useEffect(() => {
    audioManagerRef.current = new AudioManager();
    audioManagerRef.current.setAsrFeatureFlags?.(featureFlagsRef.current);

    audioManagerRef.current.setCallbacks({
      onStateChange: ({
        isRecording: nextIsRecording,
        isProcessing: nextIsProcessing,
        isStreaming: nextIsStreaming,
      }) => {
        setIsRecording(nextIsRecording);
        setIsProcessing(nextIsProcessing);
        setIsStreaming(nextIsStreaming ?? false);

        if (nextIsRecording) {
          clearPasteFallbackToast();
          trackSessionEvent("capture_ready", {
            streaming: Boolean(nextIsStreaming),
          });
        }

        if (!nextIsProcessing && !nextIsRecording) {
          setIsTranscribing(false);
        }
        if (!nextIsRecording) {
          setAudioLevel(0);
        }
        if (!nextIsStreaming && !nextIsProcessing) {
          resetPartialStabilizer();
        }
      },
      onAudioLevel: (level) => {
        setAudioLevel(level);
      },
      onError: (error) => {
        const title = getRecordingErrorTitle(error, t);
        toast({
          title,
          description: error.description,
          variant: "destructive",
          duration: error.code === "AUTH_EXPIRED" ? 8000 : undefined,
        });
        setIsTranscribing(false);

        if (isPermissionError(error, title)) {
          trackSessionEvent("permission_required", {
            title,
            code: error.code,
          });
        }
        trackSessionEvent("error", {
          title,
          code: error.code,
          description: error.description,
        });
        finalizeSession("error");
      },
      onPartialTranscript: (text) => {
        const directSegments = normalizeProviderLiveTranscriptSegments(text);

        if (directSegments) {
          partialStabilizerRef.current = {
            rawText: directSegments.fullText,
            frozenText: directSegments.stableText,
            semiStableText: "",
            activeText: directSegments.activeText,
            displayText: directSegments.fullText,
          };
          setPartialTranscript(directSegments.fullText);
          setPartialTranscriptSegments({
            stableText: text.stableText || "",
            activeText: text.activeText || "",
            fullText: text.fullText || "",
          });

          const normalizedText =
            typeof directSegments.fullText === "string" ? directSegments.fullText.trim() : "";
          if (!normalizedText) {
            lastPartialTranscriptRef.current = "";
            clearStablePartialTimer();
            return;
          }

          trackSessionEvent("speech_detected", { textLength: normalizedText.length });
          trackSessionEvent("first_partial", { textLength: normalizedText.length });

          if (directSegments.stableText) {
            trackSessionEvent("first_stable_partial", { textLength: normalizedText.length });
          }

          lastPartialTranscriptRef.current = normalizedText;
          clearStablePartialTimer();
          stablePartialTimeoutRef.current = setTimeout(() => {
            if (lastPartialTranscriptRef.current !== normalizedText) {
              return;
            }
            trackSessionEvent("first_stable_partial", { textLength: normalizedText.length });
          }, STABLE_PARTIAL_SETTLE_MS);
          return;
        }

        const nextPartialState = advanceLiveTranscriptStabilizer(
          partialStabilizerRef.current,
          text,
          featureFlagsRef.current.incrementalStabilizer
            ? undefined
            : { unstableTailChars: Number.MAX_SAFE_INTEGER }
        );
        partialStabilizerRef.current = nextPartialState;
        setPartialTranscript(nextPartialState.displayText);
        setPartialTranscriptSegments(buildLiveTranscriptSegments(nextPartialState));

        const normalizedText =
          typeof nextPartialState.displayText === "string"
            ? nextPartialState.displayText.trim()
            : "";
        if (!normalizedText) {
          lastPartialTranscriptRef.current = "";
          clearStablePartialTimer();
          return;
        }

        trackSessionEvent("speech_detected", { textLength: normalizedText.length });
        trackSessionEvent("first_partial", { textLength: normalizedText.length });

        if (nextPartialState.frozenText) {
          trackSessionEvent("first_stable_partial", { textLength: normalizedText.length });
        }

        lastPartialTranscriptRef.current = normalizedText;
        clearStablePartialTimer();
        stablePartialTimeoutRef.current = setTimeout(() => {
          if (lastPartialTranscriptRef.current !== normalizedText) {
            return;
          }
          trackSessionEvent("first_stable_partial", { textLength: normalizedText.length });
        }, STABLE_PARTIAL_SETTLE_MS);
      },
      onStreamingCommit: (committedText) => {
        if (!featureFlagsRef.current.incrementalStabilizer) {
          return;
        }

        partialStabilizerRef.current = commitLiveTranscriptStabilizer(
          partialStabilizerRef.current,
          committedText
        );
        setPartialTranscript(partialStabilizerRef.current.displayText);
        setPartialTranscriptSegments(buildLiveTranscriptSegments(partialStabilizerRef.current));
      },
      onTranscriptionComplete: async (result) => {
        setIsTranscribing(false);

        if (!result?.success) {
          trackSessionEvent("error", { code: "TRANSCRIPTION_FAILED" });
          finalizeSession("error");
          return;
        }

        const transcribedText = result.text?.trim();
        if (!transcribedText) {
          finalizeSession("completed");
          return;
        }

        setTranscript(result.text);

        if (shouldShowFallbackToast(result)) {
          trackSessionEvent("fallback_used", { source: result.source });
        }

        trackSessionEvent("final_ready", {
          source: result.source,
          textLength: transcribedText.length,
          sessionId: result.sessionId,
        });

        const isStreaming = result.source?.includes("streaming");
        const targetApp =
          (await window.electronAPI?.getTargetAppInfo?.().catch(() => null)) || null;
        const settings = getSettings();
        const insertionRequest = buildInsertionRequest({
          fromStreaming: isStreaming,
          preserveClipboard: true,
          allowFallbackCopy: true,
          targetApp,
        });
        trackSessionEvent("paste_started", {
          source: result.source,
          textLength: result.text.length,
          intent: insertionRequest.intent,
          replaceSelectionExpected: insertionRequest.replaceSelectionExpected,
          preserveClipboard: insertionRequest.preserveClipboard,
          allowFallbackCopy: insertionRequest.allowFallbackCopy,
          targetApp: insertionRequest.targetApp,
        });

        const pasteStart = performance.now();
        const pasteResult = await audioManagerRef.current.safePaste(result.text, {
          ...insertionRequest,
          sensitiveAppProtectionEnabled: settings.sensitiveAppProtectionEnabled !== false,
          sensitiveAppBlockInsertion: settings.sensitiveAppBlockInsertion === true,
          allowSensitiveAppCloudReasoning: settings.allowSensitiveAppCloudReasoning === true,
          allowSensitiveAppAutoLearn: settings.allowSensitiveAppAutoLearn === true,
          allowSensitiveAppPasteMonitoring: settings.allowSensitiveAppPasteMonitoring === true,
        });
        const pasteMode = pasteResult?.mode || (pasteResult?.success ? "pasted" : "failed");
        const insertionOutcomeMode =
          pasteResult?.outcomeMode ||
          (pasteMode === "copied" ? "copied" : pasteMode === "failed" ? "failed" : "inserted");

        trackSessionEvent("paste_finished", {
          mode: pasteMode,
          outcomeMode: insertionOutcomeMode,
          success: Boolean(pasteResult?.success),
          reason: pasteResult?.reason,
          compatibilityProfileId: pasteResult?.compatibilityProfileId,
          feedbackCode: pasteResult?.feedbackCode,
          recoveryHint: pasteResult?.recoveryHint,
          retryCount: pasteResult?.retryCount,
        });

        if (pasteMode === "copied") {
          window.electronAPI?.showDictationPanel?.();
          clearPasteFallbackToast();
          const stickyId = toast({
            title: t("hooks.audioRecording.pasteCopied.title"),
            description: t("hooks.audioRecording.pasteCopied.description"),
            duration: 0,
          });
          pasteFallbackToastIdRef.current = stickyId;
          finalizeSession("completed");
        } else if (pasteMode === "failed") {
          clearPasteFallbackToast();
          window.electronAPI?.showDictationPanel?.();
          toast({
            title: t("hooks.clipboard.pasteFailed.title"),
            description: pasteResult?.message || t("hooks.clipboard.pasteFailed.description"),
            variant: "destructive",
            duration: 8000,
          });
          trackSessionEvent("error", {
            code: "PASTE_FAILED",
            reason: pasteResult?.reason,
          });
          finalizeSession("error");
        } else {
          trackSessionEvent("inserted", {
            mode: pasteMode,
            outcomeMode: insertionOutcomeMode,
            intent: pasteResult?.intent || insertionRequest.intent,
            compatibilityProfileId: pasteResult?.compatibilityProfileId,
          });
          finalizeSession("inserted");
        }

        logger.info(
          "Paste timing",
          {
            sessionId: result.sessionId,
            pasteMs: Math.round(performance.now() - pasteStart),
            source: result.source,
            textLength: result.text.length,
            mode: pasteMode,
            reason: pasteResult?.reason,
            compatibilityProfileId: pasteResult?.compatibilityProfileId,
            feedbackCode: pasteResult?.feedbackCode,
            retryCount: pasteResult?.retryCount,
          },
          "streaming"
        );

        audioManagerRef.current.saveTranscription(result.text);

        if (shouldShowFallbackToast(result)) {
          toast({
            title: t("hooks.audioRecording.fallback.title"),
            description: t("hooks.audioRecording.fallback.description"),
            variant: "default",
          });
        }

        if (audioManagerRef.current.sttConfig?.dictation?.mode === "streaming") {
          audioManagerRef.current.warmupStreamingConnection();
        }
      },
    });

    audioManagerRef.current.setContext("dictation");
    window.electronAPI.getSttConfig?.().then((config) => {
      if (config && audioManagerRef.current) {
        audioManagerRef.current.setSttConfig(config);
        if (config.dictation?.mode === "streaming") {
          audioManagerRef.current.warmupStreamingConnection();
        }
      }
    });

    const handleToggle = async () => {
      if (!audioManagerRef.current) return;
      const currentState = audioManagerRef.current.getState();

      if (!currentState.isRecording && !currentState.isProcessing) {
        await performStartRecording();
      } else if (currentState.isRecording) {
        await performStopRecording();
      }
    };

    const handleStart = async () => {
      await performStartRecording();
    };

    const handleStop = async () => {
      await performStopRecording();
    };

    const disposeToggle = window.electronAPI.onToggleDictation(() => {
      handleToggle();
      onToggle?.();
    });

    const disposeStart = window.electronAPI.onStartDictation?.(() => {
      handleStart();
      onToggle?.();
    });

    const disposeStop = window.electronAPI.onStopDictation?.(() => {
      handleStop();
      onToggle?.();
    });

    const handleNoAudioDetected = () => {
      toast({
        title: t("hooks.audioRecording.noAudio.title"),
        description: t("hooks.audioRecording.noAudio.description"),
        variant: "default",
      });
    };

    const disposeNoAudio = window.electronAPI.onNoAudioDetected?.(handleNoAudioDetected);

    return () => {
      clearPasteFallbackToast();
      clearStablePartialTimer();
      disposeToggle?.();
      disposeStart?.();
      disposeStop?.();
      disposeNoAudio?.();
      audioManagerRef.current?.clearActiveSession?.();
      if (audioManagerRef.current) {
        audioManagerRef.current.cleanup();
      }
    };
  }, [
    toast,
    onToggle,
    performStartRecording,
    performStopRecording,
    t,
    clearPasteFallbackToast,
    clearStablePartialTimer,
    resetPartialStabilizer,
    trackSessionEvent,
    finalizeSession,
  ]);

  const startRecording = async () => {
    return performStartRecording();
  };

  const stopRecording = async () => {
    return performStopRecording();
  };

  const cancelRecording = useCallback(async () => {
    if (audioManagerRef.current) {
      const state = audioManagerRef.current.getState();
      const didCancel =
        state.isStreaming || state.isStreamingStartInProgress
          ? await audioManagerRef.current.cancelStreamingRecording()
          : audioManagerRef.current.cancelRecording();

      if (didCancel) {
        trackSessionEvent("cancelled", {
          stage: state.isStreaming || state.isStreamingStartInProgress ? "streaming" : "recording",
        });
        finalizeSession("cancelled");
      }

      return didCancel;
    }
    return false;
  }, [finalizeSession, trackSessionEvent]);

  const cancelProcessing = useCallback(() => {
    if (audioManagerRef.current) {
      const didCancel = audioManagerRef.current.cancelProcessing();
      if (didCancel) {
        trackSessionEvent("cancelled", { stage: "processing" });
        finalizeSession("cancelled");
      }
      return didCancel;
    }
    return false;
  }, [finalizeSession, trackSessionEvent]);

  useEffect(() => {
    void window.electronAPI?.setDictationCancelEnabled?.(isDictationActive);

    return () => {
      if (isDictationActive) {
        void window.electronAPI?.setDictationCancelEnabled?.(false);
      }
    };
  }, [isDictationActive]);

  useEffect(() => {
    const disposeCancel = window.electronAPI.onCancelDictation?.(() => {
      const currentState = audioManagerRef.current?.getState();
      if (!currentState) {
        return;
      }

      if (
        currentState.isRecording ||
        currentState.isStreaming ||
        currentState.isStreamingStartInProgress
      ) {
        void cancelRecording();
        return;
      }

      if (currentState.isProcessing) {
        cancelProcessing();
      }
    });

    return () => {
      disposeCancel?.();
    };
  }, [cancelProcessing, cancelRecording]);

  const toggleListening = async () => {
    if (!isRecording && !isProcessing) {
      await startRecording();
    } else if (isRecording) {
      await stopRecording();
    }
  };

  const dictationState = getDictationSessionState({
    isRecording,
    isProcessing,
    isTranscribing,
    sessionSummary,
  });

  return {
    isRecording,
    isProcessing,
    isTranscribing,
    isStreaming,
    dictationState,
    sessionSummary,
    audioLevel,
    transcript,
    partialTranscript,
    partialTranscriptSegments,
    startRecording,
    stopRecording,
    cancelRecording,
    cancelProcessing,
    toggleListening,
  };
};
