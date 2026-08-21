// Pure model for the recording waveform (port of the web
// `WaveformVisualizer` math): metering dB → bar amplitude, the scrolling bar
// buffer, and the SVG path for one frame. No react-native imports (vitest).

export const WAVEFORM_BAR_WIDTH = 3;
const WAVEFORM_BAR_GAP = 2;
export const WAVEFORM_BAR_PITCH = WAVEFORM_BAR_WIDTH + WAVEFORM_BAR_GAP;
/** Web samples every second animation frame (~30 Hz). */
export const WAVEFORM_SAMPLE_INTERVAL_MS = 33;
/** Fraction of the width over which the oldest bars fade out. */
export const WAVEFORM_EDGE_FADE_FRACTION = 0.15;

const NOISE_FLOOR = 0.006;
const AMPLITUDE_GAIN = 8;
const AMPLITUDE_GAMMA = 0.6;
const IDLE_AMPLITUDE = 0.06;
/** Below this the recorder reports silence (iOS floor is -160 dBFS). */
const SILENCE_DB = -160;

/**
 * expo-audio metering (average power in dBFS, `-160..0`) → the bar amplitude
 * in `0..1`. The dB value is converted back to a linear RMS, then boosted and
 * gamma-compressed exactly like the web's time-domain RMS so a speaking voice
 * fills most of the bar and room noise stays at the floor.
 */
export function meteringToAmplitude(
  meteringDb: number | null | undefined,
): number {
  if (meteringDb === null || meteringDb === undefined) return 0;
  if (!Number.isFinite(meteringDb) || meteringDb <= SILENCE_DB) return 0;
  const rms = 10 ** (Math.min(0, meteringDb) / 20);
  const boosted = Math.max(0, rms - NOISE_FLOOR) * AMPLITUDE_GAIN;
  return Math.min(1, boosted ** AMPLITUDE_GAMMA);
}

/** How many bars fit in `width` (at least one). */
export function waveformBarCount(width: number): number {
  return Math.max(1, Math.floor(width / WAVEFORM_BAR_PITCH));
}

/** The resting waveform: every bar at the idle amplitude. */
export function idleWaveformBars(barCount: number): number[] {
  return Array.from({ length: barCount }, () => IDLE_AMPLITUDE);
}

/**
 * Appends one sample; the newest bar sits at the right edge and the buffer
 * never holds more than `barCount` bars. Returns a new array.
 */
export function pushWaveformBar(
  bars: readonly number[],
  amplitude: number,
  barCount: number,
): number[] {
  const next = [...bars, amplitude];
  return next.length > barCount ? next.slice(next.length - barCount) : next;
}

/** Drops the oldest bars when the view shrinks; keeps the newest ones. */
export function trimWaveformBars(
  bars: readonly number[],
  barCount: number,
): number[] {
  return bars.length > barCount
    ? bars.slice(bars.length - barCount)
    : [...bars];
}

/**
 * One SVG path (`M x y1 L x y2` per bar) for the bars, newest at the right
 * edge. Each bar is centered vertically with a height of `amplitude × 95 %`
 * of the box, minus the round caps. Bars that fall off the left edge are
 * skipped.
 */
export function buildWaveformPath(
  bars: readonly number[],
  width: number,
  height: number,
): string {
  const midY = height / 2;
  const maxHalf = Math.max(0, (height * 0.95 - WAVEFORM_BAR_WIDTH) / 2);
  const segments: string[] = [];
  for (let i = 0; i < bars.length; i++) {
    const amplitude = bars[bars.length - 1 - i] ?? 0;
    const cx = width - WAVEFORM_BAR_WIDTH / 2 - i * WAVEFORM_BAR_PITCH;
    if (cx + WAVEFORM_BAR_WIDTH < 0) break;
    const half = amplitude * maxHalf;
    const x = round(cx);
    segments.push(`M${x} ${round(midY - half)}L${x} ${round(midY + half)}`);
  }
  return segments.join("");
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
