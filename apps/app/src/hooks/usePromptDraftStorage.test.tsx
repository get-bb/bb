// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { usePromptDraftStorage } from "./usePromptDraftStorage";

const NEW_THREAD_DRAFT_KEY = "bb.promptbox.contents-draft-3";
const LEGACY_PROJECT_DRAFT_KEY = "bb.promptbox.contents-proj_prompt-draft-3";

function storedDraft(text: string): string {
  return JSON.stringify({ text, attachments: [] });
}

// Each test uses a unique projectId so the module-level draft cache/subscriber
// maps (keyed by storage key) never collide across tests.
let scopeCounter = 0;
function uniqueScope() {
  scopeCounter += 1;
  return {
    kind: "thread" as const,
    projectId: `proj-quote-test-${scopeCounter}`,
    threadId: "thr-1",
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("usePromptDraftStorage", () => {
  it("uses project-agnostic storage for new-thread prompt contents", () => {
    window.localStorage.setItem(
      LEGACY_PROJECT_DRAFT_KEY,
      storedDraft("project draft"),
    );
    window.localStorage.setItem(NEW_THREAD_DRAFT_KEY, storedDraft("global draft"));

    const { result } = renderHook(() =>
      usePromptDraftStorage({ kind: "new-thread" }),
    );

    expect(result.current.storageKey).toBe(NEW_THREAD_DRAFT_KEY);
    expect(result.current.text).toBe("global draft");

    act(() => {
      result.current.setDraft({
        text: "updated global draft",
        mentions: [],
        attachments: [],
      });
    });

    expect(window.localStorage.getItem(NEW_THREAD_DRAFT_KEY)).toBe(
      storedDraft("updated global draft"),
    );
    expect(window.localStorage.getItem(LEGACY_PROJECT_DRAFT_KEY)).toBe(
      storedDraft("project draft"),
    );
  });

  it("keeps thread follow-up drafts scoped to the thread", () => {
    const { result } = renderHook(() =>
      usePromptDraftStorage({
        kind: "thread",
        projectId: "proj_prompt",
        threadId: "thr_followup",
      }),
    );

    expect(result.current.storageKey).toBe(
      "bb.promptbox.contents-proj_prompt-thr_followup-3",
    );
  });
});

describe("usePromptDraftStorage addQuote", () => {
  it("appends a trimmed quote as a '> ' block to the draft text and persists", () => {
    const scope = uniqueScope();
    const { result } = renderHook(() => usePromptDraftStorage(scope));

    act(() => result.current.addQuote("  ship it  "));

    // Blockquote-prefixed, with a trailing newline so the reply sits below it.
    expect(result.current.text).toBe("> ship it\n");
    expect(window.localStorage.length).toBe(1);
    expect(window.localStorage.getItem(result.current.storageKey ?? "")).toContain(
      "> ship it",
    );
  });

  it("stacks a second quote below the first, separated by a blank line", () => {
    const scope = uniqueScope();
    const { result } = renderHook(() => usePromptDraftStorage(scope));

    act(() => result.current.addQuote("first"));
    act(() => result.current.addQuote("second"));

    expect(result.current.text).toBe("> first\n\n> second\n");
  });

  it("prefixes every line of a multi-line selection", () => {
    const scope = uniqueScope();
    const { result } = renderHook(() => usePromptDraftStorage(scope));

    act(() => result.current.addQuote("line a\nline b"));

    expect(result.current.text).toBe("> line a\n> line b\n");
  });

  it("adds quote attachments to the draft and persists them", () => {
    const scope = uniqueScope();
    const { result } = renderHook(() => usePromptDraftStorage(scope));

    act(() =>
      result.current.addQuote("review this", [
        {
          type: "localFile",
          path: "uploads/spec.md",
          name: "spec.md",
          sizeBytes: 0,
        },
      ]),
    );

    expect(result.current.text).toBe("> review this\n");
    expect(result.current.attachments).toEqual([
      {
        type: "localFile",
        path: "uploads/spec.md",
        name: "spec.md",
        sizeBytes: 0,
      },
    ]);
    expect(window.localStorage.getItem(result.current.storageKey ?? "")).toContain(
      "uploads/spec.md",
    );
  });

  it("ignores whitespace-only text without writing", () => {
    const scope = uniqueScope();
    const { result } = renderHook(() => usePromptDraftStorage(scope));

    act(() => result.current.addQuote("   \n  "));

    expect(result.current.text).toBe("");
    expect(window.localStorage.length).toBe(0);
  });

  it("syncs an added quote live across two instances of the same scope", () => {
    const scope = uniqueScope();
    const first = renderHook(() => usePromptDraftStorage(scope));
    const second = renderHook(() => usePromptDraftStorage(scope));

    act(() => first.result.current.addQuote("shared selection"));

    expect(second.result.current.text).toBe("> shared selection\n");
  });
});
