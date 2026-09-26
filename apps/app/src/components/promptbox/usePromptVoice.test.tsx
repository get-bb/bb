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
