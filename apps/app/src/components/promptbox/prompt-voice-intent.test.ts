import { describe, expect, it, vi } from "vitest";
import type { PromptDraftState } from "@bb/client-core";
import type { PromptBoxHandle } from "./PromptBoxInternal";
import {
  createPromptVoiceIntent,
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

describe("createPromptVoiceIntent", () => {
  it("sends only a successful send transcript, never a cancelled or add-to-draft transcript", () => {
    const intent = createPromptVoiceIntent();
    const promptBox = createPromptBox();
    const target = { promptBox, draft: undefined };

    expect(intent.claimStop("recording", true)).toBe(true);
    expect(intent.claimStop("recording", true)).toBe(false);
    intent.deliverTranscript("first transcript", target);
    expect(promptBox.sendVoiceTranscript).toHaveBeenCalledExactlyOnceWith(
      "first transcript",
    );

    intent.claimStop("recording", true);
    intent.cancel();
    intent.deliverTranscript("cancelled transcript", target);
    expect(promptBox.sendVoiceTranscript).toHaveBeenCalledOnce();
    expect(promptBox.insertTextAtCursor).toHaveBeenCalledWith(
      "cancelled transcript",
    );

    intent.claimStop("recording", false);
    intent.deliverTranscript("draft transcript", target);
    expect(promptBox.insertTextAtCursor).toHaveBeenCalledWith(
      "draft transcript",
    );
    expect(promptBox.sendVoiceTranscript).toHaveBeenCalledOnce();
  });

  it("does not carry send intent into another recording after transcription fails", () => {
    const intent = createPromptVoiceIntent();
    const promptBox = createPromptBox();

    intent.claimStop("recording", true);
    intent.settle("error");
    intent.settle("recording");
    intent.deliverTranscript("later transcript", {
      promptBox,
      draft: undefined,
    });

    expect(promptBox.sendVoiceTranscript).not.toHaveBeenCalled();
    expect(promptBox.insertTextAtCursor).toHaveBeenCalledExactlyOnceWith(
      "later transcript",
    );
  });

  it.each([
    ["send", true],
    ["stop", false],
  ] as const)(
    "preserves %s intent for the originating draft after unmount",
    async (_action, send) => {
      const intent = createPromptVoiceIntent();
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

      intent.claimStop("recording", send);
      intent.setMounted(false);
      draft = { ...draft, text: "Existing and later edits" };
      await intent.deliverTranscript("late transcript", {
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
    const intent = createPromptVoiceIntent();
    let draft: PromptDraftState = {
      text: "Existing and later edits",
      mentions: [],
      attachments: [],
    };

    intent.deliverTranscript("new words", {
      promptBox: null,
      draft: {
        getCurrent: () => draft,
        setDraft: (next) => {
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
