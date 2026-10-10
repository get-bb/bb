// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { appToast } from "@/components/ui/app-toast";
import { useAudioInputDevicePreferenceValue } from "@/lib/audio-input-device-preference";
import { useVoiceInput } from "./useVoiceInput";

vi.mock("@/components/ui/app-toast", () => ({ appToast: { error: vi.fn() } }));
vi.mock("@/lib/audio-input-device-preference", () => ({
  useAudioInputDevicePreferenceValue: vi.fn(() => null),
  requestAudioInputStream: (mediaDevices: MediaDevices) =>
    mediaDevices.getUserMedia({ audio: true }),
}));

class Recorder {
  static isTypeSupported = () => true;
  mimeType = "audio/webm";
  state = "inactive";
  onstart = () => {};
  ondataavailable = (_event: { data: Blob }) => {};
  onstop = async () => {};
  start() {
    this.state = "recording";
    this.onstart();
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable({ data: new Blob(["recorded audio"]) });
    return this.onstop();
  }
}

class DeferredRecorder extends Recorder {
  static current: DeferredRecorder;

  constructor() {
    super();
    DeferredRecorder.current = this;
  }

  stop() {
    this.state = "inactive";
    return Promise.resolve();
  }

  finish() {
    this.ondataavailable({ data: new Blob(["recorded audio"]) });
    return this.onstop();
  }
}

beforeEach(() => {
  vi.mocked(useAudioInputDevicePreferenceValue).mockReturnValue(null);
  vi.useFakeTimers();
  vi.stubGlobal("MediaRecorder", Recorder);
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: vi.fn().mockResolvedValue({
        getTracks: () => [{ stop: vi.fn() }],
        getAudioTracks: () => [],
      }),
    },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it.each([
  new Error("Upload failed"),
  new Error("Audio file exceeds the 20MB limit"),
])("keeps failed audio downloadable after unmount: %s", async (error) => {
  const transcribe = vi.fn().mockRejectedValue(error);
  const transcript = vi.fn();
  const { result, unmount } = renderHook(() =>
    useVoiceInput({
      onTranscribe: transcribe,
      onTranscript: transcript,
    }),
  );
  await act(() => result.current.start());
  vi.advanceTimersByTime(1500);
  await act(async () => result.current.stop());
  expect(result.current.state).toBe("error");
  expect(result.current.microphoneWarning).toBeNull();
  expect(transcript).not.toHaveBeenCalled();
  const options = vi.mocked(appToast.error).mock.calls[0]?.[1];
  expect(options?.duration).toBe(Infinity);
  expect(options?.cancel?.label).toBe("Download recording");
  unmount();
  const createObjectURL = vi.fn(() => "blob:recording");
  const revokeObjectURL = vi.fn();
  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
  let downloadedName = "";
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
    function (this: HTMLAnchorElement) {
      downloadedName = this.download;
      expect(this.href).toBe("blob:recording");
      expect(this.isConnected).toBe(true);
    },
  );
  if (!options?.cancel) throw new Error("Missing download action");
  const button = render(
    <button onClick={options.cancel.onClick}>Download recording</button>,
  );
  fireEvent.click(button.getByRole("button"));
  expect(createObjectURL).toHaveBeenCalledWith(
    transcribe.mock.calls[0]?.[0].file,
  );
  expect(downloadedName).toBe("recording.webm");
  expect(revokeObjectURL).not.toHaveBeenCalled();
  vi.advanceTimersByTime(60_000);
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:recording");
});

it("retries a failed transcription with the same recording", async () => {
  const transcribe = vi
    .fn()
    .mockRejectedValueOnce(new Error("the model did not answer in time"))
    .mockResolvedValueOnce(" Retried words ");
  const onTranscript = vi.fn();
  const { result } = renderHook(() =>
    useVoiceInput({
      onTranscribe: transcribe,
      onTranscript,
      getPromptContext: () => "draft context",
    }),
  );
  await act(() => result.current.start());
  vi.advanceTimersByTime(1500);
  await act(async () => result.current.stop());
  expect(result.current.state).toBe("error");
  const options = vi.mocked(appToast.error).mock.calls[0]?.[1];
  expect(options?.action?.label).toBe("Retry");
  if (!options?.action) throw new Error("Missing retry action");
  const button = render(
    <button onClick={options.action.onClick}>Retry</button>,
  );
  await act(async () => fireEvent.click(button.getByRole("button")));
  expect(transcribe).toHaveBeenCalledTimes(2);
  expect(transcribe.mock.calls[1]?.[0].file).toBe(
    transcribe.mock.calls[0]?.[0].file,
  );
  expect(transcribe.mock.calls[1]?.[0].promptContext).toBe("draft context");
  expect(onTranscript).toHaveBeenCalledWith("Retried words");
  expect(result.current.state).toBe("idle");
});

it("does not offer a download after explicit cancellation", async () => {
  const { result } = renderHook(() =>
    useVoiceInput({
      onTranscribe: vi
        .fn()
        .mockRejectedValue(new DOMException("Cancelled", "AbortError")),
      onTranscript: vi.fn(),
    }),
  );
  await act(() => result.current.start());
  vi.advanceTimersByTime(1500);
  await act(async () => result.current.stop());
  expect(result.current.state).toBe("idle");
  expect(appToast.error).not.toHaveBeenCalled();
});

it("keeps an accepted transcription running after unmount", async () => {
  let finishTranscription: ((text: string) => void) | undefined;
  const transcribe = vi.fn(
    (_args: { file: File; promptContext?: string; signal?: AbortSignal }) =>
      new Promise<string>((resolve) => {
        finishTranscription = resolve;
      }),
  );
  const onTranscript = vi.fn();
  const { result, unmount } = renderHook(() =>
    useVoiceInput({ onTranscribe: transcribe, onTranscript }),
  );
  await act(() => result.current.start());
  vi.advanceTimersByTime(1500);
  await act(async () => result.current.stop());
  const signal = transcribe.mock.calls[0]?.[0].signal;
  expect(signal?.aborted).toBe(false);

  unmount();
  expect(signal?.aborted).toBe(false);
  await act(async () => finishTranscription?.(" Spoken words "));
  expect(onTranscript).toHaveBeenCalledWith("Spoken words");
});

it("surfaces a failed asynchronous transcript submission after unmount", async () => {
  let finishSubmission: (() => void) | undefined;
  const onTranscript = vi.fn(
    () =>
      new Promise<void>((_resolve, reject) => {
        finishSubmission = () => reject(new Error("Submission failed"));
      }),
  );
  const { result, unmount } = renderHook(() =>
    useVoiceInput({ onTranscribe: async () => "Spoken words", onTranscript }),
  );
  await act(() => result.current.start());
  vi.advanceTimersByTime(1500);
  act(() => {
    result.current.stop();
  });
  await act(async () => {
    await Promise.resolve();
  });
  expect(onTranscript).toHaveBeenCalledWith("Spoken words");
  unmount();
  await act(async () => {
    finishSubmission?.();
  });
  expect(appToast.error).toHaveBeenCalledWith(
    "Voice input failed",
    expect.objectContaining({ description: "Submission failed" }),
  );
});

it("discards a stopped recording cancelled before the recorder's stop event", async () => {
  vi.stubGlobal("MediaRecorder", DeferredRecorder);
  const onTranscribe = vi.fn();
  const onTranscript = vi.fn();
  const { result } = renderHook(() =>
    useVoiceInput({ onTranscribe, onTranscript }),
  );
  await act(() => result.current.start());
  vi.advanceTimersByTime(1500);
  act(() => {
    result.current.stop();
    result.current.cancel();
  });
  await act(async () => DeferredRecorder.current.finish());
  expect(onTranscribe).not.toHaveBeenCalled();
  expect(onTranscript).not.toHaveBeenCalled();
});

it("transcribes an accepted recording when the recorder stops after unmount", async () => {
  vi.stubGlobal("MediaRecorder", DeferredRecorder);
  const onTranscribe = vi.fn().mockResolvedValue("Delayed words");
  const onTranscript = vi.fn();
  const { result, unmount } = renderHook(() =>
    useVoiceInput({ onTranscribe, onTranscript }),
  );
  await act(() => result.current.start());
  vi.advanceTimersByTime(1500);
  act(() => result.current.stop());
  unmount();

  await act(async () => DeferredRecorder.current.finish());
  expect(onTranscribe).toHaveBeenCalledOnce();
  expect(onTranscript).toHaveBeenCalledWith("Delayed words");
  expect(appToast.error).not.toHaveBeenCalled();
});

it("discards a recording when its composer unmounts before acceptance", async () => {
  vi.stubGlobal("MediaRecorder", DeferredRecorder);
  const onTranscribe = vi.fn();
  const { result, unmount } = renderHook(() =>
    useVoiceInput({ onTranscribe, onTranscript: vi.fn() }),
  );
  await act(() => result.current.start());
  vi.advanceTimersByTime(1500);
  unmount();
  await act(async () => DeferredRecorder.current.finish());
  expect(onTranscribe).not.toHaveBeenCalled();
});

it("aborts transcription when the user cancels it", async () => {
  let finishTranscription: ((text: string) => void) | undefined;
  const onTranscribe = vi.fn(
    (_args: { file: File; promptContext?: string; signal?: AbortSignal }) =>
      new Promise<string>((resolve) => {
        finishTranscription = resolve;
      }),
  );
  const onTranscript = vi.fn();
  const { result } = renderHook(() =>
    useVoiceInput({ onTranscribe, onTranscript }),
  );
  await act(() => result.current.start());
  vi.advanceTimersByTime(1500);
  await act(async () => result.current.stop());
  const signal = onTranscribe.mock.calls[0]?.[0].signal;
  act(() => result.current.cancel());
  expect(signal?.aborted).toBe(true);
  await act(async () => finishTranscription?.("Cancelled words"));
  expect(onTranscript).not.toHaveBeenCalled();
});

it("warns when microphone access fails and clears the warning after a successful retry", async () => {
  vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValueOnce(
    new DOMException("Unavailable", "NotReadableError"),
  );
  const { result } = renderHook(() =>
    useVoiceInput({ onTranscribe: vi.fn(), onTranscript: vi.fn() }),
  );
  await act(() => result.current.start());
  expect(result.current.microphoneWarning).toBe(
    "Microphone is unavailable or already in use",
  );
  await act(() => result.current.start());
  expect(result.current.state).toBe("recording");
  expect(result.current.microphoneWarning).toBeNull();
});

it("tracks interrupted audio and retains a disconnect warning after recording stops", async () => {
  const track = Object.assign(new EventTarget(), {
    muted: false,
    readyState: "live",
    stop: vi.fn(),
  });
  vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValue({
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream);
  const { result } = renderHook(() =>
    useVoiceInput({
      onTranscribe: vi.fn().mockResolvedValue("hello"),
      onTranscript: vi.fn(),
    }),
  );
  await act(() => result.current.start());
  act(() => {
    track.muted = true;
    track.dispatchEvent(new Event("mute"));
  });
  expect(result.current.microphoneWarning).toContain("not providing audio");
  act(() => {
    track.muted = false;
    track.dispatchEvent(new Event("unmute"));
  });
  expect(result.current.microphoneWarning).toBeNull();
  act(() => {
    track.readyState = "ended";
    track.dispatchEvent(new Event("ended"));
  });
  vi.advanceTimersByTime(1500);
  await act(async () => result.current.stop());
  expect(result.current.microphoneWarning).toContain(
    "disconnected during recording",
  );
});

it("does not block recording for a missing preference when fallback devices exist", async () => {
  vi.mocked(useAudioInputDevicePreferenceValue).mockReturnValue("built-in");
  const enumerateDevices = vi
    .fn()
    .mockResolvedValue([{ kind: "audioinput", deviceId: "masked", label: "" }]);
  const mediaDevices = Object.assign(new EventTarget(), {
    enumerateDevices,
    getUserMedia: vi.fn(),
  });
  vi.stubGlobal("navigator", { mediaDevices });
  const { result } = renderHook(() =>
    useVoiceInput({ onTranscribe: vi.fn(), onTranscript: vi.fn() }),
  );
  await act(async () => {});
  expect(result.current.microphoneWarning).toBeNull();
  enumerateDevices.mockResolvedValue([
    { kind: "audioinput", deviceId: "external", label: "Display microphone" },
  ]);
  await act(async () => mediaDevices.dispatchEvent(new Event("devicechange")));
  expect(result.current.microphoneWarning).toBeNull();
  enumerateDevices.mockResolvedValue([
    { kind: "audioinput", deviceId: "built-in", label: "Built-in microphone" },
  ]);
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(result.current.microphoneWarning).toBeNull();
  enumerateDevices.mockResolvedValue([]);
  await act(async () => mediaDevices.dispatchEvent(new Event("devicechange")));
  expect(result.current.microphoneWarning).not.toBeNull();
});

function installAudioContext() {
  const audio = { amplitude: 0, closed: vi.fn() };
  class TestAudioContext {
    state = "running";
    resume = async () => {};
    close = async () => {
      audio.closed();
    };
    createMediaStreamSource = () => ({ connect: vi.fn(), disconnect: vi.fn() });
    createMediaStreamDestination = () => ({
      stream: { getTracks: () => [{ stop: vi.fn() }] },
    });
    createAnalyser = () => ({
      fftSize: 2048,
      disconnect: vi.fn(),
      getFloatTimeDomainData: (samples: Float32Array) =>
        samples.fill(audio.amplitude),
    });
  }
  vi.stubGlobal("AudioContext", TestAudioContext);
  return audio;
}

it("warns about sustained silence without stopping and clears the warning as soon as sound returns", async () => {
  const audio = installAudioContext();
  const { result } = renderHook(() =>
    useVoiceInput({ onTranscribe: vi.fn(), onTranscript: vi.fn() }),
  );
  await act(() => result.current.start());
  act(() => vi.advanceTimersByTime(4900));
  expect(result.current.microphoneWarning).toBeNull();
  act(() => vi.advanceTimersByTime(200));
  expect(result.current.microphoneWarning).toContain("No audio detected");
  expect(result.current.state).toBe("recording");
  audio.amplitude = 0.02;
  act(() => vi.advanceTimersByTime(100));
  expect(result.current.microphoneWarning).toBeNull();
});

it("keeps the same recorder and captured audio when a microphone disconnects, and releases a late replacement after stop", async () => {
  installAudioContext();
  const firstTrack = Object.assign(new EventTarget(), {
    muted: false,
    readyState: "live",
    stop: vi.fn(),
  });
  const secondTrack = Object.assign(new EventTarget(), {
    muted: false,
    readyState: "live",
    stop: vi.fn(),
  });
  const first = {
    getTracks: () => [firstTrack],
    getAudioTracks: () => [firstTrack],
  };
  const second = {
    getTracks: () => [secondTrack],
    getAudioTracks: () => [secondTrack],
  };
  const recorders: Recorder[] = [];
  class CountingRecorder extends Recorder {
    constructor() {
      super();
      recorders.push(this);
    }
  }
  vi.stubGlobal("MediaRecorder", CountingRecorder);
  const capture = vi
    .fn()
    .mockResolvedValueOnce(first)
    .mockResolvedValueOnce(second);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: capture } });
  const transcribe = vi.fn().mockResolvedValue("Kept my dictation");
  const { result } = renderHook(() =>
    useVoiceInput({ onTranscribe: transcribe, onTranscript: vi.fn() }),
  );
  await act(() => result.current.start());
  await act(async () => {
    firstTrack.readyState = "ended";
    firstTrack.dispatchEvent(new Event("ended"));
  });
  expect(result.current.stream).toBe(second);
  expect(result.current.state).toBe("recording");
  expect(recorders).toHaveLength(1);
  expect(firstTrack.stop).toHaveBeenCalledOnce();
  let finish: (stream: object) => void = () => {};
  capture.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => {
    secondTrack.readyState = "ended";
    secondTrack.dispatchEvent(new Event("ended"));
  });
  act(() => vi.advanceTimersByTime(1500));
  await act(async () => result.current.stop());
  const lateStop = vi.fn();
  await act(async () => finish({ getTracks: () => [{ stop: lateStop }] }));
  expect(lateStop).toHaveBeenCalledOnce();
  expect(transcribe).toHaveBeenCalledOnce();
  expect(result.current.stream).toBeNull();
});
