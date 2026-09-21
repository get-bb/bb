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
  it.each([
    "panel.previousTab",
    "panel.nextTab",
    "pane.focus.previous",
    "pane.focus.next",
  ] as const)("forwards rebound %s from native browser content", (command) => {
    const binding: AppKeybindings[number] = {
      ...keybindings[0]!,
      command,
      shortcut: {
        ...keybindings[0]!.shortcut,
        key: "ArrowRight",
        shift: true,
      },
    };
    const input = {
      key: "ArrowRight",
      code: "ArrowRight",
      altKey: false,
      ctrlKey: false,
      metaKey: true,
      shiftKey: true,
    };
    expect(
      resolveDesktopBrowserAppCommand({
        input,
        isMac: true,
        keybindings: [binding],
        splitNavigationEnabled: true,
      }),
    ).toBe(command);
  });

  it("only intercepts a directional shortcut when that neighbor exists", () => {
    const binding: AppKeybindings[number] = {
      ...keybindings[0]!,
      command: "pane.focus.down",
      shortcut: { ...keybindings[0]!.shortcut, key: "ArrowDown", shift: true },
    };
    const args = {
      input: {
        key: "ArrowDown",
        code: "ArrowDown",
        altKey: false,
        ctrlKey: false,
        metaKey: true,
        shiftKey: true,
      },
      isMac: true,
      keybindings: [binding],
      splitNavigationEnabled: true,
    };
    expect(resolveDesktopBrowserAppCommand(args)).toBeNull();
    expect(
      resolveDesktopBrowserAppCommand({
        ...args,
        splitNavigationCommands: ["pane.focus.down"],
      }),
    ).toBe("pane.focus.down");
    expect(
      resolveDesktopBrowserAppCommand({
        ...args,
        splitNavigationCommands: ["pane.focus.up"],
      }),
    ).toBeNull();
    expect(
      resolveDesktopBrowserAppCommand({
        ...args,
        splitNavigationEnabled: false,
        splitNavigationCommands: ["pane.focus.down"],
      }),
    ).toBeNull();
  });

  it("keeps frontend plugin commands out of native browser dispatch", () => {
    expect(
      resolveDesktopBrowserAppCommand({
        input: {
          key: "i",
          code: "KeyI",
          altKey: false,
          ctrlKey: true,
          metaKey: false,
          shiftKey: false,
        },
        isMac: false,
        keybindings: [
          {
            command: "plugin:example/open",
            desktopOnly: false,
            shortcut: {
              key: "i",
              mod: true,
              meta: false,
              control: false,
              alt: false,
              shift: false,
            },
            when: { all: ["browserFocus"], none: [] },
          },
        ],
      }),
    ).toBeNull();
  });

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
