// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { usePromptDraftStorage } from "./usePromptDraftStorage";

// Each test uses a unique projectId so the module-level draft cache/subscriber
// maps (keyed by storage key) never collide across tests.
let scopeCounter = 0;
function uniqueScope() {
  scopeCounter += 1;
  return { projectId: `proj-quote-test-${scopeCounter}`, threadId: "thr-1" };
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
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
