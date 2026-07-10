import { describe, expect, it, vi } from "vitest";
import type { BaseWindow, MenuItemConstructorOptions } from "electron";

vi.mock("electron", () => ({
  app: { name: "bb" },
  Menu: {},
}));

import {
  buildApplicationMenuTemplate,
  type InstallApplicationMenuArgs,
} from "../src/menu.js";

function menuArgs(
  reloadWindow: InstallApplicationMenuArgs["reloadWindow"],
  overrides: Partial<InstallApplicationMenuArgs> = {},
): InstallApplicationMenuArgs {
  return {
    accelerators: {
      closeWindowOrSideTab: undefined,
      createNewWindow: undefined,
      openNewTab: undefined,
      openNewThread: undefined,
      openSettings: undefined,
    },
    closeWindowOrSideTab: () => {},
    createNewWindow: () => {},
    openNewTab: () => {},
    openNewThread: () => {},
    openServerDaemonLogs: () => {},
    openSettings: () => {},
    reloadWindow,
    selectServer: () => {},
    serverDaemonLogsMenuEnabled: false,
    servers: [
      { checked: true, id: "builtin-local", name: "This Mac" },
    ],
    ...overrides,
  };
}

describe("application menu", () => {
  it("keeps reload menu actions click-only so app command chords do not collide", () => {
    const reloadWindow = vi.fn();
    const template = buildApplicationMenuTemplate(menuArgs(reloadWindow));
    const viewMenu = template.find((item) => item.label === "View");
    const submenu = viewMenu?.submenu as MenuItemConstructorOptions[];
    const reload = submenu.find((item) => item.label === "Reload");
    const forceReload = submenu.find((item) => item.label === "Force Reload");
    const focusedWindow = {} as BaseWindow;

    expect(reload?.accelerator).toBeUndefined();
    expect(forceReload?.accelerator).toBeUndefined();
    reload?.click?.({} as never, focusedWindow, {} as never);
    forceReload?.click?.({} as never, focusedWindow, {} as never);
    expect(reloadWindow).toHaveBeenNthCalledWith(1, focusedWindow, false);
    expect(reloadWindow).toHaveBeenNthCalledWith(2, focusedWindow, true);
  });

  it("builds a Window ▸ Server radio submenu with numbered accelerators", () => {
    const selectServer = vi.fn();
    const template = buildApplicationMenuTemplate(
      menuArgs(() => {}, {
        selectServer,
        servers: [
          { checked: true, id: "builtin-local", name: "This Mac" },
          { checked: false, id: "remote-1", name: "Staging" },
        ],
      }),
    );
    const windowMenu = template.find((item) => item.label === "Window");
    const windowSubmenu = windowMenu?.submenu as MenuItemConstructorOptions[];
    const serverMenu = windowSubmenu.find((item) => item.label === "Server");
    const serverSubmenu = serverMenu?.submenu as MenuItemConstructorOptions[];
    const focusedWindow = {} as BaseWindow;

    expect(serverSubmenu).toHaveLength(2);
    expect(serverSubmenu[0]?.type).toBe("radio");
    expect(serverSubmenu[0]?.checked).toBe(true);
    expect(serverSubmenu[0]?.accelerator).toBe("Command+Control+1");
    expect(serverSubmenu[1]?.accelerator).toBe("Command+Control+2");
    serverSubmenu[1]?.click?.({} as never, focusedWindow, {} as never);
    expect(selectServer).toHaveBeenCalledWith("remote-1", focusedWindow);
  });
});
