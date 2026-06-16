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

describe("usePromptDraftStorage quotes", () => {
  it("addQuote appends a trimmed quote and persists to storage", () => {
    const scope = uniqueScope();
    const { result } = renderHook(() => usePromptDraftStorage(scope));

    act(() => result.current.addQuote("  ship it  "));

    expect(result.current.quotes).toHaveLength(1);
    expect(result.current.quotes[0]?.text).toBe("ship it");
    // The immediate write reached localStorage.
    expect(window.localStorage.length).toBe(1);
    const stored = window.localStorage.getItem(result.current.storageKey ?? "");
    expect(stored).toContain("ship it");
  });

  it("addQuote ignores whitespace-only text without writing", () => {
    const scope = uniqueScope();
    const { result } = renderHook(() => usePromptDraftStorage(scope));

    act(() => result.current.addQuote("   \n  "));

    expect(result.current.quotes).toEqual([]);
    expect(window.localStorage.length).toBe(0);
  });

  it("syncs an added quote live across two instances of the same scope", () => {
    const scope = uniqueScope();
    const first = renderHook(() => usePromptDraftStorage(scope));
    const second = renderHook(() => usePromptDraftStorage(scope));

    act(() => first.result.current.addQuote("shared selection"));

    expect(second.result.current.quotes).toHaveLength(1);
    expect(second.result.current.quotes[0]?.text).toBe("shared selection");
  });

  it("removeQuote removes by id; an unknown id is a no-op", () => {
    const scope = uniqueScope();
    const { result } = renderHook(() => usePromptDraftStorage(scope));

    act(() => result.current.addQuote("keep then drop"));
    const id = result.current.quotes[0]?.id ?? "";
    const storedAfterAdd = window.localStorage.getItem(
      result.current.storageKey ?? "",
    );

    // Unknown id changes nothing (no write).
    act(() => result.current.removeQuote("does-not-exist"));
    expect(result.current.quotes).toHaveLength(1);
    expect(window.localStorage.getItem(result.current.storageKey ?? "")).toBe(
      storedAfterAdd,
    );

    // Real id removes and clears the now-empty draft from storage.
    act(() => result.current.removeQuote(id));
    expect(result.current.quotes).toEqual([]);
    expect(window.localStorage.length).toBe(0);
  });
});
