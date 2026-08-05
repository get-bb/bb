// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  matchesAppShortcut,
  type AppCommandContext,
  type AppKeybinding,
  type AppShortcut,
} from "@bb/domain";
import {
  formatAppShortcut,
  formatAppShortcutAria,
  isEditableKeyboardTarget,
  matchesAppCommandContext,
} from "./app-keybindings";

const MOD_N: AppShortcut = {
  key: "n",
  mod: true,
  meta: false,
  control: false,
  alt: false,
  shift: false,
};

const CONTEXT: AppCommandContext = {
  mainSurface: true,
  modalOpen: false,
  editableFocus: false,
  terminalFocus: false,
  browserFocus: false,
  modelPickerOpen: false,
  questionOpen: false,
  promptAvailable: false,
  splitActive: false,
  webSurface: false,
  macPlatform: false,
};

describe("app keybindings", () => {
  it("maps mod to the platform primary modifier and rejects extras", () => {
    const base = {
      key: "N",
      code: "KeyN",
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
    };
    expect(matchesAppShortcut(base, MOD_N, true)).toBe(true);
    expect(
      matchesAppShortcut(
        { ...base, metaKey: false, ctrlKey: true },
        MOD_N,
        false,
      ),
    ).toBe(true);
    expect(matchesAppShortcut({ ...base, shiftKey: true }, MOD_N, true)).toBe(
      false,
    );
  });

  it("matches shifted punctuation against its unshifted binding key", () => {
    expect(
      matchesAppShortcut(
        {
          key: "{",
          code: "BracketLeft",
          metaKey: true,
          ctrlKey: false,
          altKey: false,
          shiftKey: true,
        },
        { ...MOD_N, key: "[", shift: true },
        true,
      ),
    ).toBe(true);
  });

  // macOS composes Option+M into "µ", so an Alt chord that matched on `key`
  // alone would never fire there — the physical code carries the match instead.
  it("matches alt chords by physical key across platforms", () => {
    const ALT_M: AppShortcut = {
      key: "m",
      mod: false,
      meta: false,
      control: false,
      alt: true,
      shift: false,
    };
    expect(
      matchesAppShortcut(
        {
          key: "µ",
          code: "KeyM",
          metaKey: false,
          ctrlKey: false,
          altKey: true,
          shiftKey: false,
        },
        ALT_M,
        true,
      ),
    ).toBe(true);
    expect(
      matchesAppShortcut(
        {
          key: "m",
          code: "KeyM",
          metaKey: false,
          ctrlKey: false,
          altKey: true,
          shiftKey: false,
        },
        ALT_M,
        false,
      ),
    ).toBe(true);
    // A different physical key that happens to compose to "m" must not match.
    expect(
      matchesAppShortcut(
        {
          key: "m",
          code: "KeyK",
          metaKey: false,
          ctrlKey: false,
          altKey: true,
          shiftKey: false,
        },
        ALT_M,
        true,
      ),
    ).toBe(false);
  });

  it("requires every positive context and excludes every negative context", () => {
    const binding: AppKeybinding = {
      command: "diff.toggle",
      desktopOnly: false,
      shortcut: MOD_N,
      when: {
        all: ["mainSurface"],
        none: ["editableFocus", "terminalFocus"],
      },
    };
    expect(matchesAppCommandContext(binding, CONTEXT)).toBe(true);
    expect(
      matchesAppCommandContext(binding, { ...CONTEXT, editableFocus: true }),
    ).toBe(false);
    expect(
      matchesAppCommandContext(binding, { ...CONTEXT, mainSurface: false }),
    ).toBe(false);
  });

  it("recognizes form controls and contenteditable descendants", () => {
    const input = document.createElement("input");
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    const child = document.createElement("span");
    editor.append(child);
    expect(isEditableKeyboardTarget(input)).toBe(true);
    expect(isEditableKeyboardTarget(child)).toBe(true);
    expect(isEditableKeyboardTarget(document.createElement("button"))).toBe(
      false,
    );
  });

  it("formats platform-specific shortcut labels", () => {
    expect(formatAppShortcut(MOD_N, "MacIntel")).toBe("⌘ N");
    expect(formatAppShortcut(MOD_N, "Win32")).toBe("Ctrl + N");
    expect(formatAppShortcutAria(MOD_N, "MacIntel")).toBe("Meta+N");
    expect(formatAppShortcutAria(MOD_N, "Win32")).toBe("Control+N");
  });
});
