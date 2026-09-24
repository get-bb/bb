// @vitest-environment jsdom
// bb-fork(quiet-reparent): fork-owned coverage for the quiet reparent preference
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useQuietReparentPreference } from "./quiet-reparent.fork";

const STORAGE_KEY = "bb.thread-parent-quiet-reparent";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("useQuietReparentPreference", () => {
  it("defaults to notify when nothing is stored", () => {
    const { result } = renderHook(() => useQuietReparentPreference());
    expect(result.current[0]).toBe(false);
  });

  it("restores the stored quiet choice", () => {
    window.localStorage.setItem(STORAGE_KEY, "true");
    const { result } = renderHook(() => useQuietReparentPreference());
    expect(result.current[0]).toBe(true);
  });

  it("persists updates to localStorage", () => {
    const { result } = renderHook(() => useQuietReparentPreference());
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("true");
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("false");
  });
});
