import { describe, expect, it } from "vitest";
import { isModifierSubmitKeyEvent } from "./modifier-submit-key";

describe("isModifierSubmitKeyEvent", () => {
  it("accepts Control+Enter and Meta+Enter without other modifiers", () => {
    const base = {
      key: "Enter",
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
    };
    expect(isModifierSubmitKeyEvent({ ...base, ctrlKey: true })).toBe(true);
    expect(isModifierSubmitKeyEvent({ ...base, metaKey: true })).toBe(true);
    expect(isModifierSubmitKeyEvent(base)).toBe(false);
    expect(
      isModifierSubmitKeyEvent({ ...base, ctrlKey: true, shiftKey: true }),
    ).toBe(false);
    expect(
      isModifierSubmitKeyEvent({ ...base, metaKey: true, altKey: true }),
    ).toBe(false);
    expect(isModifierSubmitKeyEvent({ ...base, key: "a", ctrlKey: true })).toBe(
      false,
    );
  });
});
