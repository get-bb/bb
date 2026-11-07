import { describe, expect, it } from "vitest";
import {
  applyAppKeybindingOverrides,
  type AppDefaultKeybinding,
  type AppShortcut,
  type KeyboardCommandId,
} from "@bb/domain";
import {
  resolvePluginCommandDefaults,
  shortcutsConflict,
} from "./plugin-command-keybindings";
import { setCommandShortcutOverride } from "./keyboard-shortcut-settings";

const shortcut: AppShortcut = {
  key: "i",
  mod: true,
  meta: false,
  control: false,
  alt: false,
  shift: true,
};
function binding(
  command: KeyboardCommandId,
  keys: AppShortcut | null = shortcut,
): AppDefaultKeybinding {
  return {
    command,
    shortcut: keys,
    desktopOnly: false,
    when: { all: ["mainSurface"], none: ["modalOpen"] },
  };
}

const NO_BUNDLED: ReadonlySet<KeyboardCommandId> = new Set();

describe("plugin command keybindings", () => {
  it("keeps a bundled plugin's default over another plugin's, as core bindings are kept", () => {
    const defaults = [
      binding("plugin:bb--git/toggle-diff"),
      binding("plugin:third-party/open"),
    ];
    const result = resolvePluginCommandDefaults(
      defaults,
      [],
      false,
      "Linux",
      new Set<KeyboardCommandId>(["plugin:bb--git/toggle-diff"]),
    );
    expect(
      applyAppKeybindingOverrides(result.defaults, []).map(
        (entry) => entry.command,
      ),
    ).toEqual(["plugin:bb--git/toggle-diff"]);
    expect(result.conflicts.get("plugin:third-party/open")).toEqual([
      "plugin:bb--git/toggle-diff",
    ]);
  });

  it("suppresses colliding defaults regardless of registration order", () => {
    const defaults = [
      binding("plugin:first/open"),
      binding("plugin:second/open"),
    ];
    for (const ordered of [defaults, [...defaults].reverse()]) {
      const result = resolvePluginCommandDefaults(ordered, [], false, "Linux", NO_BUNDLED);
      expect(applyAppKeybindingOverrides(result.defaults, [])).toEqual([]);
      expect(result.conflicts.get("plugin:first/open")).toEqual([
        "plugin:second/open",
      ]);
    }
  });

  it("protects core bindings, comparing Mod to platform modifiers", () => {
    const defaults = [
      binding("thread.new", { ...shortcut, mod: false, meta: true }),
      binding("plugin:first/open"),
    ];
    const mac = resolvePluginCommandDefaults(defaults, [], false, "MacIntel", NO_BUNDLED);
    expect(mac.defaults[1]?.shortcut).toBeNull();
    expect(mac.defaults[0]?.shortcut).not.toBeNull();
    expect(
      resolvePluginCommandDefaults(defaults, [], false, "Linux", NO_BUNDLED)
        .conflicts.size,
    ).toBe(0);
    expect(
      shortcutsConflict(shortcut, { ...shortcut, key: "I" }, "Linux"),
    ).toBe(true);
  });

  it("lets explicit overrides win over other plugin defaults", () => {
    const defaults = [
      binding("plugin:first/open"),
      binding("plugin:second/open"),
    ];
    const overrides = [{ command: "plugin:second/open" as const, shortcut }];
    const result = resolvePluginCommandDefaults(
      defaults,
      overrides,
      false,
      "Linux",
      NO_BUNDLED,
    );
    expect(
      applyAppKeybindingOverrides(result.defaults, overrides).map(
        (entry) => entry.command,
      ),
    ).toEqual(["plugin:second/open"]);
  });

  it("preserves disabled-plugin overrides when editing another command", () => {
    const overrides = [{ command: "plugin:disabled/open" as const, shortcut }];
    const next = setCommandShortcutOverride(
      overrides,
      "thread.new",
      { ...shortcut, key: "n" },
      "Linux",
    );
    expect(next).toContainEqual(overrides[0]);
    expect(next).toHaveLength(2);
  });

  it("restores defaults when their conflict is explicitly cleared", () => {
    const defaults = [binding("thread.new"), binding("plugin:first/open")];
    expect(
      resolvePluginCommandDefaults(
        defaults,
        [{ command: "thread.new", shortcut: null }],
        false,
        "Linux",
        NO_BUNDLED,
      ).defaults[1]?.shortcut,
    ).toEqual(shortcut);
  });
});
