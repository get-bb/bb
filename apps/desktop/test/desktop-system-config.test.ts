import { describe, expect, it } from "vitest";
import type { AppKeybinding } from "@bb/domain";
import { parseDesktopSystemConfig } from "../src/desktop-system-config.js";

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
    // Simulates a newer server: the response carries a command id that is
    // not in this shell's bundled enum (as `browser.find` is for shells
    // built before it existed). The known binding must still come through.
    const config = parseDesktopSystemConfig({
      generalSettings: { showKeyboardHints: true },
      keybindings: [
        reloadBinding,
        { ...reloadBinding, command: "browser.futureCommand" },
      ],
      serverUrl: "http://127.0.0.1:1",
      unknownTopLevelField: 1,
    });
    expect(config.keybindings).toEqual([reloadBinding]);
  });

  it("rejects a malformed binding rather than a malformed command id", () => {
    expect(() =>
      parseDesktopSystemConfig({
        keybindings: [{ ...reloadBinding, shortcut: { key: "r" } }],
      }),
    ).toThrow();
    expect(() => parseDesktopSystemConfig({})).toThrow();
  });
});
