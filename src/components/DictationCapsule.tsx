import { useEffect, useState, type MouseEvent, type RefObject } from "react";
import { buildWaveformDots } from "../utils/dictationWaveform.mjs";
import { DICTATION_CAPSULE_WIDTH_PX } from "../utils/dictationOverlayState.mjs";

const WAVEFORM_DOT_COUNT = 29;

function createSilentSamples() {
  return Array.from({ length: WAVEFORM_DOT_COUNT }, () => 0);
}

interface DictationCapsuleProps {
  agentName: string;
  brandLabel: string;
  secondaryLabel: string;
  hotkeyLabel: string;
  audioLevel: number;
  isHovered: boolean;
  isRecording: boolean;
  isProcessing: boolean;
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

export default function DictationCapsule({
  agentName,
  brandLabel,
  secondaryLabel,
  hotkeyLabel,
  audioLevel,
  isHovered,
  isRecording,
  isProcessing,
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
  const [sampleHistory, setSampleHistory] = useState<number[]>(() => createSilentSamples());

  useEffect(() => {
    if (!isRecording) {
      setSampleHistory(createSilentSamples());
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
  }, [audioLevel, isRecording]);

  const dots = buildWaveformDots({
    count: WAVEFORM_DOT_COUNT,
    samples: sampleHistory,
    active: isRecording,
  });

  const helperText = isRecording || isProcessing ? secondaryLabel : hotkeyLabel;
  const glowColor = isRecording ? "rgba(255, 132, 132, 0.48)" : "rgba(244, 166, 89, 0.26)";
  const borderColor =
    isRecording || isProcessing ? "rgba(255, 157, 157, 0.72)" : "rgba(201, 201, 201, 0.92)";

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
      className="relative max-w-[calc(100vw-2rem)] overflow-hidden rounded-[22px] px-3 py-2.5 text-left outline-none transition-transform duration-200 ease-out"
      style={{
        width: `${DICTATION_CAPSULE_WIDTH_PX}px`,
        background:
          "linear-gradient(180deg, rgba(255,255,255,0.9) 0%, rgba(250,247,245,0.94) 100%)",
        border: `1px solid ${borderColor}`,
        boxShadow:
          isRecording || isProcessing
            ? `0 14px 28px rgba(15, 23, 42, 0.16), 0 5px 12px rgba(15, 23, 42, 0.09), 0 0 0 1px rgba(255,255,255,0.78) inset, 0 0 14px ${glowColor}`
            : "0 10px 22px rgba(15, 23, 42, 0.12), 0 4px 8px rgba(15, 23, 42, 0.07), 0 0 0 1px rgba(255,255,255,0.78) inset",
        transform: isDragging ? "scale(1.01)" : isHovered ? "translateY(-1px)" : "translateY(0)",
        cursor: isDragging ? "grabbing" : "pointer",
      }}
    >
      <div className="pointer-events-none absolute inset-x-4 bottom-0 h-6 rounded-t-full bg-[radial-gradient(circle_at_50%_0%,rgba(0,0,0,0.18),transparent_68%)] opacity-35 blur-xl" />

      <div className="relative flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <AssistantGlyph />
          <div className="min-w-0">
            <div className="truncate text-[12px] font-semibold tracking-[-0.03em] text-[rgba(22,22,22,0.96)]">
              {agentName}
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
    </button>
  );
}
