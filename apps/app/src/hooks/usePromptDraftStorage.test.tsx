// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import type { PromptTextMention } from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  usePromptDraftHasInput,
  usePromptDraftStorage,
} from "./usePromptDraftStorage";
import type { PromptDraftAttachment } from "@/lib/prompt-draft";

const PROJECT_DRAFT_SCOPE = {
  projectId: "proj-1",
  threadId: null,
};
const THREAD_DRAFT_SCOPE = {
  projectId: "proj-1",
  threadId: "thr-1",
};
const DRAFT_ATTACHMENT: PromptDraftAttachment = {
  type: "localFile",
  path: "/tmp/spec.md",
  name: "spec.md",
  sizeBytes: 42,
  mimeType: "text/markdown",
};
const DRAFT_MENTION: PromptTextMention = {
  start: 0,
  end: 7,
  resource: {
    kind: "thread",
    threadId: "thr_prompt",
    projectId: "proj-1",
    label: "Prompt review",
  },
};

afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  cleanup();
  vi.useRealTimers();
  window.localStorage.clear();
});

function requireStorageKey(storageKey: string | null): string {
  if (!storageKey) {
    throw new Error("Expected prompt draft storage key");
  }
  return storageKey;
}

describe("usePromptDraftStorage", () => {
  it("clears the draft when it still matches the submitted snapshot", () => {
    const { result } = renderHook(() =>
      usePromptDraftStorage(PROJECT_DRAFT_SCOPE),
    );

    act(() => {
      result.current.setTextAndMentions("Investigate the outage", []);
    });

    const submittedDraft = result.current.getCurrent();
    let didClear = false;

    act(() => {
      didClear = result.current.clearIfCurrentMatches(submittedDraft);
    });

    expect(didClear).toBe(true);
    expect(result.current.getCurrent()).toEqual({
      attachments: [],
      mentions: [],
      text: "",
    });
  });

  it("preserves newer edits when clearing against a stale submitted snapshot", () => {
    const { result } = renderHook(() =>
      usePromptDraftStorage(PROJECT_DRAFT_SCOPE),
    );

    act(() => {
      result.current.setTextAndMentions("Investigate the outage", []);
    });

    const submittedDraft = result.current.getCurrent();

    act(() => {
      result.current.setTextAndMentions(
        "Investigate the outage and summarize root cause",
        [],
      );
    });

    let didClear = false;

    act(() => {
      didClear = result.current.clearIfCurrentMatches(submittedDraft);
    });

    expect(didClear).toBe(false);
    expect(result.current.getCurrent()).toEqual({
      attachments: [],
      mentions: [],
      text: "Investigate the outage and summarize root cause",
    });
  });

  it("keeps text current immediately while deferring localStorage persistence", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      usePromptDraftStorage(PROJECT_DRAFT_SCOPE),
    );
    const storageKey = requireStorageKey(result.current.storageKey);

    act(() => {
      result.current.setTextAndMentions("Investigate the outage", []);
    });

    expect(result.current.getCurrent()).toEqual({
      attachments: [],
      mentions: [],
      text: "Investigate the outage",
    });
    expect(window.localStorage.getItem(storageKey)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(window.localStorage.getItem(storageKey)).toBe(
      '{"text":"Investigate the outage","attachments":[]}',
    );
  });

  it("serializes and hydrates non-empty mention ranges", () => {
    vi.useFakeTimers();
    const mention: PromptTextMention = {
      start: 4,
      end: 22,
      resource: {
        kind: "thread",
        threadId: "thr_prompt",
        projectId: "proj-1",
        label: "Prompt review",
      },
    };
    const text = "Ask @thread:thr_prompt to review";
    const { result, unmount } = renderHook(() =>
      usePromptDraftStorage(PROJECT_DRAFT_SCOPE),
    );
    const storageKey = requireStorageKey(result.current.storageKey);

    act(() => {
      result.current.setTextAndMentions(text, [mention]);
    });
    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(window.localStorage.getItem(storageKey)).toBe(
      JSON.stringify({
        text,
        mentions: [mention],
        attachments: [],
      }),
    );

    unmount();
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: storageKey }));
    });
    const hydrated = renderHook(() =>
      usePromptDraftStorage(PROJECT_DRAFT_SCOPE),
    );

    expect(hydrated.result.current.getCurrent()).toEqual({
      text,
      mentions: [mention],
      attachments: [],
    });
  });

  it("flushes pending text persistence on pagehide", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      usePromptDraftStorage(PROJECT_DRAFT_SCOPE),
    );
    const storageKey = requireStorageKey(result.current.storageKey);

    act(() => {
      result.current.setTextAndMentions("Investigate the outage", []);
    });

    expect(window.localStorage.getItem(storageKey)).toBeNull();

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });

    expect(window.localStorage.getItem(storageKey)).toBe(
      '{"text":"Investigate the outage","attachments":[]}',
    );
  });

  it("flushes pending text persistence when the document is hidden", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      usePromptDraftStorage(PROJECT_DRAFT_SCOPE),
    );
    const storageKey = requireStorageKey(result.current.storageKey);

    act(() => {
      result.current.setTextAndMentions("Investigate the outage", []);
    });

    expect(window.localStorage.getItem(storageKey)).toBeNull();

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(window.localStorage.getItem(storageKey)).toBe(
      '{"text":"Investigate the outage","attachments":[]}',
    );
  });

  it("does not persist stale deferred text after an immediate clear", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      usePromptDraftStorage(PROJECT_DRAFT_SCOPE),
    );
    const storageKey = requireStorageKey(result.current.storageKey);

    act(() => {
      result.current.setTextAndMentions("Investigate the outage", []);
      result.current.clear();
    });

    expect(result.current.getCurrent()).toEqual({
      attachments: [],
      mentions: [],
      text: "",
    });
    expect(window.localStorage.getItem(storageKey)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(window.localStorage.getItem(storageKey)).toBeNull();
  });

  it("reports whether a thread prompt draft has input", () => {
    const draft = renderHook(() => usePromptDraftStorage(THREAD_DRAFT_SCOPE));
    const hasInput = renderHook(() => usePromptDraftHasInput(THREAD_DRAFT_SCOPE));

    expect(hasInput.result.current).toBe(false);

    act(() => {
      draft.result.current.setTextAndMentions("Continue the review", []);
    });

    expect(hasInput.result.current).toBe(true);

    act(() => {
      draft.result.current.clear();
    });

    expect(hasInput.result.current).toBe(false);

    act(() => {
      draft.result.current.setDraft({
        text: "",
        mentions: [],
        attachments: [DRAFT_ATTACHMENT],
      });
    });

    expect(hasInput.result.current).toBe(true);

    act(() => {
      draft.result.current.clear();
    });

    expect(hasInput.result.current).toBe(false);

    act(() => {
      draft.result.current.setDraft({
        text: "",
        mentions: [DRAFT_MENTION],
        attachments: [],
      });
    });

    expect(hasInput.result.current).toBe(true);
  });
});
