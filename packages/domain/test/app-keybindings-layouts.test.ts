import { describe, expect, it } from "vitest";
import {
  matchesAppShortcut,
  normalizeAppShortcutInputKey,
  type AppShortcut,
  type AppShortcutInput,
} from "../src/app-keybindings.js";

function shortcut(key: string, modifiers: Partial<AppShortcut> = {}) {
  return {
    key,
    mod: false,
    meta: false,
    control: false,
    alt: false,
    shift: false,
    ...modifiers,
  };
}

function press(
  key: string,
  code: string,
  modifiers: Partial<AppShortcutInput> = {},
): AppShortcutInput {
  return {
    key,
    code,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...modifiers,
  };
}

const ctrl = { ctrlKey: true };
const ctrlShift = { ctrlKey: true, shiftKey: true };

describe("app shortcut keys across keyboard layouts", () => {
  it.each([
    { layout: "US", input: press("k", "KeyK", ctrl), key: "k" },
    { layout: "Russian", input: press("л", "KeyK", ctrl), key: "k" },
    { layout: "Russian", input: press("З", "KeyP", ctrlShift), key: "p" },
    {
      layout: "Russian",
      input: press("Х", "BracketLeft", ctrlShift),
      key: "[",
    },
    {
      layout: "Russian",
      input: press("Ъ", "BracketRight", ctrlShift),
      key: "]",
    },
    { layout: "Russian", input: press("б", "Comma", ctrl), key: "," },
    { layout: "Russian", input: press("1", "Digit1", ctrl), key: "1" },
    { layout: "Ukrainian", input: press("і", "KeyS", ctrl), key: "s" },
    { layout: "Greek", input: press("κ", "KeyK", ctrl), key: "k" },
    { layout: "Greek", input: press("ς", "KeyW", ctrl), key: "w" },
    { layout: "Hebrew", input: press("ל", "KeyK", ctrl), key: "k" },
    { layout: "Hebrew", input: press("/", "KeyQ", ctrl), key: "/" },
    { layout: "Arabic", input: press("ن", "KeyK", ctrl), key: "k" },
    { layout: "Arabic", input: press("١", "Digit1", ctrl), key: "1" },
    { layout: "Dvorak", input: press("k", "KeyV", ctrl), key: "k" },
    { layout: "Colemak", input: press("e", "KeyK", ctrl), key: "e" },
    { layout: "AZERTY", input: press("a", "KeyQ", ctrl), key: "a" },
    { layout: "AZERTY", input: press("&", "Digit1", ctrl), key: "&" },
    { layout: "QWERTZ", input: press("z", "KeyY", ctrl), key: "z" },
    { layout: "QWERTZ", input: press("ü", "BracketLeft", ctrl), key: "ü" },
    { layout: "Turkish", input: press("ı", "KeyI", ctrl), key: "ı" },
  ])("$layout $input.key on $input.code is $key", ({ input, key }) => {
    expect(normalizeAppShortcutInputKey(input).toLowerCase()).toBe(key);
  });

  it.each([
    { layout: "Russian", input: press("л", "KeyK", ctrl) },
    { layout: "Greek", input: press("κ", "KeyK", ctrl) },
    { layout: "Hebrew", input: press("ל", "KeyK", ctrl) },
    { layout: "Arabic", input: press("ن", "KeyK", ctrl) },
    { layout: "Dvorak", input: press("k", "KeyV", ctrl) },
  ])("$layout fires Ctrl+K", ({ input }) => {
    expect(matchesAppShortcut(input, shortcut("k", { mod: true }), false)).toBe(
      true,
    );
  });

  it("keeps Latin layouts on their own letters", () => {
    expect(
      matchesAppShortcut(
        press("k", "KeyV", ctrl),
        shortcut("v", { mod: true }),
        false,
      ),
    ).toBe(false);
    expect(
      matchesAppShortcut(
        press("e", "KeyK", ctrl),
        shortcut("k", { mod: true }),
        false,
      ),
    ).toBe(false);
    expect(
      matchesAppShortcut(
        press("ü", "BracketLeft", ctrlShift),
        shortcut("[", { mod: true, shift: true }),
        false,
      ),
    ).toBe(false);
  });

  it("fires Mod+Shift+[ from the Cyrillic Х position on macOS", () => {
    expect(
      matchesAppShortcut(
        press("Х", "BracketLeft", { metaKey: true, shiftKey: true }),
        shortcut("[", { mod: true, shift: true }),
        true,
      ),
    ).toBe(true);
  });

  it("still matches shortcuts saved under a non-Latin character", () => {
    expect(
      matchesAppShortcut(
        press("л", "KeyK", ctrl),
        shortcut("л", { mod: true }),
        false,
      ),
    ).toBe(true);
  });

  it.each([
    {
      layout: "Polish",
      input: press("ą", "KeyA", { ctrlKey: true, altKey: true }),
    },
    {
      layout: "German",
      input: press("@", "KeyQ", { ctrlKey: true, altKey: true }),
    },
    {
      layout: "Serbian",
      input: press("ђ", "BracketLeft", { ctrlKey: true, altKey: true }),
    },
  ])(
    "does not turn Windows AltGr text on $layout into Ctrl or Alt shortcuts",
    ({ input }) => {
      const physical = normalizeAppShortcutInputKey(input);
      for (const modifiers of [
        { mod: true },
        { alt: true },
        { control: true },
      ]) {
        expect(
          matchesAppShortcut(input, shortcut(physical, modifiers), false),
        ).toBe(false);
      }
    },
  );

  it("keeps macOS Option compositions on the physical key", () => {
    expect(
      matchesAppShortcut(
        press("π", "KeyP", { altKey: true }),
        shortcut("p", { alt: true }),
        true,
      ),
    ).toBe(true);
    expect(
      matchesAppShortcut(
        press("π", "KeyP", { altKey: true }),
        shortcut("π", { alt: true }),
        true,
      ),
    ).toBe(false);
  });
});
