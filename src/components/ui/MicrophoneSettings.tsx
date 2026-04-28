import React, { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";
import { Button } from "./button";
import { ErrorNotice } from "./ErrorNotice";
import { RefreshCw } from "lucide-react";
import { isBuiltInMicrophone } from "../../utils/audioDeviceUtils";

interface AudioDevice {
  deviceId: string;
  label: string;
  isBuiltIn: boolean;
}

interface MicrophoneSettingsProps {
  selectedMicDeviceId: string;
  onDeviceSelect: (deviceId: string) => void;
}

type InputEnvironmentState = "idle" | "quiet" | "normal" | "noisy";
type InputAdviceState = "idle" | "tooQuiet" | "moveCloser" | "good" | "tooNoisy";

const INPUT_ANALYSIS_FFT_SIZE = 1024;
const QUIET_NOISE_FLOOR_THRESHOLD = 0.025;
const NOISY_NOISE_FLOOR_THRESHOLD = 0.07;
const LOW_INPUT_LEVEL_THRESHOLD = 0.03;
const GOOD_INPUT_LEVEL_THRESHOLD = 0.12;
const INPUT_STATUS_UPDATE_INTERVAL_MS = 650;
const MIC_TEST_STATUS_CARD_CLASS = "min-h-[72px] rounded-md bg-muted/40 p-2 dark:bg-surface-1/60";
const MIC_TEST_DYNAMIC_TEXT_CLASS = "mt-1 min-h-[2rem] text-xs leading-snug text-muted-foreground";

function getRmsLevel(data: Uint8Array<ArrayBuffer>) {
  let sum = 0;

  for (const value of data) {
    const normalized = (value - 128) / 128;
    sum += normalized * normalized;
  }

  return Math.min(1, Math.sqrt(sum / data.length));
}

function toDisplayPercent(value: number) {
  return Math.min(100, Math.round(value * 320));
}

function getEnvironmentState(noiseFloor: number): InputEnvironmentState {
  if (noiseFloor === 0) return "idle";
  if (noiseFloor < QUIET_NOISE_FLOOR_THRESHOLD) return "quiet";
  if (noiseFloor > NOISY_NOISE_FLOOR_THRESHOLD) return "noisy";
  return "normal";
}

function getInputAdviceState(rms: number, noiseFloor: number): InputAdviceState {
  if (noiseFloor > NOISY_NOISE_FLOOR_THRESHOLD) return "tooNoisy";
  if (rms < LOW_INPUT_LEVEL_THRESHOLD) return "tooQuiet";
  if (rms < Math.max(GOOD_INPUT_LEVEL_THRESHOLD, noiseFloor * 2.4)) return "moveCloser";
  return "good";
}

export const MicrophoneSettings: React.FC<MicrophoneSettingsProps> = ({
  selectedMicDeviceId,
  onDeviceSelect,
}) => {
  const { t } = useTranslation();
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isInputTestRunning, setIsInputTestRunning] = useState(false);
  const [inputTestError, setInputTestError] = useState<string | null>(null);
  const [inputLevel, setInputLevel] = useState(0);
  const [noiseFloor, setNoiseFloor] = useState(0);
  const [environmentState, setEnvironmentState] = useState<InputEnvironmentState>("idle");
  const [inputAdvice, setInputAdvice] = useState<InputAdviceState>("idle");

  // Use refs to access current values without triggering re-renders
  const inputTestStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const analysisBufferRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const noiseFloorRef = useRef(0);
  const environmentStateRef = useRef<InputEnvironmentState>("idle");
  const inputAdviceRef = useRef<InputAdviceState>("idle");
  const lastInputStatusUpdateRef = useRef(0);

  const loadDevices = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Request permission first to get device labels
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());

      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = allDevices
        .filter((d) => d.kind === "audioinput")
        .map((d) => ({
          deviceId: d.deviceId,
          label:
            d.label ||
            t("microphoneSettings.fallbackDeviceName", {
              id: d.deviceId.slice(0, 8),
            }),
          isBuiltIn: isBuiltInMicrophone(d.label),
        }));

      setDevices(audioInputs);
    } catch {
      setError(t("microphoneSettings.errors.unableToAccess"));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadDevices();

    const handleDeviceChange = () => loadDevices();
    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);

    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", handleDeviceChange);
    };
  }, [loadDevices]);

  const selectedDevice = devices.find((d) => d.deviceId === selectedMicDeviceId);

  const stopInputTest = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    sourceNodeRef.current?.disconnect();
    sourceNodeRef.current = null;
    analyserRef.current = null;
    analysisBufferRef.current = null;

    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => undefined);
      audioContextRef.current = null;
    }

    if (inputTestStreamRef.current) {
      inputTestStreamRef.current.getTracks().forEach((track) => track.stop());
      inputTestStreamRef.current = null;
    }

    noiseFloorRef.current = 0;
    environmentStateRef.current = "idle";
    inputAdviceRef.current = "idle";
    lastInputStatusUpdateRef.current = 0;
    setIsInputTestRunning(false);
    setInputLevel(0);
    setNoiseFloor(0);
    setEnvironmentState("idle");
    setInputAdvice("idle");
  }, []);

  const updateInputAnalysis = useCallback(() => {
    const analyser = analyserRef.current;
    const buffer = analysisBufferRef.current;

    if (!analyser || !buffer) {
      return;
    }

    analyser.getByteTimeDomainData(buffer);
    const rms = getRmsLevel(buffer);
    const currentNoiseFloor = noiseFloorRef.current;
    const nextNoiseFloor =
      currentNoiseFloor === 0
        ? rms
        : rms < currentNoiseFloor
          ? currentNoiseFloor * 0.75 + rms * 0.25
          : currentNoiseFloor * 0.96 + rms * 0.04;

    noiseFloorRef.current = nextNoiseFloor;
    setInputLevel(toDisplayPercent(rms));
    setNoiseFloor(toDisplayPercent(nextNoiseFloor));

    const now = performance.now();
    const nextEnvironmentState = getEnvironmentState(nextNoiseFloor);
    const nextInputAdvice = getInputAdviceState(rms, nextNoiseFloor);
    const shouldUpdateStatus =
      lastInputStatusUpdateRef.current === 0 ||
      now - lastInputStatusUpdateRef.current >= INPUT_STATUS_UPDATE_INTERVAL_MS;

    if (shouldUpdateStatus) {
      if (nextEnvironmentState !== environmentStateRef.current) {
        environmentStateRef.current = nextEnvironmentState;
        setEnvironmentState(nextEnvironmentState);
      }
      if (nextInputAdvice !== inputAdviceRef.current) {
        inputAdviceRef.current = nextInputAdvice;
        setInputAdvice(nextInputAdvice);
      }
      lastInputStatusUpdateRef.current = now;
    }

    animationFrameRef.current = requestAnimationFrame(updateInputAnalysis);
  }, []);

  const startInputTest = useCallback(async () => {
    stopInputTest();
    setInputTestError(null);

    try {
      const AudioContextConstructor =
        window.AudioContext ??
        (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

      if (!AudioContextConstructor) {
        throw new Error("AudioContext unavailable");
      }

      const audioConstraints: MediaTrackConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false,
        ...(selectedMicDeviceId ? { deviceId: { exact: selectedMicDeviceId } } : {}),
      };
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      const audioContext = new AudioContextConstructor();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();

      analyser.fftSize = INPUT_ANALYSIS_FFT_SIZE;
      analyser.smoothingTimeConstant = 0.72;
      source.connect(analyser);

      inputTestStreamRef.current = stream;
      audioContextRef.current = audioContext;
      sourceNodeRef.current = source;
      analyserRef.current = analyser;
      analysisBufferRef.current = new Uint8Array(analyser.fftSize);
      noiseFloorRef.current = 0;
      environmentStateRef.current = "idle";
      inputAdviceRef.current = "idle";
      lastInputStatusUpdateRef.current = 0;
      setIsInputTestRunning(true);
      animationFrameRef.current = requestAnimationFrame(updateInputAnalysis);
    } catch {
      setInputTestError(t("microphoneSettings.inputTest.errors.unableToStart"));
      stopInputTest();
    }
  }, [
    selectedMicDeviceId,
    stopInputTest,
    t,
    updateInputAnalysis,
  ]);

  useEffect(() => {
    return () => stopInputTest();
  }, [stopInputTest]);

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-foreground">
            {t("microphoneSettings.inputDevice")}
          </label>
          <Button
            variant="ghost"
            size="sm"
            onClick={loadDevices}
            disabled={isLoading}
            className="h-7 w-7 p-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {error ? (
          <ErrorNotice message={error} compact />
        ) : (
          <Select
            value={selectedMicDeviceId || "default"}
            onValueChange={(value) => onDeviceSelect(value === "default" ? "" : value)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t("microphoneSettings.selectPlaceholder")}>
                {selectedMicDeviceId
                  ? selectedDevice?.label || t("microphoneSettings.unknownDevice")
                  : t("microphoneSettings.systemDefault")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">{t("microphoneSettings.systemDefault")}</SelectItem>
              {devices.map((device) => (
                <SelectItem key={device.deviceId} value={device.deviceId}>
                  {device.label}
                  {device.isBuiltIn && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {t("microphoneSettings.builtIn")}
                    </span>
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <p className="text-xs text-muted-foreground">{t("microphoneSettings.helpText")}</p>
      </div>

      <div className="space-y-3 rounded-lg border border-border/50 bg-card/40 p-3 dark:border-border-subtle dark:bg-surface-2/40">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              {t("microphoneSettings.inputTest.title")}
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground/80">
              {t("microphoneSettings.inputTest.description")}
            </p>
          </div>
          <Button
            variant={isInputTestRunning ? "secondary" : "outline"}
            size="sm"
            onClick={isInputTestRunning ? stopInputTest : startInputTest}
          >
            {isInputTestRunning
              ? t("microphoneSettings.inputTest.stop")
              : t("microphoneSettings.inputTest.start")}
          </Button>
        </div>

        {inputTestError && <ErrorNotice message={inputTestError} compact />}

        <div className="grid gap-2 sm:grid-cols-3">
          <div className={MIC_TEST_STATUS_CARD_CLASS}>
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-foreground">
                {t("microphoneSettings.inputTest.volume")}
              </span>
              <span className="inline-block w-10 text-right text-xs tabular-nums text-muted-foreground">
                {inputLevel}%
              </span>
            </div>
            <div
              className="h-1.5 overflow-hidden rounded-full bg-muted dark:bg-surface-3"
              aria-label={t("microphoneSettings.inputTest.volume")}
            >
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-150"
                style={{ width: `${inputLevel}%` }}
              />
            </div>
          </div>

          <div className={MIC_TEST_STATUS_CARD_CLASS}>
            <p className="text-xs font-medium text-foreground">
              {t("microphoneSettings.inputTest.environment")}
            </p>
            <p className={MIC_TEST_DYNAMIC_TEXT_CLASS}>
              {t(`microphoneSettings.inputTest.environmentStates.${environmentState}`, {
                level: noiseFloor,
              })}
            </p>
          </div>

          <div className={MIC_TEST_STATUS_CARD_CLASS}>
            <p className="text-xs font-medium text-foreground">
              {t("microphoneSettings.inputTest.nearTalkAdvice")}
            </p>
            <p className={MIC_TEST_DYNAMIC_TEXT_CLASS}>
              {t(`microphoneSettings.inputTest.advice.${inputAdvice}`)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MicrophoneSettings;
