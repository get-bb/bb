import { describe, expect, it } from "vitest";
import {
  buildWaveformPath,
  idleWaveformBars,
  meteringToAmplitude,
  pushWaveformBar,
  trimWaveformBars,
  WAVEFORM_BAR_PITCH,
  waveformBarCount,
} from "./voice-waveform-model";

describe("meteringToAmplitude", () => {
  it("maps silence, missing metering, and the -160 floor to 0", () => {
    expect(meteringToAmplitude(undefined)).toBe(0);
    expect(meteringToAmplitude(null)).toBe(0);
    expect(meteringToAmplitude(-160)).toBe(0);
    expect(meteringToAmplitude(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(meteringToAmplitude(Number.NaN)).toBe(0);
  });

  it("keeps room noise below the floor and clamps loud input to 1", () => {
    // -50 dBFS ≈ 0.003 linear: under the web noise floor (0.006).
    expect(meteringToAmplitude(-50)).toBe(0);
    expect(meteringToAmplitude(0)).toBe(1);
    expect(meteringToAmplitude(5)).toBe(1);
  });

  it("is monotonic through the speaking range", () => {
    const quiet = meteringToAmplitude(-40);
    const normal = meteringToAmplitude(-25);
    const loud = meteringToAmplitude(-10);
    expect(quiet).toBeGreaterThan(0);
    expect(normal).toBeGreaterThan(quiet);
    expect(loud).toBeGreaterThan(normal);
    expect(loud).toBeLessThanOrEqual(1);
  });
});

describe("waveform bar buffer", () => {
  it("fits one bar per pitch and at least one bar", () => {
    expect(waveformBarCount(0)).toBe(1);
    expect(waveformBarCount(WAVEFORM_BAR_PITCH * 10 + 3)).toBe(10);
  });

  it("scrolls: the newest sample is last and old bars fall off the front", () => {
    let bars = idleWaveformBars(3);
    bars = pushWaveformBar(bars, 0.5, 3);
    bars = pushWaveformBar(bars, 0.9, 3);
    expect(bars).toEqual([0.06, 0.5, 0.9]);
    bars = pushWaveformBar(bars, 0.2, 3);
    expect(bars).toEqual([0.5, 0.9, 0.2]);
  });

  it("keeps the newest bars when the view shrinks", () => {
    expect(trimWaveformBars([1, 2, 3, 4], 2)).toEqual([3, 4]);
    expect(trimWaveformBars([1, 2], 4)).toEqual([1, 2]);
  });
});

describe("buildWaveformPath", () => {
  it("draws the newest bar at the right edge, centered vertically", () => {
    // height 28 → maxHalf = (26.6 - 3) / 2 = 11.8; amplitude 1 → 2.2..25.8.
    expect(buildWaveformPath([0.5, 1], 100, 28)).toBe(
      "M98.5 2.2L98.5 25.8M93.5 8.1L93.5 19.9",
    );
  });

  it("skips bars that fall off the left edge", () => {
    const bars = Array.from({ length: 50 }, () => 1);
    const path = buildWaveformPath(bars, 20, 28);
    // 20px wide → bars at x 18.5, 13.5, 8.5, 3.5, -1.5 (still partly
    // visible); the 6th (-6.5) is fully off the edge and cut.
    expect(path.match(/M/g)?.length).toBe(5);
  });
});
