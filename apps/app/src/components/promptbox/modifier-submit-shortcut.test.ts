import { afterEach, describe, expect, it, vi } from "vitest";
import {
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
