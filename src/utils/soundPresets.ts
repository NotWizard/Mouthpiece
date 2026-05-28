export interface SoundPreset {
  id: string;
  labelKey: string;
  icon: string;
  playStart: (ctx: AudioContext, t: number) => void;
  playStop: (ctx: AudioContext, t: number) => void;
}

function tone(
  ctx: AudioContext,
  freq: number,
  start: number,
  dur: number,
  wave: OscillatorType,
  gain: number,
  attack: number,
) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = wave;
  osc.frequency.setValueAtTime(freq, start);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.linearRampToValueAtTime(gain, start + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g);
  g.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + dur + 0.01);
}

function sweep(
  ctx: AudioContext,
  f1: number,
  f2: number,
  start: number,
  dur: number,
  wave: OscillatorType,
  gain: number,
  attack: number,
) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = wave;
  osc.frequency.setValueAtTime(f1, start);
  osc.frequency.exponentialRampToValueAtTime(f2, start + dur * 0.8);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.linearRampToValueAtTime(gain, start + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g);
  g.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + dur + 0.01);
}

function noiseBurst(ctx: AudioContext, start: number, dur: number, gain: number) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * gain;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, start);
  g.gain.exponentialRampToValueAtTime(0.001, start + dur);
  src.connect(g);
  g.connect(ctx.destination);
  src.start(start);
}

function glide(
  ctx: AudioContext,
  freqs: [number, number] | [number, number, number],
  times: [number] | [number, number],
  start: number,
  totalDur: number,
  gain: number,
) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freqs[0], start);
  osc.frequency.linearRampToValueAtTime(freqs[1], start + times[0]);
  if (freqs[2] !== undefined && times[1] !== undefined) {
    osc.frequency.linearRampToValueAtTime(freqs[2], start + times[1]);
  }
  g.gain.setValueAtTime(0.001, start);
  g.gain.linearRampToValueAtTime(gain, start + 0.02);
  g.gain.setValueAtTime(gain, start + totalDur * 0.6);
  g.gain.exponentialRampToValueAtTime(0.001, start + totalDur);
  osc.connect(g);
  g.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + totalDur + 0.01);
}

export const SOUND_PRESETS: SoundPreset[] = [
  {
    id: "classic",
    labelKey: "settingsPage.general.soundEffects.presets.classic",
    icon: "🎵",
    playStart(ctx, t) {
      tone(ctx, 523.25, t, 0.09, "sine", 0.2, 0.015);
      tone(ctx, 659.25, t + 0.115, 0.09, "sine", 0.2, 0.015);
    },
    playStop(ctx, t) {
      tone(ctx, 587.33, t, 0.09, "sine", 0.2, 0.015);
      tone(ctx, 440, t + 0.115, 0.09, "sine", 0.2, 0.015);
    },
  },
  {
    id: "retro",
    labelKey: "settingsPage.general.soundEffects.presets.retro",
    icon: "👾",
    playStart(ctx, t) {
      tone(ctx, 523, t, 0.06, "square", 0.12, 0.005);
      tone(ctx, 659, t + 0.07, 0.06, "square", 0.12, 0.005);
      tone(ctx, 784, t + 0.14, 0.08, "square", 0.14, 0.005);
    },
    playStop(ctx, t) {
      tone(ctx, 784, t, 0.06, "square", 0.12, 0.005);
      tone(ctx, 659, t + 0.07, 0.06, "square", 0.12, 0.005);
      tone(ctx, 523, t + 0.14, 0.08, "square", 0.1, 0.005);
    },
  },
  {
    id: "bubble",
    labelKey: "settingsPage.general.soundEffects.presets.bubble",
    icon: "🫧",
    playStart(ctx, t) {
      sweep(ctx, 300, 900, t, 0.15, "sine", 0.2, 0.01);
      sweep(ctx, 400, 1100, t + 0.12, 0.12, "sine", 0.13, 0.01);
    },
    playStop(ctx, t) {
      sweep(ctx, 800, 250, t, 0.18, "sine", 0.2, 0.01);
    },
  },
  {
    id: "scifi",
    labelKey: "settingsPage.general.soundEffects.presets.scifi",
    icon: "🛸",
    playStart(ctx, t) {
      sweep(ctx, 200, 1200, t, 0.25, "sawtooth", 0.08, 0.01);
      sweep(ctx, 600, 1800, t + 0.05, 0.2, "sine", 0.06, 0.01);
    },
    playStop(ctx, t) {
      sweep(ctx, 1000, 200, t, 0.3, "sawtooth", 0.08, 0.01);
      sweep(ctx, 1400, 400, t + 0.05, 0.25, "sine", 0.05, 0.01);
    },
  },
  {
    id: "marimba",
    labelKey: "settingsPage.general.soundEffects.presets.marimba",
    icon: "🪘",
    playStart(ctx, t) {
      tone(ctx, 523, t, 0.12, "triangle", 0.25, 0.003);
      tone(ctx, 659, t + 0.1, 0.12, "triangle", 0.25, 0.003);
    },
    playStop(ctx, t) {
      tone(ctx, 659, t, 0.12, "triangle", 0.25, 0.003);
      tone(ctx, 523, t + 0.1, 0.15, "triangle", 0.2, 0.003);
    },
  },
  {
    id: "playful",
    labelKey: "settingsPage.general.soundEffects.presets.playful",
    icon: "🤪",
    playStart(ctx, t) {
      tone(ctx, 392, t, 0.06, "triangle", 0.18, 0.005);
      tone(ctx, 523, t + 0.065, 0.06, "sine", 0.18, 0.005);
      tone(ctx, 659, t + 0.13, 0.06, "triangle", 0.18, 0.005);
      tone(ctx, 880, t + 0.195, 0.1, "sine", 0.2, 0.005);
    },
    playStop(ctx, t) {
      tone(ctx, 880, t, 0.07, "sine", 0.18, 0.005);
      tone(ctx, 587, t + 0.08, 0.07, "triangle", 0.16, 0.005);
      tone(ctx, 392, t + 0.16, 0.12, "sine", 0.14, 0.005);
    },
  },
  {
    id: "robot",
    labelKey: "settingsPage.general.soundEffects.presets.robot",
    icon: "🤖",
    playStart(ctx, t) {
      tone(ctx, 800, t, 0.04, "square", 0.1, 0.003);
      tone(ctx, 1000, t + 0.06, 0.04, "square", 0.1, 0.003);
      tone(ctx, 800, t + 0.12, 0.04, "square", 0.1, 0.003);
      tone(ctx, 1200, t + 0.18, 0.06, "square", 0.12, 0.003);
    },
    playStop(ctx, t) {
      tone(ctx, 1200, t, 0.05, "square", 0.1, 0.003);
      tone(ctx, 600, t + 0.07, 0.05, "square", 0.1, 0.003);
      tone(ctx, 300, t + 0.14, 0.1, "square", 0.08, 0.003);
    },
  },
  {
    id: "gentle",
    labelKey: "settingsPage.general.soundEffects.presets.gentle",
    icon: "🔔",
    playStart(ctx, t) {
      tone(ctx, 440, t, 0.25, "sine", 0.15, 0.04);
      tone(ctx, 659, t + 0.18, 0.25, "sine", 0.15, 0.04);
    },
    playStop(ctx, t) {
      tone(ctx, 659, t, 0.25, "sine", 0.15, 0.04);
      tone(ctx, 440, t + 0.18, 0.3, "sine", 0.12, 0.04);
    },
  },
  {
    id: "typewriter",
    labelKey: "settingsPage.general.soundEffects.presets.typewriter",
    icon: "⌨️",
    playStart(ctx, t) {
      noiseBurst(ctx, t, 0.03, 0.3);
      noiseBurst(ctx, t + 0.06, 0.025, 0.25);
    },
    playStop(ctx, t) {
      noiseBurst(ctx, t, 0.04, 0.35);
    },
  },
  {
    id: "coin",
    labelKey: "settingsPage.general.soundEffects.presets.coin",
    icon: "🪙",
    playStart(ctx, t) {
      tone(ctx, 988, t, 0.06, "square", 0.1, 0.003);
      tone(ctx, 1319, t + 0.06, 0.15, "square", 0.1, 0.003);
    },
    playStop(ctx, t) {
      tone(ctx, 1319, t, 0.06, "square", 0.1, 0.003);
      tone(ctx, 494, t + 0.07, 0.15, "square", 0.08, 0.003);
    },
  },
  {
    id: "laser",
    labelKey: "settingsPage.general.soundEffects.presets.laser",
    icon: "⚡",
    playStart(ctx, t) {
      sweep(ctx, 2000, 200, t, 0.12, "sawtooth", 0.08, 0.003);
      sweep(ctx, 1800, 400, t + 0.1, 0.1, "square", 0.06, 0.003);
    },
    playStop(ctx, t) {
      sweep(ctx, 200, 2000, t, 0.15, "sawtooth", 0.07, 0.003);
    },
  },
  {
    id: "whistle",
    labelKey: "settingsPage.general.soundEffects.presets.whistle",
    icon: "🎶",
    playStart(ctx, t) {
      glide(ctx, [600, 1000, 800], [0.1, 0.2], t, 0.25, 0.18);
    },
    playStop(ctx, t) {
      glide(ctx, [800, 500], [0.15], t, 0.2, 0.15);
    },
  },
];

export function getPresetById(id: string): SoundPreset {
  return SOUND_PRESETS.find((p) => p.id === id) ?? SOUND_PRESETS[0];
}
