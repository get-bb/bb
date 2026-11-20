import { describe, expect, it } from "vitest";
import type { AppKeybindings } from "@bb/domain";
import {
  DEFAULT_APPLICATION_MENU_ACCELERATORS,
  formatElectronAccelerator,
  resolveApplicationMenuAccelerators,
} from "../src/desktop-menu-shortcuts.js";

function binding(
  command: AppKeybindings[number]["command"],
  key: string,
  modifiers: Partial<AppKeybindings[number]["shortcut"]> = {},
): AppKeybindings[number] {
  return {
    command,
    desktopOnly: false,
    shortcut: {
      key,
      mod: modifiers.mod ?? false,
      meta: modifiers.meta ?? false,
      control: modifiers.control ?? false,
      alt: modifiers.alt ?? false,
      shift: modifiers.shift ?? false,
    },
    when: { all: ["mainSurface"], none: ["modalOpen"] },
  };
}

describe("desktop menu shortcuts", () => {
  it("keeps native defaults available before server config loads", () => {
    expect(DEFAULT_APPLICATION_MENU_ACCELERATORS).toEqual({
      closeWindowOrSideTab: "CommandOrControl+W",
      createNewWindow: "CommandOrControl+Shift+N",
      forceReloadWindow: "CommandOrControl+Shift+R",
      openNewTab: "CommandOrControl+T",
      openNewThread: "CommandOrControl+N",
      openSettings: "CommandOrControl+,",
      reloadWindow: "CommandOrControl+R",
      reopenClosedTab: "CommandOrControl+Shift+T",
    });
  });

  it("formats app shortcut modifiers as Electron accelerators", () => {
    expect(
      formatElectronAccelerator(
        binding("window.new", "n", { mod: true, shift: true }).shortcut,
      ),
    ).toBe("CommandOrControl+Shift+N");
    expect(
      formatElectronAccelerator(
        binding("window.new", "ArrowLeft", { alt: true }).shortcut,
      ),
    ).toBe("Alt+Left");
  });

  it("uses the latest resolved binding and removes disabled menu accelerators", () => {
    const accelerators = resolveApplicationMenuAccelerators(
      [
        binding("thread.new", "n", { mod: true }),
        binding("thread.new", "u", { mod: true, shift: true }),
        binding("settings.open", ",", { mod: true }),
        binding("panel.reopenClosedTab", "t", { mod: true, shift: true }),
      ],
      "darwin",
    );
    expect(accelerators.openNewThread).toBe("CommandOrControl+Shift+U");
    expect(accelerators.openSettings).toBe("CommandOrControl+,");
    expect(accelerators.reopenClosedTab).toBe("CommandOrControl+Shift+T");
    expect(accelerators.openNewTab).toBeUndefined();
  });

  it("shows only bindings that apply to the desktop on this platform", () => {
    const macReload = {
      ...binding("window.reload", "r", { mod: true }),
      when: { all: ["mainSurface" as const, "macPlatform" as const], none: [] },
    };
    const webNewThread = {
      ...binding("thread.new", "o", { mod: true, shift: true }),
      when: { all: ["mainSurface" as const, "webSurface" as const], none: [] },
    };
    const keybindings = [
      binding("thread.new", "n", { mod: true }),
      webNewThread,
      macReload,
    ];

    expect(
      resolveApplicationMenuAccelerators(keybindings, "darwin"),
    ).toMatchObject({
      openNewThread: "CommandOrControl+N",
      reloadWindow: "CommandOrControl+R",
    });
    expect(
      resolveApplicationMenuAccelerators(keybindings, "win32"),
    ).toMatchObject({
      openNewThread: "CommandOrControl+N",
      reloadWindow: undefined,
    });
  });
});
