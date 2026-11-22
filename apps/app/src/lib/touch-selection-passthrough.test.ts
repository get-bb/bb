// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installTouchSelectionPassthrough,
  TOUCH_SELECTION_TAP_SETTLE_MS,
  TOUCH_TEXT_SELECTION_ATTRIBUTE,
} from "./touch-selection-passthrough";

let uninstall: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = "<p>first paragraph</p><p>second paragraph</p>";
  uninstall = installTouchSelectionPassthrough(document);
});

afterEach(() => {
  uninstall?.();
  uninstall = null;
  document.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
  vi.useRealTimers();
});

function pointer(
  type: "pointerdown" | "pointerup" | "pointercancel",
  pointerType: string,
  pointerId = 1,
) {
  document.body.dispatchEvent(
    new PointerEvent(type, { bubbles: true, pointerId, pointerType }),
  );
}

function selectWord() {
  const text = document.querySelector("p")?.firstChild;
  if (!text) throw new Error("missing text");
  document.getSelection()?.setBaseAndExtent(text, 0, text, 5);
  document.dispatchEvent(new Event("selectionchange"));
}

function passesThrough(): boolean {
  return document.documentElement.hasAttribute(TOUCH_TEXT_SELECTION_ATTRIBUTE);
}

describe("installTouchSelectionPassthrough", () => {
  it("lets overlays pass through once a long press has made a selection and the tap window has passed", () => {
    pointer("pointerdown", "touch");
    selectWord();
    pointer("pointercancel", "touch");
    expect(passesThrough()).toBe(false);

    vi.advanceTimersByTime(TOUCH_SELECTION_TAP_SETTLE_MS);
    expect(passesThrough()).toBe(true);
  });

  it("makes overlays hit-testable again as soon as a finger touches down, so a tap on them lands", () => {
    pointer("pointerdown", "touch");
    selectWord();
    pointer("pointercancel", "touch");
    vi.advanceTimersByTime(TOUCH_SELECTION_TAP_SETTLE_MS);

    pointer("pointerdown", "touch", 2);
    expect(passesThrough()).toBe(false);
    pointer("pointerup", "touch", 2);
    expect(passesThrough()).toBe(false);
    vi.advanceTimersByTime(TOUCH_SELECTION_TAP_SETTLE_MS);
    expect(passesThrough()).toBe(true);
  });

  it("stops passing through when the selection collapses", () => {
    pointer("pointerdown", "touch");
    selectWord();
    pointer("pointerup", "touch");
    vi.advanceTimersByTime(TOUCH_SELECTION_TAP_SETTLE_MS);
    expect(passesThrough()).toBe(true);

    document.getSelection()?.removeAllRanges();
    document.dispatchEvent(new Event("selectionchange"));
    expect(passesThrough()).toBe(false);
  });

  it("never passes through for mouse selections", () => {
    pointer("pointerdown", "mouse");
    selectWord();
    pointer("pointerup", "mouse");
    vi.advanceTimersByTime(TOUCH_SELECTION_TAP_SETTLE_MS);
    document.dispatchEvent(new Event("selectionchange"));

    expect(passesThrough()).toBe(false);
  });
});
