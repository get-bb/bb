// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InlineQueuedMessageEditState } from "./useInlineQueuedMessageEditing";
import { useComposerAttachmentUploads } from "./useComposerAttachmentUploads";

const mocks = vi.hoisted(() => ({
  upload: vi.fn(),
}));

vi.mock("@/hooks/mutations/project-mutations", () => ({
  useUploadPromptAttachment: () => ({ mutateAsync: mocks.upload }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function makeInlineEdit(editSessionId: number): InlineQueuedMessageEditState {
  return {
    draft: { attachments: [], mentions: [], text: "queued" },
    editSessionId,
    expectedUpdatedAt: 1,
    model: "gpt-5",
    ownerThreadId: "thr_1",
    permissionMode: "auto",
    queuedMessageId: "qmsg_1",
    queuedMessageIndex: 0,
    reasoningLevel: "medium",
    serviceTier: "default",
  };
}

describe("useComposerAttachmentUploads", () => {
  beforeEach(() => {
    mocks.upload.mockReset();
  });

  it("keeps bottom and queued attachment operations independent", async () => {
    const bottomUpload = deferred<never>();
    const inlineUpload = deferred<never>();
    mocks.upload
      .mockReturnValueOnce(bottomUpload.promise)
      .mockReturnValueOnce(inlineUpload.promise);
    const inline = makeInlineEdit(1);
    const inlineRef = { current: inline };
    const { result } = renderHook(() =>
      useComposerAttachmentUploads({
        projectId: "proj_1",
        addDraftAttachment: vi.fn(),
        inlineEditingQueuedMessage: inline,
        inlineEditingQueuedMessageRef: inlineRef,
        commitInlineQueuedMessage: vi.fn(),
      }),
    );

    let bottomPromise!: Promise<void>;
    act(() => {
      bottomPromise = result.current.handleAttachBottomFiles([
        new File(["bottom"], "bottom.txt"),
      ]);
    });
    expect(result.current.isAttachingBottomFiles).toBe(true);
    expect(result.current.isAttachingInlineFiles).toBe(false);

    let inlinePromise!: Promise<void>;
    act(() => {
      inlinePromise = result.current.handleAttachInlineFiles([
        new File(["inline"], "inline.txt"),
      ]);
    });
    expect(result.current.isAttachingBottomFiles).toBe(true);
    expect(result.current.isAttachingInlineFiles).toBe(true);

    await act(async () => {
      inlineUpload.reject(new Error("inline failed"));
      await inlinePromise;
    });
    expect(result.current.inlineAttachmentError).toBe(
      "Failed to attach: inline.txt",
    );
    expect(result.current.bottomAttachmentError).toBeNull();
    expect(result.current.isAttachingBottomFiles).toBe(true);

    await act(async () => {
      bottomUpload.reject(new Error("bottom failed"));
      await bottomPromise;
    });
    expect(result.current.bottomAttachmentError).toBe(
      "Failed to attach: bottom.txt",
    );
    expect(result.current.inlineAttachmentError).toBe(
      "Failed to attach: inline.txt",
    );
  });

  it("does not leak a dismissed upload into a later queued edit", async () => {
    const oldUpload = deferred<never>();
    mocks.upload.mockReturnValueOnce(oldUpload.promise);
    const firstEdit = makeInlineEdit(1);
    const inlineRef: { current: InlineQueuedMessageEditState | null } = {
      current: firstEdit,
    };
    const commitInlineQueuedMessage = vi.fn();
    const { result, rerender } = renderHook(
      ({ inline }: { inline: InlineQueuedMessageEditState | null }) =>
        useComposerAttachmentUploads({
          projectId: "proj_1",
          addDraftAttachment: vi.fn(),
          inlineEditingQueuedMessage: inline,
          inlineEditingQueuedMessageRef: inlineRef,
          commitInlineQueuedMessage,
        }),
      {
        initialProps: {
          inline: firstEdit as InlineQueuedMessageEditState | null,
        },
      },
    );

    let uploadPromise!: Promise<void>;
    act(() => {
      uploadPromise = result.current.handleAttachInlineFiles([
        new File(["old"], "old.txt"),
      ]);
    });
    expect(result.current.isAttachingInlineFiles).toBe(true);

    inlineRef.current = null;
    rerender({ inline: null });
    expect(result.current.isAttachingInlineFiles).toBe(false);
    expect(result.current.inlineAttachmentError).toBeNull();

    const secondEdit = makeInlineEdit(2);
    inlineRef.current = secondEdit;
    rerender({ inline: secondEdit });
    await act(async () => {
      oldUpload.reject(new Error("old failed"));
      await uploadPromise;
    });

    expect(result.current.isAttachingInlineFiles).toBe(false);
    expect(result.current.inlineAttachmentError).toBeNull();
    expect(commitInlineQueuedMessage).not.toHaveBeenCalled();
  });
});
