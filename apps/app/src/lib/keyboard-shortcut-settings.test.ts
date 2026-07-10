import { describe, expect, it } from "vitest";
import { APP_COMMAND_IDS, type AppKeybindings } from "@bb/domain";
import { getAppCommandMetadata } from "./app-command-metadata";
import {
  appShortcutFromInput,
  canAssignAppShortcut,
  getCommandShortcut,
  setCommandShortcutOverride,
} from "./keyboard-shortcut-settings";

const defaults: AppKeybindings = [
  {
    command: "thread.new",
    desktopOnly: true,
    shortcut: {
      key: "n",
      mod: true,
      meta: false,
      control: false,
      alt: false,
      shift: false,
    },
    when: { all: ["mainSurface"], none: ["modalOpen"] },
  },
];

describe("keyboard shortcut settings", () => {
  it("has settings metadata for every command", () => {
    expect(
      APP_COMMAND_IDS.map((command) => getAppCommandMetadata(command).command),
    ).toEqual(APP_COMMAND_IDS);
  });

  it("records primary modifiers and unshifted punctuation", () => {
    expect(
      appShortcutFromInput(
        {
          key: "{",
          metaKey: true,
          ctrlKey: false,
          altKey: false,
          shiftKey: true,
        },
        "MacIntel",
      ),
    ).toEqual({
      key: "[",
      mod: true,
      meta: false,
      control: false,
      alt: false,
      shift: true,
    });
  });

  it("preserves explicit non-primary modifiers", () => {
    expect(
      appShortcutFromInput(
        {
          key: "K",
          metaKey: true,
          ctrlKey: true,
          altKey: false,
          shiftKey: true,
        },
        "MacIntel",
      ),
    ).toMatchObject({ key: "k", mod: true, control: true, shift: true });
  });

  it("rejects unmodified typing keys except for question choices", () => {
    const plainKey = {
      key: "x",
      mod: false,
      meta: false,
      control: false,
      alt: false,
      shift: false,
    };
    expect(canAssignAppShortcut("thread.new", plainKey)).toBe(false);
    expect(canAssignAppShortcut("question.select.1", plainKey)).toBe(true);
    expect(canAssignAppShortcut("thread.new", { ...plainKey, key: "F2" })).toBe(
      true,
    );
  });

  it("stores disable overrides and removes redundant default overrides", () => {
    const disabled = setCommandShortcutOverride(
      defaults,
      [],
      "thread.new",
      null,
    );
    expect(disabled).toEqual([{ command: "thread.new", shortcut: null }]);
    expect(getCommandShortcut(defaults, disabled, "thread.new")).toBeNull();

    expect(
      setCommandShortcutOverride(
        defaults,
        disabled,
        "thread.new",
        defaults[0]!.shortcut,
      ),
    ).toEqual([]);
  });
});
