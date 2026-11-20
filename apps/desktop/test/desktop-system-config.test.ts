import { describe, expect, it } from "vitest";
import type { AppKeybinding } from "@bb/domain";
import { STARTUP_RELOAD_KEYBINDINGS } from "../src/desktop-reload-shortcut.js";
import { parseDesktopSystemConfig } from "../src/desktop-system-config.js";

const [startupReload, startupForceReload] = STARTUP_RELOAD_KEYBINDINGS;
if (startupReload === undefined || startupForceReload === undefined) {
  throw new Error("Expected startup reload and force-reload bindings.");
}
const SERVER_RELOAD_DEFAULTS = [startupReload, startupForceReload];

const reloadBinding: AppKeybinding = {
  command: "browser.reload",
  desktopOnly: true,
  shortcut: {
    key: "r",
    mod: true,
    meta: false,
    control: false,
    alt: false,
    shift: false,
  },
  when: { all: ["mainSurface", "browserFocus"], none: ["modalOpen"] },
};

describe("parseDesktopSystemConfig", () => {
  it("keeps known bindings and drops commands this shell does not know", () => {
    const config = parseDesktopSystemConfig({
      generalSettings: { showKeyboardHints: true },
      defaultKeybindings: SERVER_RELOAD_DEFAULTS,
      keybindings: [
        reloadBinding,
        { ...reloadBinding, command: "browser.futureCommand" },
      ],
      serverUrl: "http://127.0.0.1:1",
      unknownTopLevelField: 1,
    });
    expect(config.keybindings).toEqual([reloadBinding]);
  });

  it("keeps the startup reload shortcuts for a server whose defaults predate them", () => {
    const config = parseDesktopSystemConfig({
      defaultKeybindings: [reloadBinding, { ...startupReload, shortcut: null }],
      keybindings: [reloadBinding],
    });
    expect(config.keybindings).toEqual([
      startupReload,
      startupForceReload,
      reloadBinding,
    ]);
  });

  it.each([
    {
      name: "a user-cleared reload",
      keybindings: [startupForceReload],
      expected: [startupForceReload],
    },
    {
      name: "a user-rebound reload",
      keybindings: [
        { ...startupReload, shortcut: { ...startupReload.shortcut, key: "l" } },
        startupForceReload,
      ],
      expected: [
        { ...startupReload, shortcut: { ...startupReload.shortcut, key: "l" } },
        startupForceReload,
      ],
    },
  ])(
    "follows $name when the server defines the reload shortcuts",
    ({ keybindings, expected }) => {
      expect(
        parseDesktopSystemConfig({
          defaultKeybindings: SERVER_RELOAD_DEFAULTS,
          keybindings,
        }).keybindings,
      ).toEqual(expected);
    },
  );

  it("rejects a malformed binding rather than a malformed command id", () => {
    expect(() =>
      parseDesktopSystemConfig({
        defaultKeybindings: SERVER_RELOAD_DEFAULTS,
        keybindings: [{ ...reloadBinding, shortcut: { key: "r" } }],
      }),
    ).toThrow();
    expect(() => parseDesktopSystemConfig({})).toThrow();
  });
});
