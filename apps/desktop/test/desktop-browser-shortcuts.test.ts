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
  it("leaves Escape to the page until the renderer supplies command availability", () => {
    const args = {
      input: {
        key: "Escape",
        code: "Escape",
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
      },
      platform: "darwin",
      keybindings: [
        {
          ...keybindings[0]!,
          command: "app.back" as const,
          shortcut: { ...keybindings[0]!.shortcut, key: "Escape", mod: false },
        },
      ],
    };
    expect(resolveDesktopBrowserAppCommand(args)).toBeNull();
    expect(
      resolveDesktopBrowserAppCommand({ ...args, availableCommands: [] }),
    ).toBeNull();
    expect(
      resolveDesktopBrowserAppCommand({
        ...args,
        availableCommands: ["app.back"],
      }),
    ).toBe("app.back");
  });

  it.each([
    "thread.new",
    "palette.open",
    "sidebar.toggle",
    "panel.toggle",
    "thread.jump.1",
    "thread.previous",
  ] as const)(
    "forwards a global %s binding from browser content",
    (command) => {
      expect(
        resolveDesktopBrowserAppCommand({
          input: {
            key: "k",
            code: "KeyK",
            altKey: false,
            ctrlKey: false,
            metaKey: true,
            shiftKey: false,
          },
          platform: "darwin",
          keybindings: [{ ...keybindings[0]!, command }],
          availableCommands: [command],
        }),
      ).toBe(command);
    },
  );

  it.each([
    { all: ["mainSurface"], none: ["browserFocus"] },
    { all: ["mainSurface", "promptAvailable"], none: [] },
    { all: ["mainSurface"], none: ["editableFocus"] },
    { all: ["mainSurface", "questionOpen"], none: [] },
  ] satisfies AppKeybindings[number]["when"][])(
    "leaves browser input alone when the binding context is unavailable: %j",
    (when) => {
      expect(
        resolveDesktopBrowserAppCommand({
          input: {
            key: "k",
            code: "KeyK",
            altKey: false,
            ctrlKey: false,
            metaKey: true,
            shiftKey: false,
          },
          platform: "darwin",
          keybindings: [{ ...keybindings[0]!, when }],
          availableCommands: ["thread.search"],
        }),
      ).toBeNull();
    },
  );

  it.each(["c", "v", "x", "a", "ArrowLeft"])(
    "leaves unbound browser editing key %s alone",
    (key) => {
      expect(
        resolveDesktopBrowserAppCommand({
          input: {
            key,
            code: "",
            altKey: false,
            ctrlKey: false,
            metaKey: true,
            shiftKey: false,
          },
          platform: "darwin",
          keybindings,
        }),
      ).toBeNull();
    },
  );

  it("does not fall through an unavailable winning command to an older binding", () => {
    const args = {
      input: {
        key: "k",
        code: "KeyK",
        altKey: false,
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
      },
      platform: "darwin",
      keybindings: [
        keybindings[0]!,
        { ...keybindings[0]!, command: "plugin:example/open" as const },
      ],
    };
    expect(
      resolveDesktopBrowserAppCommand({
        ...args,
        availableCommands: ["thread.search"],
      }),
    ).toBeNull();
    expect(
      resolveDesktopBrowserAppCommand({
        ...args,
        availableCommands: ["plugin:example/open"],
      }),
    ).toBe("plugin:example/open");
  });

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
        platform: "darwin",
        keybindings: [binding],
        splitNavigationEnabled: true,
      }),
    ).toBe(command);
  });

  it.each([
    { command: "panel.nextTab", control: true, shift: false },
    { command: "pane.focus.right", control: true, shift: true },
  ] as const)(
    "respects platform scope for $command",
    ({ command, control, shift }) => {
      const binding: AppKeybindings[number] = {
        ...keybindings[0]!,
        command,
        shortcut: {
          ...keybindings[0]!.shortcut,
          key: "ArrowRight",
          control,
          shift,
        },
        when: { all: ["mainSurface", "macPlatform"], none: [] },
      };
      const args = {
        input: {
          key: "ArrowRight",
          code: "ArrowRight",
          altKey: false,
          ctrlKey: true,
          metaKey: false,
          shiftKey: shift,
        },
        platform: "win32",
        keybindings: [binding],
        splitNavigationEnabled: true,
        splitNavigationCommands: [command],
      };
      expect(resolveDesktopBrowserAppCommand(args)).toBeNull();
      expect(
        resolveDesktopBrowserAppCommand({
          ...args,
          platform: "darwin",
          input: { ...args.input, metaKey: true, ctrlKey: control },
        }),
      ).toBe(command);
      expect(
        resolveDesktopBrowserAppCommand({
          ...args,
          keybindings: [
            {
              ...binding,
              when: { all: ["mainSurface"], none: ["macPlatform"] },
            },
          ],
        }),
      ).toBe(command);
    },
  );

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
      platform: "darwin",
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

  it("forwards registered plugin commands from native browser content", () => {
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
        platform: "win32",
        availableCommands: ["plugin:example/open"],
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
    ).toBe("plugin:example/open");
  });

  it("resolves app and browser commands using platform modifier semantics", () => {
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
        platform: "darwin",
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
        platform: "darwin",
        keybindings,
        availableCommands: ["thread.search"],
      }),
    ).toBe("thread.search");
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
        platform: "win32",
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
        platform: "darwin",
        keybindings: [...keybindings, focusBinding, reloadBinding],
      }),
    ).toBe("browser.reload");
  });
});
