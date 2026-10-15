// @vitest-environment jsdom

import "fake-indexeddb/auto";
import { clear, createStore, keys } from "idb-keyval";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

type VoiceRecordingStore = typeof import("./voice-recording-store");

async function loadFreshStore(): Promise<VoiceRecordingStore> {
  vi.resetModules();
  return import("./voice-recording-store");
}

function recordingFile(contents: string): File {
  return new File([contents], "recording.webm", { type: "audio/webm" });
}

const recordingsDatabase = createStore("bb-voice-recordings", "recordings");

afterEach(() => clear(recordingsDatabase));

it("restores a recording that never finished transcribing after a reload", async () => {
  const before = await loadFreshStore();
  before.saveVoiceRecording(
    {
      key: "thread/thr_1",
      file: recordingFile("spoken audio"),
      promptContext: "earlier text",
      delivery: "send",
    },
    { persist: true },
  );
  const other = before.saveVoiceRecording(
    {
      key: "thread/thr_2",
      file: recordingFile("other audio"),
      promptContext: undefined,
      delivery: "insert",
    },
    { persist: true },
  );
  before.failVoiceRecording(other.id, "HTTP 500");
  await waitFor(async () =>
    expect(await keys(recordingsDatabase)).toHaveLength(2),
  );

  const after = await loadFreshStore();
  const { result } = renderHook(() =>
    after.useFailedVoiceRecordings("thread/thr_1"),
  );
  await waitFor(() => expect(result.current).toHaveLength(1));
  const [restored] = result.current;
  expect(restored).toMatchObject({
    key: "thread/thr_1",
    promptContext: "earlier text",
    delivery: "send",
    errorMessage: null,
  });
  expect(restored?.file.name).toBe("recording.webm");
  expect(restored?.file.type).toBe("audio/webm");
  expect(await restored?.file.text()).toBe("spoken audio");
});

it("leaves nothing stored once recordings are deleted, even before their saves finish", async () => {
  const before = await loadFreshStore();
  const transcribed = before.saveVoiceRecording(
    {
      key: "thread/thr_1",
      file: recordingFile("transcribed audio"),
      promptContext: undefined,
      delivery: "insert",
    },
    { persist: true },
  );
  void before.deleteVoiceRecording(transcribed.id);
  const discarded = before.saveVoiceRecording(
    {
      key: "thread/thr_1",
      file: recordingFile("discarded audio"),
      promptContext: undefined,
      delivery: "insert",
    },
    { persist: true },
  );
  before.failVoiceRecording(discarded.id, "Service unavailable");
  const { result } = renderHook(() =>
    before.useFailedVoiceRecordings("thread/thr_1"),
  );
  expect(result.current.map((recording) => recording.id)).toEqual([
    discarded.id,
  ]);
  await act(() => before.deleteVoiceRecording(discarded.id));
  expect(result.current).toEqual([]);
  expect(await keys(recordingsDatabase)).toEqual([]);
});
