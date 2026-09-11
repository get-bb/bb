import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isModifierSubmitKeyEvent,
  modifierSubmitShortcutAria,
  modifierSubmitShortcutLabel,
} from "./modifier-submit-shortcut";

function mockPlatform(platform: string): () => void {
  const originalNavigator = globalThis.navigator;
  vi.stubGlobal("navigator", { ...originalNavigator, platform });
  return () => vi.unstubAllGlobals();
}

describe("modifier submit shortcut", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

  it("presents the shortcut as Control on Windows and Linux", () => {
    mockPlatform("Linux x86_64");
    expect(modifierSubmitShortcutLabel()).toBe("Ctrl + Enter");
    expect(modifierSubmitShortcutAria()).toBe("Control+Enter");
  });

  it("presents the shortcut as Command on Mac", () => {
    mockPlatform("MacIntel");
    expect(modifierSubmitShortcutLabel()).toBe("⌘ Enter");
    expect(modifierSubmitShortcutAria()).toBe("Meta+Enter");
  });
});
