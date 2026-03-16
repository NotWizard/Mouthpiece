import { useEffect, useState, type MouseEvent, type RefObject } from "react";
import { buildWaveformDots } from "../utils/dictationWaveform.mjs";

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
    <div className="relative flex h-11 w-11 items-center justify-center overflow-hidden rounded-2xl border border-white/70 bg-white/85 shadow-[0_10px_22px_rgba(15,23,42,0.14)]">
      <div className="absolute inset-[5px] rounded-[14px] bg-[radial-gradient(circle_at_30%_25%,rgba(255,255,255,0.95),rgba(255,255,255,0.2)_45%,transparent_70%),linear-gradient(135deg,rgba(115,126,255,0.98),rgba(66,92,255,0.88))]" />
      <div className="relative flex items-center gap-1">
        <span className="block h-2.5 w-2.5 rounded-full bg-white/92 shadow-[0_0_10px_rgba(255,255,255,0.65)]" />
        <span className="block h-2.5 w-4 rounded-full bg-white/78 shadow-[0_0_10px_rgba(255,255,255,0.45)]" />
      </div>
    </div>
  );
}

function BrandGlyph() {
  return (
    <div className="flex items-center gap-1.5 text-[rgba(43,43,43,0.62)]">
      {[0.65, 1, 0.72].map((height, index) => (
        <span
          key={index}
          className="block w-[4px] rounded-full bg-current"
          style={{ height: `${Math.round(height * 16)}px` }}
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
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const isActive = isRecording || isProcessing || isHovered;
    const interval = window.setInterval(() => {
      setPhase((current) => {
        const speed = isRecording ? 0.28 + audioLevel * 0.42 : isProcessing ? 0.24 : 0.16;
        return current + speed;
      });
    }, isActive ? 46 : 70);

    return () => window.clearInterval(interval);
  }, [audioLevel, isHovered, isProcessing, isRecording]);

  const visualLevel = isRecording ? audioLevel : isProcessing ? 0.38 : isHovered ? 0.14 : 0.03;
  const dots = buildWaveformDots({
    count: 29,
    level: visualLevel,
    phase,
    active: isRecording || isProcessing || isHovered,
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
      className="relative w-[428px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-[30px] px-4 py-4 text-left outline-none transition-transform duration-200 ease-out"
      style={{
        background:
          "linear-gradient(180deg, rgba(255,255,255,0.9) 0%, rgba(250,247,245,0.94) 100%)",
        border: `1px solid ${borderColor}`,
        boxShadow:
          isRecording || isProcessing
            ? `0 22px 44px rgba(15, 23, 42, 0.18), 0 8px 18px rgba(15, 23, 42, 0.1), 0 0 0 1px rgba(255,255,255,0.78) inset, 0 0 22px ${glowColor}`
            : "0 18px 38px rgba(15, 23, 42, 0.14), 0 6px 14px rgba(15, 23, 42, 0.08), 0 0 0 1px rgba(255,255,255,0.78) inset",
        transform: isDragging ? "scale(1.01)" : isHovered ? "translateY(-1px)" : "translateY(0)",
        cursor: isDragging ? "grabbing" : "pointer",
      }}
    >
      <div className="pointer-events-none absolute inset-x-6 bottom-0 h-10 rounded-t-full bg-[radial-gradient(circle_at_50%_0%,rgba(0,0,0,0.18),transparent_68%)] opacity-40 blur-xl" />

      <div className="relative flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <AssistantGlyph />
          <div className="min-w-0">
            <div className="truncate text-[17px] font-semibold tracking-[-0.03em] text-[rgba(22,22,22,0.96)]">
              {agentName}
            </div>
            <div className="truncate text-[12px] font-medium text-[rgba(92,92,92,0.72)]">
              {helperText}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <BrandGlyph />
          <div className="text-[15px] font-semibold tracking-[-0.03em] text-[rgba(116,116,116,0.82)]">
            {brandLabel}
          </div>
        </div>
      </div>

      <div className="relative mt-4 flex items-end justify-between gap-[6px] px-1">
        {dots.map((value, index) => {
          const height = 8 + value * 10;
          const opacity = 0.55 + value * 0.4;
          const translateY = (1 - value) * 1.8;
          const activeColor =
            isRecording || isProcessing ? "rgba(53, 53, 53, 0.96)" : "rgba(58, 58, 58, 0.88)";

          return (
            <span
              key={index}
              className="block flex-1 rounded-full"
              style={{
                minWidth: "7px",
                height: `${height}px`,
                opacity,
                transform: `translateY(${translateY}px)`,
                background: activeColor,
                boxShadow:
                  isRecording || isProcessing
                    ? "0 0 8px rgba(255,255,255,0.12) inset"
                    : "0 1px 2px rgba(255,255,255,0.08) inset",
                transition:
                  "height 90ms ease-out, opacity 90ms ease-out, transform 90ms ease-out, background-color 150ms ease",
              }}
            />
          );
        })}
      </div>
    </button>
  );
}
