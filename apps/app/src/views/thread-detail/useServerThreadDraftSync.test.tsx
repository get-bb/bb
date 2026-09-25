// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PromptInput, ThreadStatus } from "@bb/domain";
import { emptyPromptDraftState, type PromptDraftState } from "@bb/client-core";
import {
  SERVER_THREAD_DRAFT_SAVE_DELAY_MS,
  threadDraftKey,
  useServerThreadDraftSync,
} from "./useServerThreadDraftSync";

const mocks = vi.hoisted(() => ({
  updateDraftMutate: vi.fn(),
}));

vi.mock("@/hooks/mutations/thread-runtime-mutations", () => ({
  useUpdateThreadDraft: () => ({
    isPending: false,
    mutate: mocks.updateDraftMutate,
  }),
}));

interface HookProps {
  archived?: boolean;
  serverDraft: PromptInput[] | null;
  status: ThreadStatus;
  threadId?: string;
}

function text(value: string): PromptInput {
  return { type: "text", text: value, mentions: [] };
}

function draft(value: string): PromptDraftState {
  return { text: value, mentions: [], attachments: [] };
}

function renderSync(
  initialProps: HookProps,
  initialLocal: PromptDraftState = emptyPromptDraftState(),
) {
  return renderHook(
    ({ archived = false, serverDraft, status, threadId = "thr_draft" }) => {
      const [localDraft, setLocalDraft] = useState(initialLocal);
      useServerThreadDraftSync({
        threadId,
        status,
        archived,
        serverDraft,
        localDraft,
        setLocalDraft,
      });
      return { localDraft, setLocalDraft };
    },
    { initialProps },
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.updateDraftMutate.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useServerThreadDraftSync", () => {
  it("shows the server draft in an empty composer without saving it back", () => {
    const { result } = renderSync({
      serverDraft: [text("Saved elsewhere")],
      status: "pending",
    });

    expect(result.current.localDraft.text).toBe("Saved elsewhere");
    act(() => vi.advanceTimersByTime(SERVER_THREAD_DRAFT_SAVE_DELAY_MS * 2));
    expect(mocks.updateDraftMutate).not.toHaveBeenCalled();
  });

  it("saves edits to a pending thread after the typing pause", () => {
    const { result } = renderSync({ serverDraft: null, status: "pending" });

    act(() => result.current.setLocalDraft(draft("New idea")));
    act(() => vi.advanceTimersByTime(SERVER_THREAD_DRAFT_SAVE_DELAY_MS - 1));
    expect(mocks.updateDraftMutate).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));

    expect(mocks.updateDraftMutate).toHaveBeenCalledWith({
      id: "thr_draft",
      input: [text("New idea")],
    });
  });

  it("keeps newer local typing when the server echoes an earlier save", () => {
    const { result, rerender } = renderSync({
      serverDraft: [text("One")],
      status: "pending",
    });

    act(() => result.current.setLocalDraft(draft("One two")));
    act(() => vi.advanceTimersByTime(SERVER_THREAD_DRAFT_SAVE_DELAY_MS));
    act(() => result.current.setLocalDraft(draft("One two three")));
    rerender({ serverDraft: [text("One two")], status: "pending" });

    expect(result.current.localDraft.text).toBe("One two three");
    act(() => vi.advanceTimersByTime(SERVER_THREAD_DRAFT_SAVE_DELAY_MS));
    expect(mocks.updateDraftMutate).toHaveBeenLastCalledWith({
      id: "thr_draft",
      input: [text("One two three")],
    });
  });

  it("clears the server draft right away once the composer is emptied by a send", () => {
    const { result, rerender } = renderSync({
      serverDraft: [text("Ship it")],
      status: "pending",
    });

    act(() => result.current.setLocalDraft(emptyPromptDraftState()));
    rerender({ serverDraft: [text("Ship it")], status: "starting" });
    act(() => vi.advanceTimersByTime(0));

    expect(mocks.updateDraftMutate).toHaveBeenCalledWith({
      id: "thr_draft",
      input: [],
    });
  });

  it("follows another device's edits while the local composer is unchanged", () => {
    const { result, rerender } = renderSync({
      serverDraft: [text("Before")],
      status: "pending",
    });

    rerender({ serverDraft: [text("After")], status: "pending" });
    expect(result.current.localDraft.text).toBe("After");

    rerender({ serverDraft: null, status: "starting" });
    expect(result.current.localDraft.text).toBe("");
    expect(mocks.updateDraftMutate).not.toHaveBeenCalled();
  });

  it("leaves ordinary thread composers local-only", () => {
    const { result } = renderSync({ serverDraft: null, status: "idle" });

    act(() => result.current.setLocalDraft(draft("Follow-up")));
    act(() => vi.advanceTimersByTime(SERVER_THREAD_DRAFT_SAVE_DELAY_MS * 2));

    expect(mocks.updateDraftMutate).not.toHaveBeenCalled();
  });

  it("saves an unsaved edit when the composer unmounts", () => {
    const { result, unmount } = renderSync({
      serverDraft: null,
      status: "pending",
    });

    act(() => result.current.setLocalDraft(draft("Leaving now")));
    unmount();

    expect(mocks.updateDraftMutate).toHaveBeenCalledWith({
      id: "thr_draft",
      input: [text("Leaving now")],
    });
  });
});

describe("threadDraftKey", () => {
  it("treats key order and joined text blocks as the same draft", () => {
    const serverShape: PromptInput[] = [
      { mentions: [], text: "Hello", type: "text" },
    ];
    expect(threadDraftKey(serverShape)).toBe(threadDraftKey([text("Hello")]));
    expect(threadDraftKey([])).toBe("");
    expect(threadDraftKey(null)).toBe("");
  });
});
