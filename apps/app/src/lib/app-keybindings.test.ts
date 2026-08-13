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
  isNativeEditableKeyEvent,
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

const ALT_P: AppShortcut = {
  key: "p",
  mod: false,
  meta: false,
  control: false,
  alt: true,
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

  // macOS composes Option+letter chords, so matching on `key` alone would never
  // fire the composer cycles there — the physical code carries the match.
  it.each([
    ["m", "µ", "KeyM"],
    ["p", "π", "KeyP"],
    ["t", "†", "KeyT"],
  ])("matches Alt+%s by physical key when macOS reports %s", (key, composed, code) => {
    const shortcut: AppShortcut = {
      key,
      mod: false,
      meta: false,
      control: false,
      alt: true,
      shift: false,
    };
    expect(
      matchesAppShortcut(
        {
          key: composed,
          code,
          metaKey: false,
          ctrlKey: false,
          altKey: true,
          shiftKey: false,
        },
        shortcut,
        true,
      ),
    ).toBe(true);
  });

  it("matches shifted Alt cycles by physical key when macOS composes the key", () => {
    expect(
      matchesAppShortcut(
        {
          key: "composed",
          code: "KeyM",
          metaKey: false,
          ctrlKey: false,
          altKey: true,
          shiftKey: true,
        },
        { ...ALT_P, key: "m", shift: true },
        true,
      ),
    ).toBe(true);
  });

  it("matches an uncomposed alt chord by key across platforms", () => {
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
        { ...ALT_P, key: "m" },
        false,
      ),
    ).toBe(true);
    // A non-US layout still reports a plain letter for Alt chords. AZERTY
    // Alt+A is key "a" on physical KeyQ — it must keep matching the character
    // the user sees, not the physical key underneath it.
    expect(
      matchesAppShortcut(
        {
          key: "a",
          code: "KeyQ",
          metaKey: false,
          ctrlKey: false,
          altKey: true,
          shiftKey: false,
        },
        { ...ALT_P, key: "a" },
        false,
      ),
    ).toBe(true);
    expect(
      matchesAppShortcut(
        {
          key: "a",
          code: "KeyQ",
          metaKey: false,
          ctrlKey: false,
          altKey: true,
          shiftKey: false,
        },
        { ...ALT_P, key: "q" },
        false,
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

  it("recognizes native navigation and deletion keys in editable controls", () => {
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    document.body.append(editor);

    for (const key of [
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "Backspace",
      "Delete",
      "End",
      "Home",
      "PageDown",
      "PageUp",
    ]) {
      const event = new KeyboardEvent("keydown", {
        altKey: true,
        bubbles: true,
        ctrlKey: true,
        key,
        metaKey: true,
        shiftKey: true,
      });
      editor.dispatchEvent(event);
      expect(isNativeEditableKeyEvent(event), key).toBe(true);
    }

    const formattingEvent = new KeyboardEvent("keydown", {
      bubbles: true,
      key: "B",
      metaKey: true,
      shiftKey: true,
    });
    editor.dispatchEvent(formattingEvent);
    expect(isNativeEditableKeyEvent(formattingEvent)).toBe(false);

    const outsideEvent = new KeyboardEvent("keydown", {
      bubbles: true,
      key: "ArrowUp",
      metaKey: true,
      shiftKey: true,
    });
    document.body.dispatchEvent(outsideEvent);
    expect(isNativeEditableKeyEvent(outsideEvent)).toBe(false);

    editor.remove();
  });

  it("formats platform-specific shortcut labels", () => {
    expect(formatAppShortcut(MOD_N, "MacIntel")).toBe("⌘ N");
    expect(formatAppShortcut(MOD_N, "Win32")).toBe("Ctrl + N");
    expect(formatAppShortcutAria(MOD_N, "MacIntel")).toBe("Meta+N");
    expect(formatAppShortcutAria(MOD_N, "Win32")).toBe("Control+N");

    expect(formatAppShortcut(ALT_P, "MacIntel")).toBe("⌥ P");
    expect(formatAppShortcut(ALT_P, "Win32")).toBe("Alt + P");
    expect(formatAppShortcutAria(ALT_P, "MacIntel")).toBe("Alt+P");
  });
});
