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
import { useVoiceInput } from "./useVoiceInput";

vi.mock("@/components/ui/app-toast", () => ({ appToast: { error: vi.fn() } }));
vi.mock("@/lib/audio-input-device-preference", () => ({
  useAudioInputDevicePreferenceValue: () => null,
  buildAudioInputConstraints: () => ({ audio: true }),
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

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("MediaRecorder", Recorder);
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: vi
        .fn()
        .mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }),
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
  expect(transcript).not.toHaveBeenCalled();
  const options = vi.mocked(appToast.error).mock.calls[0]?.[1];
  expect(options?.duration).toBe(Infinity);
  expect(options?.action?.label).toBe("Download recording");
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
  if (!options?.action) throw new Error("Missing download action");
  const button = render(
    <button onClick={options.action.onClick}>Download recording</button>,
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

it("discards a recording when its composer unmounts before acceptance", async () => {
  const onTranscribe = vi.fn();
  const { result, unmount } = renderHook(() =>
    useVoiceInput({ onTranscribe, onTranscript: vi.fn() }),
  );
  await act(() => result.current.start());
  vi.advanceTimersByTime(1500);
  unmount();
  await act(async () => Promise.resolve());
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
