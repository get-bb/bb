// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { transcribeVoiceInput } from "@/lib/api";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import type { PromptBoxHandle } from "./PromptBoxInternal";
import { usePromptVoice } from "./usePromptVoice";
import type { PromptDraftState } from "@bb/client-core";

vi.mock("@/lib/api", () => ({
  transcribeVoiceInput: vi.fn(),
}));

vi.mock("@/hooks/useVoiceInput", () => ({
  useVoiceInput: vi.fn(),
}));

const voiceInput = {
  state: "transcribing" as const,
  isSupported: true,
  unsupportedReason: null,
  stream: null,
  start: vi.fn(),
  stop: vi.fn(),
  cancel: vi.fn(),
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("usePromptVoice", () => {
  it("waits for the completion transition after transcription resolves", async () => {
    vi.mocked(useVoiceInput).mockReturnValue({
      ...voiceInput,
      isRecording: false,
      isProcessing: true,
      isListening: false,
    });
    vi.mocked(transcribeVoiceInput).mockResolvedValue({ text: "Transcript" });

    let finishTransition: (() => void) | undefined;
    const playVoiceCompletionTransition = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishTransition = resolve;
        }),
    );
    const insertTextAtCursor = vi.fn();
    const promptBoxRef = {
      current: {
        captureHeightForLayoutChange: vi.fn(),
        focusEnd: vi.fn(),
        getTextBeforeCursor: vi.fn(),
        insertTextAtCursor,
        sendVoiceTranscript: vi.fn(),
        playVoiceCompletionTransition,
      } satisfies PromptBoxHandle,
    };

    renderHook(() => usePromptVoice(promptBoxRef));
    const options = vi.mocked(useVoiceInput).mock.calls[0]?.[0];
    const transcription = options?.onTranscribe({
      file: new File([], "recording.webm", { type: "audio/webm" }),
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(playVoiceCompletionTransition).toHaveBeenCalledOnce();

    let settled = false;
    void transcription?.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    finishTransition?.();
    await expect(transcription).resolves.toBe("Transcript");
    expect(insertTextAtCursor).not.toHaveBeenCalled();
  });

  it("sends only a successful send transcript, never a cancelled or add-to-draft transcript", () => {
    vi.mocked(useVoiceInput).mockReturnValue({
      ...voiceInput,
      state: "recording",
      isRecording: true,
      isProcessing: false,
      isListening: true,
    });
    const insertTextAtCursor = vi.fn();
    const sendVoiceTranscript = vi.fn();
    const promptBoxRef = {
      current: {
        captureHeightForLayoutChange: vi.fn(),
        focusEnd: vi.fn(),
        getTextBeforeCursor: vi.fn(),
        insertTextAtCursor,
        sendVoiceTranscript,
        playVoiceCompletionTransition: vi.fn(),
      } satisfies PromptBoxHandle,
    };
    const { result } = renderHook(() => usePromptVoice(promptBoxRef));
    const options = vi.mocked(useVoiceInput).mock.calls[0]?.[0];
    act(() => {
      result.current.send();
      result.current.send();
    });
    expect(voiceInput.stop).toHaveBeenCalledOnce();
    act(() => options?.onTranscript("first transcript"));
    expect(sendVoiceTranscript).toHaveBeenCalledExactlyOnceWith(
      "first transcript",
    );
    act(() => {
      result.current.send();
      result.current.cancel();
      options?.onTranscript("cancelled transcript");
    });
    expect(sendVoiceTranscript).toHaveBeenCalledOnce();
    expect(insertTextAtCursor).toHaveBeenCalledWith("cancelled transcript");
    act(() => {
      result.current.stop();
      options?.onTranscript("draft transcript");
    });
    expect(insertTextAtCursor).toHaveBeenCalledWith("draft transcript");
    expect(sendVoiceTranscript).toHaveBeenCalledOnce();
  });

  it("does not carry send intent into another recording after transcription fails", () => {
    let state: "recording" | "error" = "recording";
    vi.mocked(useVoiceInput).mockImplementation(() => ({
      ...voiceInput,
      state,
      isRecording: state === "recording",
      isProcessing: false,
      isListening: state === "recording",
    }));
    const insertTextAtCursor = vi.fn();
    const sendVoiceTranscript = vi.fn();
    const promptBoxRef = {
      current: {
        captureHeightForLayoutChange: vi.fn(),
        focusEnd: vi.fn(),
        getTextBeforeCursor: vi.fn(),
        insertTextAtCursor,
        sendVoiceTranscript,
        playVoiceCompletionTransition: vi.fn(),
      } satisfies PromptBoxHandle,
    };
    const { result, rerender } = renderHook(() => usePromptVoice(promptBoxRef));
    const options = vi.mocked(useVoiceInput).mock.calls[0]?.[0];
    act(() => result.current.send());
    state = "error";
    rerender();
    state = "recording";
    rerender();
    act(() => options?.onTranscript("later transcript"));
    expect(sendVoiceTranscript).not.toHaveBeenCalled();
    expect(insertTextAtCursor).toHaveBeenCalledExactlyOnceWith(
      "later transcript",
    );
  });

  it("does not submit into a replacement composer after navigating away", () => {
    vi.mocked(useVoiceInput).mockReturnValue({
      ...voiceInput,
      state: "recording",
      isRecording: true,
      isProcessing: false,
      isListening: true,
    });
    const sendVoiceTranscript = vi.fn();
    const promptBoxRef = {
      current: {
        captureHeightForLayoutChange: vi.fn(),
        focusEnd: vi.fn(),
        getTextBeforeCursor: vi.fn(),
        insertTextAtCursor: vi.fn(),
        sendVoiceTranscript,
        playVoiceCompletionTransition: vi.fn(),
      } satisfies PromptBoxHandle,
    };
    const { result, unmount } = renderHook(() => usePromptVoice(promptBoxRef));
    const options = vi.mocked(useVoiceInput).mock.calls[0]?.[0];
    act(() => result.current.send());
    unmount();
    options?.onTranscript("late transcript");
    expect(sendVoiceTranscript).not.toHaveBeenCalled();
  });

  it("appends a completed transcript to the originating draft after unmount", () => {
    vi.mocked(useVoiceInput).mockReturnValue({
      ...voiceInput,
      isRecording: false,
      isProcessing: true,
      isListening: false,
    });
    const promptBoxRef = { current: null };
    let draft: PromptDraftState = {
      text: "Existing",
      mentions: [],
      attachments: [],
    };
    const getCurrent = vi.fn(() => draft);
    const setDraft = vi.fn((next: PromptDraftState) => {
      draft = next;
    });
    renderHook(() => usePromptVoice(promptBoxRef, { getCurrent, setDraft }));
    const options = vi.mocked(useVoiceInput).mock.calls[0]?.[0];
    draft = { ...draft, text: "Existing and later edits" };
    options?.onTranscript("new words");
    expect(draft).toEqual({
      text: "Existing and later edits new words",
      mentions: [],
      attachments: [],
    });
  });
});
