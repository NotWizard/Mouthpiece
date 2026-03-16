const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const WAVEFORM_ACTIVITY_THRESHOLD = 0.07;
const WAVEFORM_FLOOR = 0.04;

function createFlatDots(count, value = WAVEFORM_FLOOR) {
  return Array.from({ length: count }, () => clamp01(value));
}

function interpolateSamples(samples, position) {
  if (samples.length === 0) return 0;
  if (samples.length === 1) return samples[0];

  const clampedPosition = Math.max(0, Math.min(samples.length - 1, position));
  const leftIndex = Math.floor(clampedPosition);
  const rightIndex = Math.min(samples.length - 1, Math.ceil(clampedPosition));

  if (leftIndex === rightIndex) {
    return samples[leftIndex];
  }

  const mix = clampedPosition - leftIndex;
  return samples[leftIndex] * (1 - mix) + samples[rightIndex] * mix;
}

function buildHistoryWaveformDots({ count, samples }) {
  const normalizedSamples = samples.map((sample) => getWaveformActivityLevel(sample));

  if (normalizedSamples.every((sample) => sample === 0)) {
    return createFlatDots(count);
  }

  return Array.from({ length: count }, (_, index) => {
    const position = count === 1 ? 0 : index / (count - 1);
    const samplePosition = position * (normalizedSamples.length - 1);
    const center = interpolateSamples(normalizedSamples, samplePosition);
    const previous = interpolateSamples(normalizedSamples, Math.max(0, samplePosition - 0.8));
    const next = interpolateSamples(
      normalizedSamples,
      Math.min(normalizedSamples.length - 1, samplePosition + 0.8)
    );
    const smoothed = center * 0.62 + previous * 0.24 + next * 0.14;
    const freshness = 0.82 + position * 0.18;

    return clamp01(WAVEFORM_FLOOR + smoothed * freshness * 0.5);
  });
}

export function normalizeAudioLevel(rawLevel) {
  const clamped = clamp01(rawLevel * 6.5);
  if (clamped <= 0) return 0;
  return clamp01(Math.pow(clamped, 0.72));
}

export function getWaveformActivityLevel(level) {
  const clamped = clamp01(level);
  if (clamped <= WAVEFORM_ACTIVITY_THRESHOLD) {
    return 0;
  }

  const normalized = (clamped - WAVEFORM_ACTIVITY_THRESHOLD) / (1 - WAVEFORM_ACTIVITY_THRESHOLD);
  return clamp01(Math.pow(normalized, 0.72) * 1.22);
}

export function buildWaveformDots({
  count = 28,
  level = 0,
  phase = 0,
  active = false,
  samples = [],
} = {}) {
  const safeCount = Math.max(1, Math.floor(count));

  if (active && Array.isArray(samples) && samples.length > 0) {
    return buildHistoryWaveformDots({ count: safeCount, samples });
  }

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
