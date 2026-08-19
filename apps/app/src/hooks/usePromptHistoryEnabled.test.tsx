// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POINTER_COARSE_QUERY } from "@bb/shared-ui/hooks/use-pointer-coarse";
import {
  resetKeyboardSeenForTests,
  usePromptHistoryEnabled,
} from "./usePromptHistoryEnabled";

function mockPointer(coarse: boolean) {
  vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
    matches: coarse && query === POINTER_COARSE_QUERY,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

function dispatchKeyDown(init: KeyboardEventInit) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", init));
  });
}

afterEach(() => {
  cleanup();
  resetKeyboardSeenForTests();
  vi.restoreAllMocks();
});

describe("usePromptHistoryEnabled", () => {
  it("keeps the eager fetch on fine-pointer devices", () => {
    mockPointer(false);
    const { result } = renderHook(() => usePromptHistoryEnabled());
    expect(result.current).toBe(true);
  });

  it("waits for a real keydown on coarse-pointer devices and ignores IME keys", () => {
    mockPointer(true);
    const { result } = renderHook(() => usePromptHistoryEnabled());
    expect(result.current).toBe(false);

    dispatchKeyDown({ key: "a", isComposing: true });
    expect(result.current).toBe(false);
    dispatchKeyDown({ key: "Process", keyCode: 229 });
    expect(result.current).toBe(false);

    dispatchKeyDown({ key: "a" });
    expect(result.current).toBe(true);
  });

  it("remembers the keyboard for later mounts", () => {
    mockPointer(true);
    const first = renderHook(() => usePromptHistoryEnabled());
    dispatchKeyDown({ key: "ArrowUp" });
    expect(first.result.current).toBe(true);
    first.unmount();

    const second = renderHook(() => usePromptHistoryEnabled());
    expect(second.result.current).toBe(true);
  });
});
