// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WaveformVisualizer } from "./WaveformVisualizer";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setupAudio(reducedMotion: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reducedMotion && query === "(prefers-reduced-motion: reduce)",
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  let sample = 128;
  const analysisTrack = { stop: vi.fn() };
  const recordingTrack = { clone: () => analysisTrack, stop: vi.fn() };
  class TestMediaStream {
    getAudioTracks() {
      return [recordingTrack];
    }
  }
  vi.stubGlobal("MediaStream", TestMediaStream);
  vi.stubGlobal(
    "AudioContext",
    class {
      state = "running";
      resume = vi.fn().mockResolvedValue(undefined);
      close = vi.fn().mockResolvedValue(undefined);
      createMediaStreamSource() {
        return { connect: vi.fn(), disconnect: vi.fn() };
      }
      createAnalyser() {
        return {
          fftSize: 1024,
          getByteTimeDomainData: (data: Uint8Array) => data.fill(sample),
          disconnect: vi.fn(),
        };
      }
    },
  );
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (frame: number) =>
    frames.delete(frame),
  );
  const moveTo = vi.fn();
  const lineTo = vi.fn();
  const context = {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo,
    lineTo,
    stroke: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(
    HTMLCanvasElement.prototype,
    "getBoundingClientRect",
  ).mockReturnValue(new DOMRect(0, 0, 100, 40));
  return {
    stream: new MediaStream(),
    recordingTrack,
    analysisTrack,
    frames,
    drawSample(value: number) {
      sample = value;
      moveTo.mockClear();
      lineTo.mockClear();
      act(() => {
        for (let iteration = 0; iteration < 2; iteration++) {
          const pending = [...frames.values()];
          frames.clear();
          for (const callback of pending) callback(0);
        }
      });
      return lineTo.mock.calls.map(
        ([, bottom], index) => bottom - moveTo.mock.calls[index][1],
      );
    },
  };
}

describe("WaveformVisualizer", () => {
  it.each([false, true])(
    "shows changing input levels with reduced motion %s without stopping the recording track",
    (reducedMotion) => {
      const audio = setupAudio(reducedMotion);
      const view = render(<WaveformVisualizer active stream={audio.stream} />);

      const quiet = audio.drawSample(128);
      const loud = audio.drawSample(160);
      expect(loud.length).toBeGreaterThan(0);
      expect(loud[0]).toBeGreaterThan(quiet[0]);

      const silent = audio.drawSample(128);
      expect(silent[0]).toBeLessThan(loud[0]);
      expect(silent[1]).toBe(loud[0]);

      view.unmount();
      expect(audio.frames.size).toBe(0);
      expect(audio.analysisTrack.stop).toHaveBeenCalledOnce();
      expect(audio.recordingTrack.stop).not.toHaveBeenCalled();
    },
  );

  it("keeps inactive input static", () => {
    const audio = setupAudio(false);
    render(<WaveformVisualizer active={false} stream={audio.stream} />);
    expect(audio.frames.size).toBe(0);
  });
});
