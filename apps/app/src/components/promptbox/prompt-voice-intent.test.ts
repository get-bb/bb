import { describe, expect, it, vi } from "vitest";
import type { PromptDraftState } from "@bb/client-core";
import type { PromptBoxHandle } from "./PromptBoxInternal";
import {
  deliverPromptVoiceTranscript,
  transcribeAfterCompletionTransition,
} from "./prompt-voice-intent";

function createPromptBox() {
  return {
    captureHeightForLayoutChange: vi.fn(),
    focusEnd: vi.fn(),
    getTextBeforeCursor: vi.fn(),
    insertTextAtCursor: vi.fn(),
    sendVoiceTranscript: vi.fn(),
    playVoiceCompletionTransition: vi.fn(async () => {}),
  } satisfies PromptBoxHandle;
}

describe("transcribeAfterCompletionTransition", () => {
  it("waits for the completion transition after transcription resolves", async () => {
    let finishTransition: (() => void) | undefined;
    const playCompletionTransition = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishTransition = resolve;
        }),
    );
    const transcription = transcribeAfterCompletionTransition(
      async () => "Transcript",
      playCompletionTransition,
      undefined,
    );

    await vi.waitFor(() =>
      expect(playCompletionTransition).toHaveBeenCalledOnce(),
    );
    let settled = false;
    void transcription.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    finishTransition?.();
    await expect(transcription).resolves.toBe("Transcript");
  });
});

describe("deliverPromptVoiceTranscript", () => {
  it.each([
    ["send", true],
    ["insert", false],
  ] as const)(
    "preserves %s delivery for the originating draft after unmount",
    async (delivery, send) => {
      const promptBox = createPromptBox();
      let draft: PromptDraftState = {
        text: "Existing",
        mentions: [],
        attachments: [],
      };
      const submit = vi.fn(async () => {
        expect(draft.text).toBe("Existing and later edits late transcript");
      });
      const origin = {
        getCurrent: () => draft,
        setDraft: (next: PromptDraftState) => {
          draft = next;
        },
        submit,
      };

      draft = { ...draft, text: "Existing and later edits" };
      await deliverPromptVoiceTranscript("late transcript", delivery, {
        mounted: false,
        promptBox,
        draft: origin,
      });

      expect(draft.text).toBe("Existing and later edits late transcript");
      expect(promptBox.sendVoiceTranscript).not.toHaveBeenCalled();
      expect(promptBox.insertTextAtCursor).not.toHaveBeenCalled();
      expect(submit).toHaveBeenCalledTimes(send ? 1 : 0);
    },
  );

  it("appends a completed transcript to the originating draft without a prompt box", () => {
    let draft: PromptDraftState = {
      text: "Existing and later edits",
      mentions: [],
      attachments: [],
    };

    void deliverPromptVoiceTranscript("new words", "insert", {
      mounted: true,
      promptBox: null,
      draft: {
        getCurrent: () => draft,
        setDraft: (next: PromptDraftState) => {
          draft = next;
        },
      },
    });

    expect(draft).toEqual({
      text: "Existing and later edits new words",
      mentions: [],
      attachments: [],
    });
  });
});
