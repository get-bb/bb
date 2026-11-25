import { describe, expect, it } from "vitest";
import {
  APP_COMMAND_IDS,
  type AppDefaultKeybindings,
  type AppKeybindingOverrides,
  type AppKeybindings,
  type KeyboardCommandId,
} from "@bb/domain";
import { APP_COMMAND_GROUPS } from "./app-command-metadata";
import {
  appShortcutFromInput,
  allowsBareKeyShortcut,
  canAssignAppShortcut,
  getCommandShortcut,
  getShortcutConflicts,
  resetCommandShortcutOverride,
  setCommandShortcutOverride,
} from "./keyboard-shortcut-settings";

const defaults: AppKeybindings = [
  {
    command: "thread.new",
    desktopOnly: false,
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
      APP_COMMAND_GROUPS.flatMap((group) =>
        group.commands.map((metadata) => metadata.command),
      ).sort(),
    ).toEqual([...APP_COMMAND_IDS].sort());
  });

  it("records the physical key on a non-Latin layout", () => {
    expect(
      appShortcutFromInput(
        {
          key: "л",
          code: "KeyK",
          altKey: false,
          ctrlKey: true,
          metaKey: false,
          shiftKey: false,
        },
        "Win32",
      ),
    ).toEqual({
      key: "k",
      mod: true,
      meta: false,
      control: false,
      alt: false,
      shift: false,
    });
  });

  it("records primary modifiers and unshifted punctuation", () => {
    expect(
      appShortcutFromInput(
        {
          key: "{",
          code: "BracketLeft",
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

  it("records an alt chord by its physical key", () => {
    expect(
      appShortcutFromInput(
        {
          key: "µ",
          code: "KeyM",
          metaKey: false,
          ctrlKey: false,
          altKey: true,
          shiftKey: false,
        },
        "MacIntel",
      ),
    ).toMatchObject({ key: "m", alt: true, mod: false, shift: false });
  });

  it("preserves explicit non-primary modifiers", () => {
    expect(
      appShortcutFromInput(
        {
          key: "K",
          code: "KeyK",
          metaKey: true,
          ctrlKey: true,
          altKey: false,
          shiftKey: true,
        },
        "MacIntel",
      ),
    ).toMatchObject({ key: "k", mod: true, control: true, shift: true });
  });

  it("rejects unmodified typing keys except for question choices and page commands", () => {
    const plainKey = {
      key: "x",
      mod: false,
      meta: false,
      control: false,
      alt: false,
      shift: false,
    };
    const defaults: AppDefaultKeybindings = [
      {
        command: "plugin:tasks/new-task",
        desktopOnly: false,
        shortcut: { ...plainKey, key: "c" },
        when: {
          all: ["mainSurface", "pluginPage"],
          none: ["modalOpen", "editableFocus"],
        },
      },
      {
        command: "plugin:tasks/sync",
        desktopOnly: false,
        shortcut: null,
        when: { all: ["mainSurface"], none: ["modalOpen"] },
      },
      {
        command: "settings.search",
        desktopOnly: false,
        shortcut: { ...plainKey, key: "/" },
        when: {
          all: ["mainSurface", "settingsPage"],
          none: ["modalOpen", "editableFocus"],
        },
      },
    ];
    const assignable = (command: KeyboardCommandId, shortcut = plainKey) =>
      canAssignAppShortcut(shortcut, allowsBareKeyShortcut(defaults, command));
    expect(assignable("thread.new")).toBe(false);
    expect(assignable("plugin:tasks/sync")).toBe(false);
    expect(assignable("question.select.1")).toBe(true);
    expect(assignable("plugin:tasks/new-task")).toBe(true);
    expect(assignable("settings.search")).toBe(true);
    expect(assignable("thread.new", { ...plainKey, key: "F2" })).toBe(true);
  });

  it("reports a conflict only between bindings that can fire on the same page", () => {
    const key = {
      key: "c",
      mod: false,
      meta: false,
      control: false,
      alt: false,
      shift: false,
    };
    const pageWhen = (page: "pluginPage" | "settingsPage") => ({
      all: ["mainSurface" as const, page],
      none: ["modalOpen" as const, "editableFocus" as const],
    });
    const defaults: AppDefaultKeybindings = [
      {
        command: "plugin:tasks/new-task",
        desktopOnly: false,
        shortcut: key,
        when: pageWhen("pluginPage"),
      },
      {
        command: "plugin:tasks/archive",
        desktopOnly: false,
        shortcut: key,
        when: pageWhen("pluginPage"),
      },
      {
        command: "plugin:board/add-card",
        desktopOnly: false,
        shortcut: key,
        when: pageWhen("pluginPage"),
      },
      {
        command: "settings.search",
        desktopOnly: false,
        shortcut: key,
        when: pageWhen("settingsPage"),
      },
      {
        command: "thread.search",
        desktopOnly: false,
        shortcut: key,
        when: { all: ["mainSurface"], none: ["modalOpen"] },
      },
    ];
    const conflicts = (command: KeyboardCommandId) =>
      getShortcutConflicts(defaults, [], command, false, "Linux");
    expect(conflicts("plugin:tasks/new-task")).toEqual([
      "plugin:tasks/archive",
      "thread.search",
    ]);
    expect(conflicts("plugin:board/add-card")).toEqual(["thread.search"]);
    expect(conflicts("settings.search")).toEqual(["thread.search"]);
    expect(conflicts("thread.search")).toEqual([
      "plugin:tasks/new-task",
      "plugin:tasks/archive",
      "plugin:board/add-card",
      "settings.search",
    ]);
  });

  it("stores edits and disabled bindings explicitly for the current platform", () => {
    const disabled = setCommandShortcutOverride(
      [],
      "thread.new",
      null,
      "Win32",
    );
    expect(disabled).toEqual([
      { command: "thread.new", shortcut: null, platform: "windows" },
    ]);
    expect(
      getCommandShortcut(defaults, disabled, "thread.new", false, "Win32"),
    ).toBeNull();

    expect(
      setCommandShortcutOverride(
        disabled,
        "thread.new",
        defaults[0]!.shortcut,
        "Win32",
      ),
    ).toEqual([
      {
        command: "thread.new",
        platform: "windows",
        shortcut: defaults[0]!.shortcut,
      },
    ]);
  });

  it("assigns and resets a command without a default shortcut", () => {
    const unassignedDefaults: AppDefaultKeybindings = [
      {
        command: "thread.rename",
        desktopOnly: false,
        shortcut: null,
        when: { all: ["mainSurface"], none: ["modalOpen"] },
      },
    ];
    const shortcut = defaults[0]!.shortcut;
    const assigned = setCommandShortcutOverride(
      [],
      "thread.rename",
      shortcut,
      "Win32",
    );

    expect(assigned).toEqual([
      { command: "thread.rename", shortcut, platform: "windows" },
    ]);
    expect(
      getCommandShortcut(
        unassignedDefaults,
        assigned,
        "thread.rename",
        false,
        "Win32",
      ),
    ).toEqual(shortcut);
    expect(
      resetCommandShortcutOverride(assigned, "thread.rename", "Win32"),
    ).toEqual([]);
  });

  it("selects the active default for the current app surface", () => {
    expect(
      getCommandShortcut(defaults, [], "thread.new", false, "Win32"),
    ).toEqual(defaults[0]!.shortcut);
    expect(
      getCommandShortcut(defaults, [], "thread.new", true, "Win32"),
    ).toEqual(defaults[1]!.shortcut);
    expect(
      getCommandShortcut(
        [defaults[1]!],
        [{ command: "thread.new", shortcut: defaults[1]!.shortcut }],
        "thread.new",
        false,
        "Win32",
      ),
    ).toBeNull();
  });

  it("selects the platform-specific web default", () => {
    const platformDefaults: AppKeybindings = [
      {
        ...defaults[0]!,
        shortcut: { ...defaults[0]!.shortcut, control: true, mod: false },
        when: {
          all: ["mainSurface", "webSurface", "macPlatform"],
          none: ["modalOpen"],
        },
      },
      {
        ...defaults[0]!,
        shortcut: { ...defaults[0]!.shortcut, shift: true },
        when: {
          all: ["mainSurface", "webSurface"],
          none: ["modalOpen", "macPlatform"],
        },
      },
      defaults[1]!,
    ];

    expect(
      getCommandShortcut(platformDefaults, [], "thread.new", false, "MacIntel"),
    ).toEqual(platformDefaults[0]!.shortcut);
    expect(
      getCommandShortcut(platformDefaults, [], "thread.new", false, "Win32"),
    ).toEqual(platformDefaults[1]!.shortcut);
    expect(
      getCommandShortcut(platformDefaults, [], "thread.new", true, "MacIntel"),
    ).toEqual(platformDefaults[2]!.shortcut);
  });
});

it("shows compatibility bindings only on macOS and preserves their scope while editing another command", () => {
  const overrides: AppKeybindingOverrides = [
    {
      command: "thread.new",
      shortcut: { ...defaults[0]!.shortcut, key: "o" },
      platform: "mac",
    },
  ];
  expect(
    getCommandShortcut(defaults, overrides, "thread.new", false, "MacIntel")
      ?.key,
  ).toBe("o");
  expect(
    getCommandShortcut(defaults, overrides, "thread.new", false, "Linux")?.key,
  ).toBe("n");
  const edited = setCommandShortcutOverride(
    overrides,
    "pane.focus.left",
    null,
    "MacIntel",
  );
  expect(edited.find((binding) => binding.command === "thread.new")).toEqual(
    overrides[0],
  );
  expect(
    getCommandShortcut(
      defaults,
      resetCommandShortcutOverride(edited, "thread.new", "MacIntel"),
      "thread.new",
      false,
      "MacIntel",
    )?.key,
  ).toBe("n");
});

it("edits the effective platform override without losing other scopes and resets the command", () => {
  const shortcut = defaults[0]!.shortcut;
  const overrides: AppKeybindingOverrides = [
    { command: "thread.new", shortcut: { ...shortcut, key: "g" } },
    { command: "thread.new", platform: "mac", shortcut: null },
    {
      command: "thread.new",
      platform: "windows",
      shortcut: { ...shortcut, key: "w" },
    },
    {
      command: "thread.new",
      platform: "linux",
      shortcut: { ...shortcut, key: "l" },
    },
  ];
  expect(
    getCommandShortcut(defaults, overrides, "thread.new", false, "MacIntel"),
  ).toBeNull();
  expect(
    getCommandShortcut(defaults, overrides, "thread.new", false, "Win32")?.key,
  ).toBe("w");
  const edited = setCommandShortcutOverride(
    overrides,
    "thread.new",
    shortcut,
    "Win32",
  );
  expect(edited.filter((override) => override.platform !== "windows")).toEqual(
    overrides.filter((override) => override.platform !== "windows"),
  );
  expect(
    getCommandShortcut(defaults, edited, "thread.new", false, "Win32")?.key,
  ).toBe("n");
  expect(resetCommandShortcutOverride(edited, "thread.new", "Win32")).toEqual([
    overrides[1],
    overrides[3],
  ]);
});
