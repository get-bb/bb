// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeThreadQueuedMessage } from "@bb/test-helpers/domain-fixtures";
import { createDeferredPromise } from "@bb/test-helpers";
import { useInlineQueuedMessageEditing } from "./useInlineQueuedMessageEditing";

const mocks = vi.hoisted(() => ({
  begin: vi.fn(),
  cancel: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/hooks/mutations/thread-runtime-mutations", () => ({
  useBeginThreadQueuedMessageEdit: () => ({
    mutateAsync: mocks.begin,
    isPending: false,
  }),
  useCancelThreadQueuedMessageEdit: () => ({
    mutateAsync: mocks.cancel,
    isPending: false,
  }),
}));
vi.mock("@/lib/mutation-errors", () => ({
  showMutationErrorToast: mocks.error,
}));
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});
afterEach(cleanup);

function fixture() {
  const queued = makeThreadQueuedMessage({
    id: "queued-edit",
    threadId: "thread-edit",
    updatedAt: 1,
  });
  const held = {
    ...queued,
    editToken: "edit-owner",
    editable: false,
    updatedAt: 2,
  };
  mocks.begin.mockResolvedValue(held);
  mocks.cancel.mockResolvedValue({ ...queued, updatedAt: 3 });
  return { queued, held };
}

describe("queued editor admission", () => {
  it("opens only after server admission and uses the acknowledged revision/token", async () => {
    const { queued, held } = fixture();
    const pending = createDeferredPromise<typeof held>();
    mocks.begin.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() =>
      useInlineQueuedMessageEditing({
        ownerThreadId: queued.threadId,
        queuedMessages: [queued],
      }),
    );
    act(() =>
      result.current.beginEditQueuedMessage({
        queuedMessageId: queued.id,
        queuedMessageIndex: 0,
      }),
    );
    expect(result.current.inlineEditingQueuedMessage).toBeNull();
    expect(mocks.begin).toHaveBeenCalledWith({
      id: queued.threadId,
      queuedMessageId: queued.id,
      expectedUpdatedAt: 1,
      editToken: null,
    });
    await act(async () => pending.resolve(held));
    expect(result.current.inlineEditingQueuedMessage).toMatchObject({
      expectedUpdatedAt: 2,
      editToken: "edit-owner",
    });
  });
  it("does not open an editor after dispatch won admission", async () => {
    const { queued } = fixture();
    mocks.begin.mockRejectedValueOnce(new Error("already being sent"));
    const { result } = renderHook(() =>
      useInlineQueuedMessageEditing({
        ownerThreadId: queued.threadId,
        queuedMessages: [queued],
      }),
    );
    act(() =>
      result.current.beginEditQueuedMessage({
        queuedMessageId: queued.id,
        queuedMessageIndex: 0,
      }),
    );
    await waitFor(() => expect(mocks.error).toHaveBeenCalled());
    expect(result.current.inlineEditingQueuedMessage).toBeNull();
    expect(mocks.cancel).not.toHaveBeenCalled();
  });
  it("keeps the hold on unmount and restores the unsaved draft on remount", async () => {
    const { queued, held } = fixture();
    const first = renderHook(() =>
      useInlineQueuedMessageEditing({
        ownerThreadId: queued.threadId,
        queuedMessages: [queued],
      }),
    );
    act(() =>
      first.result.current.beginEditQueuedMessage({
        queuedMessageId: queued.id,
        queuedMessageIndex: 0,
      }),
    );
    await waitFor(() =>
      expect(first.result.current.queuedMessageDraftSession).not.toBeNull(),
    );
    act(() =>
      first.result.current.queuedMessageDraftSession!.setDraft((draft) => ({
        ...draft,
        text: "UNSAVED",
      })),
    );
    first.unmount();
    expect(mocks.cancel).not.toHaveBeenCalled();
    const restored = renderHook(() =>
      useInlineQueuedMessageEditing({
        ownerThreadId: queued.threadId,
        queuedMessages: [held],
      }),
    );
    await waitFor(() =>
      expect(
        restored.result.current.inlineEditingQueuedMessage?.draft.text,
      ).toBe("UNSAVED"),
    );
    expect(mocks.begin).toHaveBeenCalledTimes(1);
  });
  it("preserves a draft if cancellation fails and clears it only after acknowledged cancel", async () => {
    const { queued } = fixture();
    const { result } = renderHook(() =>
      useInlineQueuedMessageEditing({
        ownerThreadId: queued.threadId,
        queuedMessages: [queued],
      }),
    );
    act(() =>
      result.current.beginEditQueuedMessage({
        queuedMessageId: queued.id,
        queuedMessageIndex: 0,
      }),
    );
    await waitFor(() =>
      expect(result.current.inlineEditingQueuedMessage).not.toBeNull(),
    );
    act(() =>
      result.current.queuedMessageDraftSession!.setDraft((draft) => ({
        ...draft,
        text: "UNSAVED",
      })),
    );
    mocks.cancel.mockRejectedValueOnce(new Error("offline"));
    act(() => result.current.dismissInlineQueuedMessageEditor());
    await waitFor(() => expect(mocks.error).toHaveBeenCalled());
    expect(result.current.inlineEditingQueuedMessage?.draft.text).toBe(
      "UNSAVED",
    );
    act(() => result.current.dismissInlineQueuedMessageEditor());
    await waitFor(() =>
      expect(result.current.inlineEditingQueuedMessage).toBeNull(),
    );
    expect(
      sessionStorage.getItem(`bb:queued-edit:${queued.threadId}`),
    ).toBeNull();
  });
  it("does not let an unmounted editor overwrite a restored draft", async () => {
    const { queued, held } = fixture();
    const first = renderHook(() =>
      useInlineQueuedMessageEditing({
        ownerThreadId: queued.threadId,
        queuedMessages: [queued],
      }),
    );
    act(() =>
      first.result.current.beginEditQueuedMessage({
        queuedMessageId: queued.id,
        queuedMessageIndex: 0,
      }),
    );
    await waitFor(() =>
      expect(first.result.current.queuedMessageDraftSession).not.toBeNull(),
    );
    const stale = first.result.current.queuedMessageDraftSession!;
    act(() => stale.setDraft((draft) => ({ ...draft, text: "FIRST" })));
    first.unmount();
    const second = renderHook(() =>
      useInlineQueuedMessageEditing({
        ownerThreadId: queued.threadId,
        queuedMessages: [held],
      }),
    );
    await waitFor(() =>
      expect(second.result.current.inlineEditingQueuedMessage?.draft.text).toBe(
        "FIRST",
      ),
    );
    act(() =>
      second.result.current.queuedMessageDraftSession!.setDraft((draft) => ({
        ...draft,
        text: "CURRENT",
      })),
    );
    act(() => stale.setDraft((draft) => ({ ...draft, text: "STALE" })));
    second.unmount();
    const third = renderHook(() =>
      useInlineQueuedMessageEditing({
        ownerThreadId: queued.threadId,
        queuedMessages: [held],
      }),
    );
    await waitFor(() =>
      expect(third.result.current.inlineEditingQueuedMessage?.draft.text).toBe(
        "CURRENT",
      ),
    );
  });
  it("explicitly resumes a held item without cancelling it first", async () => {
    const { held } = fixture();
    mocks.begin.mockResolvedValueOnce({
      ...held,
      editToken: "resumed-owner",
      updatedAt: 3,
    });
    const { result } = renderHook(() =>
      useInlineQueuedMessageEditing({
        ownerThreadId: held.threadId,
        queuedMessages: [held],
      }),
    );
    act(() =>
      result.current.beginEditQueuedMessage({
        queuedMessageId: held.id,
        queuedMessageIndex: 0,
      }),
    );
    await waitFor(() =>
      expect(result.current.inlineEditingQueuedMessage?.editToken).toBe(
        "resumed-owner",
      ),
    );
    expect(mocks.begin).toHaveBeenCalledWith({
      id: held.threadId,
      queuedMessageId: held.id,
      expectedUpdatedAt: 2,
      editToken: "edit-owner",
    });
    expect(mocks.cancel).not.toHaveBeenCalled();
  });
  it("keeps the editor and updates its position when earlier queue rows leave", async () => {
    const { queued, held } = fixture();
    const before = makeThreadQueuedMessage({
      id: "before",
      threadId: queued.threadId,
    });
    const hook = renderHook(
      ({ rows }) =>
        useInlineQueuedMessageEditing({
          ownerThreadId: queued.threadId,
          queuedMessages: rows,
        }),
      { initialProps: { rows: [before, queued] } },
    );
    act(() =>
      hook.result.current.beginEditQueuedMessage({
        queuedMessageId: queued.id,
        queuedMessageIndex: 1,
      }),
    );
    await waitFor(() =>
      expect(hook.result.current.inlineEditingQueuedMessage).not.toBeNull(),
    );
    act(() =>
      hook.result.current.queuedMessageDraftSession!.setDraft((draft) => ({
        ...draft,
        text: "UNSAVED",
      })),
    );
    hook.rerender({ rows: [held] });
    await waitFor(() =>
      expect(hook.result.current.inlineEditingQueuedMessage).toMatchObject({
        queuedMessageIndex: 0,
        draft: { text: "UNSAVED" },
      }),
    );
  });
});
