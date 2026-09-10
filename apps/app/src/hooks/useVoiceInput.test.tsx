// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVoiceInput } from "@/hooks/useVoiceInput";

vi.mock("@/components/ui/app-toast", () => ({
  appToast: {
    error: vi.fn(),
    success: vi.fn(),
    message: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}));

class MockMediaRecorder {
  static isTypeSupported = vi.fn(() => true);
  static instances: MockMediaRecorder[] = [];
  readonly mimeType: string;
  readonly options: MediaRecorderOptions | undefined;
  state = "inactive";
  onstart: (() => void) | null = null;
  onstop: (() => void | Promise<void>) | null = null;
  onerror: (() => void) | null = null;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;

  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    this.options = options;
    this.mimeType = options?.mimeType ?? "audio/webm";
    MockMediaRecorder.instances.push(this);
  }

  start(): void {
    this.state = "recording";
    this.onstart?.();
  }

  stop(): void {
    this.state = "inactive";
    this.ondataavailable?.({
      data: new Blob(["audio-bytes"], { type: this.mimeType }),
    });
    void this.onstop?.();
  }
}

let now = 0;

function defineNavigatorMediaDevices(): void {
  const stream = { getTracks: () => [] } as unknown as MediaStream;
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => stream) },
  });
}

beforeEach(() => {
  now = 0;
  MockMediaRecorder.instances = [];
  vi.spyOn(Date, "now").mockImplementation(() => now);
  vi.stubGlobal("MediaRecorder", MockMediaRecorder);
  Object.defineProperty(window, "isSecureContext", {
    configurable: true,
    value: true,
  });
  defineNavigatorMediaDevices();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function recordAndStop(result: {
  current: ReturnType<typeof useVoiceInput>;
}): Promise<void> {
  await act(async () => {
    await result.current.start();
  });
  await waitFor(() => expect(result.current.state).toBe("recording"));
  now = 2_000;
  await act(async () => {
    result.current.stop();
    await Promise.resolve();
  });
}

describe("useVoiceInput", () => {
  it("pins the recorder bitrate when a large-audio service supplies one", async () => {
    const onTranscribe = vi.fn(async () => "hello world");
    const { result } = renderHook(() =>
      useVoiceInput({
        onTranscript: vi.fn(),
        onTranscribe,
        getAudioBitsPerSecond: () => 32_000,
      }),
    );

    await recordAndStop(result);

    expect(MockMediaRecorder.instances).toHaveLength(1);
    expect(MockMediaRecorder.instances[0]?.options?.audioBitsPerSecond).toBe(
      32_000,
    );
  });

  it("leaves the recorder bitrate untouched when none is supplied", async () => {
    const { result } = renderHook(() =>
      useVoiceInput({
        onTranscript: vi.fn(),
        onTranscribe: vi.fn(async () => "hello world"),
        getAudioBitsPerSecond: () => null,
      }),
    );

    await recordAndStop(result);

    expect(
      MockMediaRecorder.instances[0]?.options?.audioBitsPerSecond,
    ).toBeUndefined();
  });

  it("retains the recording on failure and retries the same audio", async () => {
    const onTranscript = vi.fn();
    const onTranscribe = vi
      .fn()
      .mockRejectedValueOnce(new Error("Local transcription timed out"))
      .mockResolvedValueOnce("recovered transcript");
    const { result } = renderHook(() =>
      useVoiceInput({ onTranscript, onTranscribe }),
    );

    await recordAndStop(result);

    await waitFor(() => expect(result.current.state).toBe("error"));
    expect(result.current.canRetry).toBe(true);
    const firstFile = onTranscribe.mock.calls[0]?.[0]?.file as File;

    await act(async () => {
      result.current.retry();
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.state).toBe("idle"));
    expect(onTranscribe).toHaveBeenCalledTimes(2);
    expect(onTranscribe.mock.calls[1]?.[0]?.file).toBe(firstFile);
    expect(onTranscript).toHaveBeenCalledWith("recovered transcript");
    expect(result.current.canRetry).toBe(false);
  });
});
