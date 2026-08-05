import { describe, expect, it } from "vitest";
import type { AppKeybindings } from "@bb/domain";
import { resolveDesktopBrowserAppCommand } from "../src/desktop-browser-shortcuts.js";

const keybindings: AppKeybindings = [
  {
    command: "thread.search",
    desktopOnly: false,
    shortcut: {
      key: "k",
      mod: true,
      meta: false,
      control: false,
      alt: false,
      shift: false,
    },
    when: { all: ["mainSurface"], none: [] },
  },
  {
    command: "browser.focusLocation",
    desktopOnly: true,
    shortcut: {
      key: "l",
      mod: true,
      meta: false,
      control: false,
      alt: false,
      shift: false,
    },
    when: { all: ["mainSurface", "browserFocus"], none: [] },
  },
];

describe("resolveDesktopBrowserAppCommand", () => {
  it("resolves only browser commands using platform modifier semantics", () => {
    expect(
      resolveDesktopBrowserAppCommand({
        input: {
          altKey: false,
          ctrlKey: false,
          code: "KeyL",
          key: "l",
          metaKey: true,
          shiftKey: false,
        },
        isMac: true,
        keybindings,
      }),
    ).toBe("browser.focusLocation");
    expect(
      resolveDesktopBrowserAppCommand({
        input: {
          altKey: false,
          ctrlKey: false,
          code: "KeyK",
          key: "k",
          metaKey: true,
          shiftKey: false,
        },
        isMac: true,
        keybindings,
      }),
    ).toBeNull();
    expect(
      resolveDesktopBrowserAppCommand({
        input: {
          altKey: false,
          ctrlKey: true,
          code: "KeyL",
          key: "l",
          metaKey: false,
          shiftKey: false,
        },
        isMac: false,
        keybindings,
      }),
    ).toBe("browser.focusLocation");
  });

  it("uses last-binding precedence and normalizes shifted punctuation", () => {
    const reloadBinding: AppKeybindings[number] = {
      command: "browser.reload",
      desktopOnly: true,
      shortcut: {
        key: "[",
        mod: true,
        meta: false,
        control: false,
        alt: false,
        shift: true,
      },
      when: { all: ["mainSurface", "browserFocus"], none: [] },
    };
    const focusBinding: AppKeybindings[number] = {
      ...reloadBinding,
      command: "browser.focusLocation",
    };
    expect(
      resolveDesktopBrowserAppCommand({
        input: {
          altKey: false,
          ctrlKey: false,
          code: "BracketLeft",
          key: "{",
          metaKey: true,
          shiftKey: true,
        },
        isMac: true,
        keybindings: [...keybindings, focusBinding, reloadBinding],
      }),
    ).toBe("browser.reload");
  });
});
