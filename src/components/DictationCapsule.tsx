import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type RefObject,
} from "react";
import { buildWaveformDots } from "../utils/dictationWaveform.mjs";
import {
  getLiveTranscriptOffsetPx,
  normalizeLiveTranscriptText,
} from "../utils/liveTranscriptMotion.mjs";
import {
  getLiveTranscriptRevealBase,
  stepLiveTranscriptReveal,
} from "../utils/liveTranscriptReveal.mjs";
import {
  DICTATION_CAPSULE_CONTENT_SWAP_DELAY_MS,
  DICTATION_CAPSULE_MORPH_DURATION_MS,
  getDictationCapsuleLayout,
  getDictationCapsuleVisualState,
} from "../utils/dictationCapsuleTransition.mjs";

const WAVEFORM_DOT_COUNT = 29;
const LIVE_PREVIEW_RENDER_MAX_CHARS = 160;
const LIVE_PREVIEW_TRAILING_REVEAL_PX = 12;
const LIVE_PREVIEW_ENTRANCE_DURATION_MS = 320;
const LIVE_PREVIEW_GHOST_EXIT_DURATION_MS = 260;
const LIVE_PREVIEW_SCROLL_DURATION_MS = 240;
const LIVE_PREVIEW_REVEAL_FRAME_MS = 28;
const LIVE_PREVIEW_REVEAL_MAX_CHARS_PER_FRAME = 1;
const LIVE_PREVIEW_EDGE_MASK =
  "linear-gradient(90deg, black 0px, black calc(100% - 16px), transparent 100%)";

function createSilentSamples() {
  return Array.from({ length: WAVEFORM_DOT_COUNT }, () => 0);
}

interface DictationCapsuleProps {
  brandLabel: string;
  secondaryLabel: string;
  hotkeyLabel: string;
  showTranscriptPreview: boolean;
  audioLevel: number;
  isHovered: boolean;
  isRecording: boolean;
  isProcessing: boolean;
  isTranscribing: boolean;
  isDragging: boolean;
  buttonRef: RefObject<HTMLButtonElement | null>;
  onMouseDown: (event: MouseEvent<HTMLButtonElement>) => void;
  onMouseMove: (event: MouseEvent<HTMLButtonElement>) => void;
  onMouseUp: (event: MouseEvent<HTMLButtonElement>) => void;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  onContextMenu: (event: MouseEvent<HTMLButtonElement>) => void;
  onFocus: () => void;
  onBlur: () => void;
}

function AssistantGlyph() {
  return (
    <div className="relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-[14px] border border-white/70 bg-white/85 shadow-[0_6px_14px_rgba(15,23,42,0.12)]">
      <div className="absolute inset-[3px] rounded-[10px] bg-[radial-gradient(circle_at_30%_25%,rgba(255,255,255,0.95),rgba(255,255,255,0.2)_45%,transparent_70%),linear-gradient(135deg,rgba(115,126,255,0.98),rgba(66,92,255,0.88))]" />
      <div className="relative flex items-center gap-1">
        <span className="block h-2 w-2 rounded-full bg-white/92 shadow-[0_0_8px_rgba(255,255,255,0.65)]" />
        <span className="block h-2 w-3 rounded-full bg-white/78 shadow-[0_0_8px_rgba(255,255,255,0.45)]" />
      </div>
    </div>
  );
}

function BrandGlyph() {
  return (
    <div className="flex items-center gap-1 text-[rgba(43,43,43,0.62)]">
      {[0.65, 1, 0.72].map((height, index) => (
        <span
          key={index}
          className="block w-[3px] rounded-full bg-current"
          style={{ height: `${Math.round(height * 11)}px` }}
        />
      ))}
    </div>
  );
}

function LoadingSpinner() {
  return (
    <div className="relative flex h-4 w-4 items-center justify-center">
      <svg
        className="animate-spin"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle cx="12" cy="12" r="10" stroke="rgba(100,100,100,0.3)" strokeWidth="2" fill="none" />
        <path
          d="M12 2C6.477 2 2 6.477 2 12c0 1.656.336 3.232.94 4.66"
          stroke="rgba(80,80,80,0.9)"
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
    </div>
  );
}

function MorphBridge() {
  return (
    <div className="flex items-center justify-center gap-1.5">
      {[11, 17, 11].map((height, index) => (
        <span
          key={index}
          className="block w-[4px] rounded-full bg-[rgba(82,82,82,0.76)] shadow-[0_0_10px_rgba(255,255,255,0.2)] animate-pulse"
          style={{
            height: `${height}px`,
            animationDelay: `${index * 120}ms`,
            animationDuration: "880ms",
            opacity: index === 1 ? 0.98 : 0.72,
          }}
        />
      ))}
    </div>
  );
}

export default function DictationCapsule({
  brandLabel,
  secondaryLabel,
  hotkeyLabel,
  showTranscriptPreview,
  audioLevel,
  isHovered,
  isRecording,
  isProcessing,
  isTranscribing,
  isDragging,
  buttonRef,
  onMouseDown,
  onMouseMove,
  onMouseUp,
  onClick,
  onContextMenu,
  onFocus,
  onBlur,
}: DictationCapsuleProps) {
  const helperText = isRecording || isProcessing || isTranscribing ? secondaryLabel : hotkeyLabel;
  const livePreviewTargetText = normalizeLiveTranscriptText(secondaryLabel, {
    maxChars: LIVE_PREVIEW_RENDER_MAX_CHARS,
  });
  const [sampleHistory, setSampleHistory] = useState<number[]>(() => createSilentSamples());
  const [transitionElapsedMs, setTransitionElapsedMs] = useState(
    isTranscribing ? DICTATION_CAPSULE_CONTENT_SWAP_DELAY_MS : 0
  );
  const [livePreviewOffsetPx, setLivePreviewOffsetPx] = useState(0);
  const [revealedLivePreviewText, setRevealedLivePreviewText] = useState("");
  const [showListeningGhost, setShowListeningGhost] = useState(false);
  const [isTranscriptEntranceActive, setIsTranscriptEntranceActive] = useState(false);
  const [listeningGhostLabel, setListeningGhostLabel] = useState(helperText);
  const hasMountedRef = useRef(false);
  const wasRecordingRef = useRef(isRecording);
  const wasShowingTranscriptPreviewRef = useRef(showTranscriptPreview);
  const livePreviewViewportRef = useRef<HTMLDivElement | null>(null);
  const livePreviewTextRef = useRef<HTMLDivElement | null>(null);
  const livePreviewMeasureFrameRef = useRef<number | undefined>(undefined);
  const transcriptEntranceFrameRef = useRef<number | undefined>(undefined);
  const transcriptEntranceTimeoutRef = useRef<number | undefined>(undefined);
  const livePreviewRevealTimeoutRef = useRef<number | undefined>(undefined);
  const listeningGhostLabelRef = useRef(helperText);
  const liveShellActive = isRecording;
  const liveTrackText = showTranscriptPreview ? revealedLivePreviewText : helperText;
  const listeningGhostText = helperText;

  useEffect(() => {
    if (isRecording && !wasRecordingRef.current) {
      setSampleHistory(createSilentSamples());
    }

    wasRecordingRef.current = isRecording;
  }, [isRecording]);

  useEffect(() => {
    if (!isRecording) {
      if (!isTranscribing) {
        setSampleHistory(createSilentSamples());
      }
      return;
    }

    setSampleHistory((current) => {
      const next = current.slice(-(WAVEFORM_DOT_COUNT - 1));
      next.push(audioLevel);

      while (next.length < WAVEFORM_DOT_COUNT) {
        next.unshift(0);
      }

      return next;
    });
  }, [audioLevel, isRecording, isTranscribing]);

  useEffect(() => {
    let timeoutId: number | undefined;

    if (!isTranscribing) {
      setTransitionElapsedMs(0);
    } else if (hasMountedRef.current) {
      setTransitionElapsedMs(0);
      timeoutId = window.setTimeout(() => {
        setTransitionElapsedMs(DICTATION_CAPSULE_CONTENT_SWAP_DELAY_MS);
      }, DICTATION_CAPSULE_CONTENT_SWAP_DELAY_MS);
    } else {
      setTransitionElapsedMs(DICTATION_CAPSULE_CONTENT_SWAP_DELAY_MS);
    }

    hasMountedRef.current = true;

    return () => {
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [isTranscribing]);

  useEffect(() => {
    if (!showTranscriptPreview) {
      listeningGhostLabelRef.current = listeningGhostText;
      setListeningGhostLabel(listeningGhostText);
    }
  }, [listeningGhostText, showTranscriptPreview]);

  useEffect(() => {
    if (livePreviewRevealTimeoutRef.current !== undefined) {
      window.clearTimeout(livePreviewRevealTimeoutRef.current);
      livePreviewRevealTimeoutRef.current = undefined;
    }

    if (!showTranscriptPreview || !livePreviewTargetText) {
      setRevealedLivePreviewText("");
      return;
    }

    setRevealedLivePreviewText((currentText) => {
      const baseText = getLiveTranscriptRevealBase({
        renderedText: currentText,
        targetText: livePreviewTargetText,
      });

      return currentText === baseText ? currentText : baseText;
    });
  }, [livePreviewTargetText, showTranscriptPreview]);

  useEffect(() => {
    if (livePreviewRevealTimeoutRef.current !== undefined) {
      window.clearTimeout(livePreviewRevealTimeoutRef.current);
      livePreviewRevealTimeoutRef.current = undefined;
    }

    if (!showTranscriptPreview || !livePreviewTargetText) {
      return;
    }

    if (revealedLivePreviewText === livePreviewTargetText) {
      return;
    }

    livePreviewRevealTimeoutRef.current = window.setTimeout(() => {
      setRevealedLivePreviewText((currentText) =>
        stepLiveTranscriptReveal({
          renderedText: currentText,
          targetText: livePreviewTargetText,
          maxCharsPerStep: LIVE_PREVIEW_REVEAL_MAX_CHARS_PER_FRAME,
        })
      );
      livePreviewRevealTimeoutRef.current = undefined;
    }, LIVE_PREVIEW_REVEAL_FRAME_MS);

    return () => {
      if (livePreviewRevealTimeoutRef.current !== undefined) {
        window.clearTimeout(livePreviewRevealTimeoutRef.current);
        livePreviewRevealTimeoutRef.current = undefined;
      }
    };
  }, [livePreviewTargetText, revealedLivePreviewText, showTranscriptPreview]);

  useEffect(() => {
    const wasShowingTranscriptPreview = wasShowingTranscriptPreviewRef.current;

    if (showTranscriptPreview && !wasShowingTranscriptPreview) {
      if (transcriptEntranceFrameRef.current !== undefined) {
        window.cancelAnimationFrame(transcriptEntranceFrameRef.current);
      }

      if (transcriptEntranceTimeoutRef.current !== undefined) {
        window.clearTimeout(transcriptEntranceTimeoutRef.current);
      }

      setListeningGhostLabel(listeningGhostLabelRef.current || listeningGhostText);
      setShowListeningGhost(true);
      setIsTranscriptEntranceActive(false);

      transcriptEntranceFrameRef.current = window.requestAnimationFrame(() => {
        setIsTranscriptEntranceActive(true);
        transcriptEntranceFrameRef.current = undefined;
        transcriptEntranceTimeoutRef.current = window.setTimeout(() => {
          setShowListeningGhost(false);
          transcriptEntranceTimeoutRef.current = undefined;
        }, LIVE_PREVIEW_GHOST_EXIT_DURATION_MS);
      });
    }

    if (!showTranscriptPreview) {
      if (transcriptEntranceFrameRef.current !== undefined) {
        window.cancelAnimationFrame(transcriptEntranceFrameRef.current);
        transcriptEntranceFrameRef.current = undefined;
      }

      if (transcriptEntranceTimeoutRef.current !== undefined) {
        window.clearTimeout(transcriptEntranceTimeoutRef.current);
        transcriptEntranceTimeoutRef.current = undefined;
      }

      setShowListeningGhost(false);
      setIsTranscriptEntranceActive(false);
    }

    wasShowingTranscriptPreviewRef.current = showTranscriptPreview;
  }, [listeningGhostText, showTranscriptPreview]);

  useEffect(() => {
    return () => {
      if (transcriptEntranceFrameRef.current !== undefined) {
        window.cancelAnimationFrame(transcriptEntranceFrameRef.current);
      }

      if (transcriptEntranceTimeoutRef.current !== undefined) {
        window.clearTimeout(transcriptEntranceTimeoutRef.current);
      }

      if (livePreviewRevealTimeoutRef.current !== undefined) {
        window.clearTimeout(livePreviewRevealTimeoutRef.current);
      }
    };
  }, []);

  useLayoutEffect(() => {
    const scheduleMeasure = () => {
      if (livePreviewMeasureFrameRef.current !== undefined) {
        window.cancelAnimationFrame(livePreviewMeasureFrameRef.current);
      }

      livePreviewMeasureFrameRef.current = window.requestAnimationFrame(() => {
        livePreviewMeasureFrameRef.current = undefined;

        if (!liveShellActive || !showTranscriptPreview) {
          setLivePreviewOffsetPx(0);
          return;
        }

        const viewport = livePreviewViewportRef.current;
        const text = livePreviewTextRef.current;

        if (!viewport || !text) {
          setLivePreviewOffsetPx(0);
          return;
        }

        const nextOffsetPx = getLiveTranscriptOffsetPx({
          contentWidthPx: text.scrollWidth,
          viewportWidthPx: viewport.clientWidth,
          trailingRevealPx: LIVE_PREVIEW_TRAILING_REVEAL_PX,
        });

        setLivePreviewOffsetPx((currentOffsetPx) =>
          currentOffsetPx === nextOffsetPx ? currentOffsetPx : nextOffsetPx
        );
      });
    };

    scheduleMeasure();

    let resizeObserver: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        scheduleMeasure();
      });

      if (livePreviewViewportRef.current) {
        resizeObserver.observe(livePreviewViewportRef.current);
      }

      if (livePreviewTextRef.current) {
        resizeObserver.observe(livePreviewTextRef.current);
      }
    } else {
      window.addEventListener("resize", scheduleMeasure);
    }

    return () => {
      if (livePreviewMeasureFrameRef.current !== undefined) {
        window.cancelAnimationFrame(livePreviewMeasureFrameRef.current);
        livePreviewMeasureFrameRef.current = undefined;
      }

      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
    };
  }, [liveShellActive, liveTrackText, showTranscriptPreview]);

  const dots = buildWaveformDots({
    count: WAVEFORM_DOT_COUNT,
    samples: sampleHistory,
    active: isRecording,
  });

  const visualState = getDictationCapsuleVisualState({
    isTranscribing,
    elapsedMs: transitionElapsedMs,
  });
  const recordingLayout = getDictationCapsuleLayout({ stage: "recording" });
  const previewLayout = getDictationCapsuleLayout({ stage: "preview" });
  const layout = liveShellActive
    ? previewLayout
    : getDictationCapsuleLayout({ stage: visualState.stage });
  const glowColor = isRecording ? "rgba(255, 132, 132, 0.48)" : "rgba(244, 166, 89, 0.26)";
  const borderColor =
    isRecording || isProcessing || isTranscribing
      ? "rgba(255, 157, 157, 0.72)"
      : "rgba(201, 201, 201, 0.92)";
  const recordingLayerVisible = !liveShellActive && visualState.stage !== "transcribing";
  const morphLayerVisible = !liveShellActive && visualState.stage !== "recording";
  const compactLayerVisible = !liveShellActive && visualState.stage !== "recording";
  const recordingContentOpacity = visualState.showRecordingContent ? 1 : 0;
  const morphContentOpacity = visualState.showMorphIndicator ? 1 : 0;
  const transcribingContentOpacity = visualState.showCompactContent ? 1 : 0;
  const recordingContentTransform = visualState.showRecordingContent
    ? "translate(-50%, -50%) scale(1)"
    : "translate(-50%, calc(-50% - 6px)) scale(0.975)";
  const morphContentTransform = visualState.showMorphIndicator
    ? "translateY(0) scale(1)"
    : visualState.showCompactContent
      ? "translateY(-4px) scale(0.94)"
      : "translateY(4px) scale(0.96)";
  const transcribingContentTransform = visualState.showCompactContent
    ? "translateY(0) scale(1)"
    : "translateY(5px) scale(0.96)";
  const livePreviewViewportStyle = {
    WebkitMaskImage: showTranscriptPreview || showListeningGhost ? LIVE_PREVIEW_EDGE_MASK : "none",
    maskImage: showTranscriptPreview || showListeningGhost ? LIVE_PREVIEW_EDGE_MASK : "none",
  };
  const transcriptEntranceStyle = showTranscriptPreview
    ? {
        opacity: isTranscriptEntranceActive ? 1 : 0.01,
        filter: isTranscriptEntranceActive ? "blur(0px)" : "blur(7px)",
        transform: isTranscriptEntranceActive
          ? "translate3d(0, 0, 0) scale(1)"
          : "translate3d(0, 7px, 0) scale(0.988)",
        clipPath: isTranscriptEntranceActive
          ? "inset(0 0% 0 0 round 10px)"
          : "inset(0 100% 0 0 round 10px)",
        transitionDuration: `${LIVE_PREVIEW_ENTRANCE_DURATION_MS}ms`,
      }
    : {
        opacity: 1,
        filter: "blur(0px)",
        transform: "translate3d(0, 0, 0) scale(1)",
        clipPath: "inset(0 0% 0 0 round 10px)",
        transitionDuration: "140ms",
      };
  const listeningGhostStyle = {
    opacity: isTranscriptEntranceActive ? 0 : 0.88,
    filter: isTranscriptEntranceActive ? "blur(6px)" : "blur(0px)",
    transform: isTranscriptEntranceActive
      ? "translate3d(0, -5px, 0) scale(0.985)"
      : "translate3d(0, 0, 0) scale(1)",
    transitionDuration: `${LIVE_PREVIEW_GHOST_EXIT_DURATION_MS}ms`,
  };
  const livePreviewTextStyle = {
    transform: `translate3d(${livePreviewOffsetPx}px, 0, 0)`,
    opacity: showTranscriptPreview ? 1 : 0.84,
    transitionDuration: `${showTranscriptPreview ? LIVE_PREVIEW_SCROLL_DURATION_MS : 140}ms`,
  };

  return (
    <button
      ref={buttonRef}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onFocus={onFocus}
      onBlur={onBlur}
      className="relative max-w-[calc(100vw-2rem)] overflow-hidden text-left outline-none transition-[width,height,border-radius,box-shadow,transform] duration-[260ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
      style={{
        width: `${layout.widthPx}px`,
        height: `${layout.heightPx}px`,
        borderRadius: `${layout.borderRadiusPx}px`,
        background:
          "linear-gradient(180deg, rgba(255,255,255,0.9) 0%, rgba(250,247,245,0.94) 100%)",
        border: `1px solid ${borderColor}`,
        boxShadow:
          isRecording || isProcessing
            ? `0 14px 28px rgba(15, 23, 42, 0.16), 0 5px 12px rgba(15, 23, 42, 0.09), 0 0 0 1px rgba(255,255,255,0.78) inset, 0 0 14px ${glowColor}`
            : "0 10px 22px rgba(15, 23, 42, 0.12), 0 4px 8px rgba(15, 23, 42, 0.07), 0 0 0 1px rgba(255,255,255,0.78) inset",
        transform: isDragging ? "scale(1.01)" : isHovered ? "translateY(-1px)" : "translateY(0)",
        cursor: isDragging ? "grabbing" : "pointer",
        transitionDuration: `${DICTATION_CAPSULE_MORPH_DURATION_MS}ms`,
      }}
    >
      <div className="pointer-events-none absolute inset-x-4 bottom-0 h-6 rounded-t-full bg-[radial-gradient(circle_at_50%_0%,rgba(0,0,0,0.18),transparent_68%)] opacity-35 blur-xl" />

      <div className="relative h-full w-full">
        {liveShellActive && (
          <div className="pointer-events-none absolute inset-0 flex flex-col px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <div className="origin-left scale-[0.82]">
                  <AssistantGlyph />
                </div>
                <div className="truncate text-[12px] font-semibold tracking-[-0.03em] text-[rgba(22,22,22,0.96)]">
                  {brandLabel}
                </div>
              </div>

              <div className="flex shrink-0 items-center justify-end">
                <BrandGlyph />
              </div>
            </div>

            <div className="mt-1.5 px-2.5 py-1.5">
              <div
                ref={livePreviewViewportRef}
                className="relative overflow-hidden"
                style={livePreviewViewportStyle}
              >
                {showListeningGhost && (
                  <div
                    className="pointer-events-none absolute inset-0 whitespace-nowrap text-[13px] font-medium leading-[1.38] text-[rgba(96,96,96,0.82)] transition-[opacity,transform,filter] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
                    style={listeningGhostStyle}
                  >
                    {listeningGhostLabel}
                  </div>
                )}

                <div
                  className="transition-[transform,opacity,clip-path,filter] ease-[cubic-bezier(0.19,1,0.22,1)] motion-reduce:transition-none"
                  style={transcriptEntranceStyle}
                >
                  <div
                    ref={livePreviewTextRef}
                    className="whitespace-nowrap text-[13px] font-medium leading-[1.38] text-[rgba(72,72,72,0.92)] transition-[transform,opacity,color] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
                    style={livePreviewTextStyle}
                  >
                    {liveTrackText}
                  </div>
                </div>
              </div>
            </div>

            <div className="relative mt-auto flex h-3 items-center justify-between gap-[3px] px-0.5">
              {dots.map((value, index) => {
                const waveformAmplitude = Math.max(0, value - 0.04);
                const scaleY = 1 + waveformAmplitude * 7.2;
                const scaleX = 1 + waveformAmplitude * 0.3;

                return (
                  <span
                    key={index}
                    className="block shrink-0 rounded-full"
                    style={{
                      width: "7px",
                      height: "3px",
                      opacity: 0.92,
                      transform: `scaleX(${scaleX}) scaleY(${scaleY})`,
                      transformOrigin: "center",
                      background: "rgba(53, 53, 53, 0.96)",
                      boxShadow: "0 0 8px rgba(255,255,255,0.12) inset",
                      transition:
                        "transform 90ms ease-out, opacity 90ms ease-out, background-color 150ms ease",
                    }}
                  />
                );
              })}
            </div>
          </div>
        )}

        {recordingLayerVisible && (
          <div
            className="pointer-events-none absolute left-1/2 top-1/2 flex flex-col justify-center px-3 py-2.5 transition-[opacity,transform,filter] duration-140 ease-out motion-reduce:transition-none"
            style={{
              width: `${recordingLayout.widthPx}px`,
              minHeight: `${recordingLayout.heightPx}px`,
              opacity: recordingContentOpacity,
              transform: recordingContentTransform,
              filter: visualState.showRecordingContent ? "blur(0px)" : "blur(3px)",
            }}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <AssistantGlyph />
                <div className="min-w-0">
                  <div className="truncate text-[12px] font-semibold tracking-[-0.03em] text-[rgba(22,22,22,0.96)]">
                    {brandLabel}
                  </div>
                  <div className="truncate text-[10px] font-medium text-[rgba(92,92,92,0.72)]">
                    {helperText}
                  </div>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                <BrandGlyph />
                <div className="text-[11px] font-semibold tracking-[-0.03em] text-[rgba(116,116,116,0.82)]">
                  {brandLabel}
                </div>
              </div>
            </div>

            <div className="relative mt-2.5 flex h-3 items-center justify-between gap-[3px] px-0.5">
              {dots.map((value, index) => {
                const waveformAmplitude = Math.max(0, value - 0.04);
                const scaleY = 1 + waveformAmplitude * 7.2;
                const scaleX = 1 + waveformAmplitude * 0.3;
                const activeColor =
                  isRecording || isProcessing ? "rgba(53, 53, 53, 0.96)" : "rgba(58, 58, 58, 0.88)";

                return (
                  <span
                    key={index}
                    className="block shrink-0 rounded-full"
                    style={{
                      width: "7px",
                      height: "3px",
                      opacity: isRecording ? 0.92 : 0.86,
                      transform: `scaleX(${scaleX}) scaleY(${scaleY})`,
                      transformOrigin: "center",
                      background: activeColor,
                      boxShadow:
                        isRecording || isProcessing
                          ? "0 0 8px rgba(255,255,255,0.12) inset"
                          : "0 1px 2px rgba(255,255,255,0.08) inset",
                      transition:
                        "transform 90ms ease-out, opacity 90ms ease-out, background-color 150ms ease",
                    }}
                  />
                );
              })}
            </div>
          </div>
        )}

        {morphLayerVisible && (
          <div
            className="pointer-events-none absolute inset-0 flex items-center justify-center transition-[opacity,transform,filter] duration-160 ease-out motion-reduce:transition-none"
            style={{
              opacity: morphContentOpacity,
              transform: morphContentTransform,
              filter: visualState.showMorphIndicator ? "blur(0px)" : "blur(2px)",
            }}
          >
            <MorphBridge />
          </div>
        )}

        {compactLayerVisible && (
          <div
            className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 px-3 py-2 transition-[opacity,transform,filter] duration-180 ease-out motion-reduce:transition-none"
            style={{
              opacity: transcribingContentOpacity,
              transform: transcribingContentTransform,
              filter: visualState.showCompactContent ? "blur(0px)" : "blur(3px)",
            }}
          >
            <LoadingSpinner />
            <div className="text-[12px] font-medium text-[rgba(80,80,80,0.9)]">
              {secondaryLabel}
            </div>
          </div>
        )}
      </div>
    </button>
  );
}
