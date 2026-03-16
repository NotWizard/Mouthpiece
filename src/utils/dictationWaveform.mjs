const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

export function normalizeAudioLevel(rawLevel) {
  const clamped = clamp01(rawLevel * 6.5);
  if (clamped <= 0) return 0;
  return clamp01(Math.pow(clamped, 0.72));
}

export function buildWaveformDots({ count = 28, level = 0, phase = 0, active = false } = {}) {
  const safeCount = Math.max(1, Math.floor(count));
  const energy = active ? normalizeAudioLevel(level) : 0;
  const baseline = active ? 0.2 : 0.12;
  const swing = 0.18 + energy * 0.72;
  const centerBias = 0.22 + energy * 0.26;

  return Array.from({ length: safeCount }, (_, index) => {
    const position = safeCount === 1 ? 0 : index / (safeCount - 1);
    const centerDistance = Math.abs(position - 0.5) * 2;
    const envelope = 1 - Math.pow(centerDistance, 1.35);
    const ripple = Math.sin(index * 0.64 + phase * 4.4) * 0.5 + 0.5;
    const value = baseline + envelope * centerBias + ripple * swing * (0.35 + envelope * 0.65);
    return clamp01(value);
  });
}
