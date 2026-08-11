// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type {
  ThreadRewindCommitResponse,
  ThreadRewindPreviewResponse,
} from "@bb/server-contract";
import type { PromptDraftState } from "@/lib/prompt-draft";
import { BbHttpError } from "@/lib/sdk";
import { sdk } from "@/lib/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  useThreadRewindEditing,
  type ThreadRewindBeginTarget,
} from "./useThreadRewindEditing";

vi.mock("@/lib/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sdk")>();
  return {
    ...actual,
    sdk: {
      threads: {
        rewind: {
          branches: vi.fn(),
          commit: vi.fn(),
          preview: vi.fn(),
          restore: vi.fn(),
        },
      },
    },
  };
});

const eligiblePreview: ThreadRewindPreviewResponse = {
  displacedTurnCount: 3,
  eligibility: { status: "eligible" },
  mode: "conversation-only",
  provider: "codex",
  revision: 7,
  sourceSequence: 42,
  startsFreshProviderSession: false,
  target: { branchId: "br_1", sourceSequence: 42, turnId: "turn_1" },
};

const target: ThreadRewindBeginTarget = {
  branchId: "br_1",
  restoreMentions: [],
  restoreText: "Fix the sidebar overflow",
  sourceSequence: 42,
  turnId: "turn_1",
};

function submittedResponse(): ThreadRewindCommitResponse {
  return {
    draft: null,
    newBranchId: "br_2",
    previousBranchId: "br_1",
    requestId: "req_1",
    result: {
      displacedTurnCount: 3,
      mode: "conversation-only",
      previousBranchId: "br_1",
      sourceSequence: 42,
      threadId: "thr_1",
    },
    submission: "submitted",
  };
}

function draftRecoveryResponse(): ThreadRewindCommitResponse {
  return {
    ...submittedResponse(),
    draft: [{ type: "text", text: "edited", mentions: [] }],
    submission: "draft-recovery",
  };
}

function draftStorageHarness() {
  let draft: PromptDraftState = {
    attachments: [],
    mentions: [],
    text: "previous draft",
  };
  return {
    get draft() {
      return draft;
    },
    read: vi.fn(() => draft),
    write: vi.fn((next: PromptDraftState) => {
      draft = next;
    }),
  };
}

describe("useThreadRewindEditing", () => {
  beforeEach(() => {
    vi.mocked(sdk.threads.rewind.preview).mockReset();
    vi.mocked(sdk.threads.rewind.commit).mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("restores the message into the draft and confirms after a successful preview", async () => {
    const harness = createQueryClientTestHarness();
    const storage = draftStorageHarness();
    const focus = vi.fn();
    vi.mocked(sdk.threads.rewind.preview).mockResolvedValue(eligiblePreview);
    const { result } = renderHook(
      () =>
        useThreadRewindEditing({
          branchId: "br_1",
          onFocusComposer: focus,
          readDraft: storage.read,
          statusKey: "idle",
          threadId: "thr_1",
          writeDraft: storage.write,
        }),
      { wrapper: harness.wrapper },
    );

    act(() => result.current.beginRewind(target));
    expect(storage.write).toHaveBeenCalledWith({
      attachments: [],
      mentions: [],
      text: "Fix the sidebar overflow",
    });
    expect(focus).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(result.current.session?.status).toBe("confirming"),
    );
    expect(result.current.session?.displacedTurnCount).toBe(3);
    expect(result.current.session?.revision).toBe(7);
  });

  it("marks the session stale with an explanation when the preview denies eligibility", async () => {
    const harness = createQueryClientTestHarness();
    const storage = draftStorageHarness();
    vi.mocked(sdk.threads.rewind.preview).mockResolvedValue({
      ...eligiblePreview,
      eligibility: { reason: "attachments-not-supported", status: "ineligible" },
    });
    const { result } = renderHook(
      () =>
        useThreadRewindEditing({
          branchId: "br_1",
          onFocusComposer: vi.fn(),
          readDraft: storage.read,
          statusKey: "idle",
          threadId: "thr_1",
          writeDraft: storage.write,
        }),
      { wrapper: harness.wrapper },
    );

    act(() => result.current.beginRewind(target));
    await waitFor(() => expect(result.current.session?.status).toBe("stale"));
    expect(result.current.session?.message).toContain("attachments");
  });

  it("clears the draft and settles on a submitted commit", async () => {
    const harness = createQueryClientTestHarness();
    const storage = draftStorageHarness();
    const onSettled = vi.fn();
    vi.mocked(sdk.threads.rewind.preview).mockResolvedValue(eligiblePreview);
    vi.mocked(sdk.threads.rewind.commit).mockResolvedValue(
      submittedResponse(),
    );
    const { result } = renderHook(
      () =>
        useThreadRewindEditing({
          branchId: "br_1",
          onFocusComposer: vi.fn(),
          onSettled,
          readDraft: storage.read,
          statusKey: "idle",
          threadId: "thr_1",
          writeDraft: storage.write,
        }),
      { wrapper: harness.wrapper },
    );
    act(() => result.current.beginRewind(target));
    await waitFor(() =>
      expect(result.current.session?.status).toBe("confirming"),
    );

    act(() =>
      result.current.commitRewind([
        { type: "text", text: "edited", mentions: [] },
      ]),
    );
    await waitFor(() => expect(result.current.session).toBeNull());
    expect(sdk.threads.rewind.commit).toHaveBeenCalledWith(
      expect.objectContaining({
        editedInput: [{ type: "text", text: "edited", mentions: [] }],
        idempotencyKey: expect.stringContaining("rewind:thr_1:br_1:42:turn_1"),
        mode: "conversation-only",
        preview: { revision: 7, target: eligiblePreview.target },
        target: eligiblePreview.target,
        threadId: "thr_1",
      }),
    );
    expect(storage.write).toHaveBeenLastCalledWith({
      attachments: [],
      mentions: [],
      text: "",
    });
    expect(onSettled).toHaveBeenCalledWith({
      displacedTurnCount: 3,
      submission: "submitted",
    });
  });

  it("preserves the draft and offers a retry when the commit fails", async () => {
    const harness = createQueryClientTestHarness();
    const storage = draftStorageHarness();
    vi.mocked(sdk.threads.rewind.preview).mockResolvedValue(eligiblePreview);
    vi.mocked(sdk.threads.rewind.commit).mockRejectedValue(
      new BbHttpError({
        body: { retryable: true },
        code: "provider-branch-failed",
        message: "boom",
        status: 409,
      }),
    );
    const { result } = renderHook(
      () =>
        useThreadRewindEditing({
          branchId: "br_1",
          onFocusComposer: vi.fn(),
          readDraft: storage.read,
          statusKey: "idle",
          threadId: "thr_1",
          writeDraft: storage.write,
        }),
      { wrapper: harness.wrapper },
    );
    act(() => result.current.beginRewind(target));
    await waitFor(() =>
      expect(result.current.session?.status).toBe("confirming"),
    );

    act(() =>
      result.current.commitRewind([
        { type: "text", text: "edited", mentions: [] },
      ]),
    );
    await waitFor(() =>
      expect(result.current.session?.status).toBe("failed"),
    );
    // The user's edit stays in the composer — never reset to the previous
    // draft and never cleared.
    expect(storage.draft.text).toBe("Fix the sidebar overflow");
    expect(result.current.session?.retryable).toBe(true);
    expect(result.current.session?.message).toContain("preserved");

    // Retry reuses the same idempotency key so the server can resume the op.
    vi.mocked(sdk.threads.rewind.commit).mockResolvedValue(
      submittedResponse(),
    );
    act(() =>
      result.current.commitRewind([
        { type: "text", text: "edited", mentions: [] },
      ]),
    );
    await waitFor(() => expect(result.current.session).toBeNull());
    const calls = vi.mocked(sdk.threads.rewind.commit).mock.calls;
    expect(calls[0]?.[0]?.idempotencyKey).toBe(
      calls[1]?.[0]?.idempotencyKey,
    );
  });

  it("keeps the draft and reports recovery when the turn submission fails after activation", async () => {
    const harness = createQueryClientTestHarness();
    const storage = draftStorageHarness();
    vi.mocked(sdk.threads.rewind.preview).mockResolvedValue(eligiblePreview);
    vi.mocked(sdk.threads.rewind.commit).mockResolvedValue(
      draftRecoveryResponse(),
    );
    const { result } = renderHook(
      () =>
        useThreadRewindEditing({
          branchId: "br_1",
          onFocusComposer: vi.fn(),
          readDraft: storage.read,
          statusKey: "idle",
          threadId: "thr_1",
          writeDraft: storage.write,
        }),
      { wrapper: harness.wrapper },
    );
    act(() => result.current.beginRewind(target));
    await waitFor(() =>
      expect(result.current.session?.status).toBe("confirming"),
    );
    act(() =>
      result.current.commitRewind([
        { type: "text", text: "edited", mentions: [] },
      ]),
    );
    await waitFor(() =>
      expect(result.current.session?.status).toBe("draft-recovery"),
    );
    expect(storage.draft.text).toBe("Fix the sidebar overflow");
    expect(result.current.session?.message).toContain("send it again");
  });

  it("restores the pre-edit draft on cancel", async () => {
    const harness = createQueryClientTestHarness();
    const storage = draftStorageHarness();
    vi.mocked(sdk.threads.rewind.preview).mockResolvedValue(eligiblePreview);
    const { result } = renderHook(
      () =>
        useThreadRewindEditing({
          branchId: "br_1",
          onFocusComposer: vi.fn(),
          readDraft: storage.read,
          statusKey: "idle",
          threadId: "thr_1",
          writeDraft: storage.write,
        }),
      { wrapper: harness.wrapper },
    );
    act(() => result.current.beginRewind(target));
    await waitFor(() =>
      expect(result.current.session?.status).toBe("confirming"),
    );
    act(() => result.current.cancel());
    expect(result.current.session).toBeNull();
    expect(storage.draft.text).toBe("previous draft");
  });

  it("refuses to commit while the preview is stale", async () => {
    const harness = createQueryClientTestHarness();
    const storage = draftStorageHarness();
    vi.mocked(sdk.threads.rewind.preview).mockResolvedValue({
      ...eligiblePreview,
      eligibility: { reason: "thread-not-idle", status: "ineligible" },
    });
    const { result } = renderHook(
      () =>
        useThreadRewindEditing({
          branchId: "br_1",
          onFocusComposer: vi.fn(),
          readDraft: storage.read,
          statusKey: "idle",
          threadId: "thr_1",
          writeDraft: storage.write,
        }),
      { wrapper: harness.wrapper },
    );
    act(() => result.current.beginRewind(target));
    await waitFor(() => expect(result.current.session?.status).toBe("stale"));
    act(() =>
      result.current.commitRewind([
        { type: "text", text: "edited", mentions: [] },
      ]),
    );
    expect(sdk.threads.rewind.commit).not.toHaveBeenCalled();
  });

  it("revalidates when the thread status changes and reports stale previews", async () => {
    const harness = createQueryClientTestHarness();
    const storage = draftStorageHarness();
    vi.mocked(sdk.threads.rewind.preview)
      .mockResolvedValueOnce(eligiblePreview)
      .mockResolvedValueOnce({
        ...eligiblePreview,
        eligibility: { reason: "thread-not-idle", status: "ineligible" },
      });
    const { result, rerender } = renderHook(
      ({ statusKey }: { statusKey: string }) =>
        useThreadRewindEditing({
          branchId: "br_1",
          onFocusComposer: vi.fn(),
          readDraft: storage.read,
          statusKey,
          threadId: "thr_1",
          writeDraft: storage.write,
        }),
      {
        initialProps: { statusKey: "idle" },
        wrapper: harness.wrapper,
      },
    );
    act(() => result.current.beginRewind(target));
    await waitFor(() =>
      expect(result.current.session?.status).toBe("confirming"),
    );
    rerender({ statusKey: "active" });
    await waitFor(() => expect(result.current.session?.status).toBe("stale"));
    expect(result.current.session?.message).toContain("running");
  });
});
