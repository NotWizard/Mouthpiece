import logger from "./logger";
import { getSettings } from "../stores/settingsStore";
import { getPresetById } from "./soundPresets";

let audioContext = null;

const getAudioContext = () => {
  if (typeof window === "undefined") {
    return null;
  }

  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) {
    return null;
  }

  if (!audioContext || audioContext.state === "closed") {
    audioContext = new AudioContextCtor();
  }

  return audioContext;
};

export const resumeContextIfNeeded = async () => {
  try {
    const context = getAudioContext();
    if (!context) {
      return null;
    }

    if (context.state === "suspended") {
      await context.resume();
    }

    return context.state === "running" ? context : null;
  } catch (error) {
    logger.debug(
      "Failed to initialize dictation cue audio context",
      { error: error instanceof Error ? error.message : String(error) },
      "audio"
    );
    return null;
  }
};

const isEnabled = () => getSettings().audioCuesEnabled;

const playCue = async (type) => {
  try {
    if (!isEnabled()) return;

    const context = await resumeContextIfNeeded();
    if (!context) return;

    const preset = getPresetById(getSettings().soundPreset);
    const baseTime = context.currentTime + 0.005;
    if (type === "start") {
      preset.playStart(context, baseTime);
    } else {
      preset.playStop(context, baseTime);
    }
  } catch (error) {
    logger.debug(
      "Failed to play dictation cue",
      { error: error instanceof Error ? error.message : String(error) },
      "audio"
    );
  }
};

export const playStartCue = () => playCue("start");

export const playStopCue = () => playCue("stop");

export const playPresetPreview = async (type, presetId) => {
  try {
    const context = await resumeContextIfNeeded();
    if (!context) return;

    const preset = getPresetById(presetId || getSettings().soundPreset);
    const baseTime = context.currentTime + 0.005;
    if (type === "start") {
      preset.playStart(context, baseTime);
    } else {
      preset.playStop(context, baseTime);
    }
  } catch (error) {
    logger.debug(
      "Failed to play preset preview",
      { error: error instanceof Error ? error.message : String(error) },
      "audio"
    );
  }
};
