import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import AudioManager from "../helpers/audioManager";
import logger from "../utils/logger";
import { playStartCue, playStopCue } from "../utils/dictationCues";
import { getSettings } from "../stores/settingsStore";
import { getRecordingErrorTitle } from "../utils/recordingErrors";

export const useAudioRecording = (toast, options = {}) => {
  const { t } = useTranslation();
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [partialTranscript, setPartialTranscript] = useState("");
  const audioManagerRef = useRef(null);
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

  const performStartRecording = useCallback(async () => {
    if (startLockRef.current) return false;
    startLockRef.current = true;
    try {
      if (!audioManagerRef.current) return false;

      const currentState = audioManagerRef.current.getState();
      if (currentState.isRecording || currentState.isProcessing) return false;

      const didStart = audioManagerRef.current.shouldUseStreaming()
        ? await audioManagerRef.current.startStreamingRecording()
        : await audioManagerRef.current.startRecording();

      if (didStart) {
        void playStartCue();
      }

      return didStart;
    } finally {
      startLockRef.current = false;
    }
  }, []);

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
        // Set transcribing state when recording stops (will show loading capsule)
        setIsTranscribing(true);
      }

      return didStop;
    } finally {
      stopLockRef.current = false;
    }
  }, []);

  useEffect(() => {
    audioManagerRef.current = new AudioManager();

    audioManagerRef.current.setCallbacks({
      onStateChange: ({ isRecording, isProcessing, isStreaming }) => {
        setIsRecording(isRecording);
        setIsProcessing(isProcessing);
        setIsStreaming(isStreaming ?? false);
        // Reset transcribing state when processing is done
        if (!isProcessing && !isRecording) {
          setIsTranscribing(false);
        }
        if (isRecording) {
          clearPasteFallbackToast();
        }
        if (!isRecording) {
          setAudioLevel(0);
        }
        if (!isStreaming) {
          setPartialTranscript("");
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
        // Reset transcribing state on error
        setIsTranscribing(false);
      },
      onPartialTranscript: (text) => {
        setPartialTranscript(text);
      },
      onTranscriptionComplete: async (result) => {
        // Reset transcribing state when transcription is complete
        setIsTranscribing(false);
        if (result.success) {
          const transcribedText = result.text?.trim();

          if (!transcribedText) {
            return;
          }

          setTranscript(result.text);

          const isStreaming = result.source?.includes("streaming");
          const pasteStart = performance.now();
          const pasteResult = await audioManagerRef.current.safePaste(
            result.text,
            isStreaming
              ? { fromStreaming: true, preserveClipboard: true }
              : { preserveClipboard: true }
          );
          const pasteMode = pasteResult?.mode || (pasteResult?.success ? "pasted" : "failed");

          if (pasteMode === "copied") {
            window.electronAPI?.showDictationPanel?.();
            clearPasteFallbackToast();
            const stickyId = toast({
              title: t("hooks.audioRecording.pasteCopied.title"),
              description: t("hooks.audioRecording.pasteCopied.description"),
              duration: 0,
            });
            pasteFallbackToastIdRef.current = stickyId;
          } else if (pasteMode === "failed") {
            clearPasteFallbackToast();
            window.electronAPI?.showDictationPanel?.();
            toast({
              title: t("hooks.clipboard.pasteFailed.title"),
              description: pasteResult?.message || t("hooks.clipboard.pasteFailed.description"),
              variant: "destructive",
              duration: 8000,
            });
          }

          logger.info(
            "Paste timing",
            {
              pasteMs: Math.round(performance.now() - pasteStart),
              source: result.source,
              textLength: result.text.length,
              mode: pasteMode,
              reason: pasteResult?.reason,
            },
            "streaming"
          );

          audioManagerRef.current.saveTranscription(result.text);

          if (result.source === "openai" && getSettings().useLocalWhisper) {
            toast({
              title: t("hooks.audioRecording.fallback.title"),
              description: t("hooks.audioRecording.fallback.description"),
              variant: "default",
            });
          }

          if (audioManagerRef.current.sttConfig?.dictation?.mode === "streaming") {
            audioManagerRef.current.warmupStreamingConnection();
          }
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

    // Cleanup
    return () => {
      clearPasteFallbackToast();
      disposeToggle?.();
      disposeStart?.();
      disposeStop?.();
      disposeNoAudio?.();
      if (audioManagerRef.current) {
        audioManagerRef.current.cleanup();
      }
    };
  }, [toast, onToggle, performStartRecording, performStopRecording, t, clearPasteFallbackToast]);

  const startRecording = async () => {
    return performStartRecording();
  };

  const stopRecording = async () => {
    return performStopRecording();
  };

  const cancelRecording = useCallback(async () => {
    if (audioManagerRef.current) {
      const state = audioManagerRef.current.getState();
      if (state.isStreaming) {
        return await audioManagerRef.current.stopStreamingRecording();
      }
      return audioManagerRef.current.cancelRecording();
    }
    return false;
  }, []);

  const cancelProcessing = useCallback(() => {
    if (audioManagerRef.current) {
      return audioManagerRef.current.cancelProcessing();
    }
    return false;
  }, []);

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

      if (currentState.isRecording || currentState.isStreaming) {
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

  return {
    isRecording,
    isProcessing,
    isTranscribing,
    isStreaming,
    audioLevel,
    transcript,
    partialTranscript,
    startRecording,
    stopRecording,
    cancelRecording,
    cancelProcessing,
    toggleListening,
  };
};
