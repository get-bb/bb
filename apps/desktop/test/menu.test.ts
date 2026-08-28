import { describe, expect, it, vi } from "vitest";
import type { BaseWindow, MenuItemConstructorOptions } from "electron";

import {
  buildApplicationMenuTemplate,
  CONNECT_SERVERS_SKIPPED_MENU_LABELS,
  SET_SERVER_URL_MENU_LABEL,
  type InstallApplicationMenuArgs,
} from "../src/menu.js";

const sendActionToFirstResponder = vi.fn();

function menuArgs(
  reloadWindow: InstallApplicationMenuArgs["reloadWindow"],
  overrides: Partial<InstallApplicationMenuArgs> = {},
): InstallApplicationMenuArgs {
  return {
    applicationName: "bb",
    accelerators: {
      closeWindowOrSideTab: undefined,
      createNewWindow: undefined,
      openNewTab: undefined,
      openNewThread: undefined,
      openSettings: undefined,
    },
    closeWindowOrSideTab: () => {},
    connectServersSkipReason: null,
    createNewWindow: () => {},
    isMac: true,
    openAbout: () => {},
    openNewTab: () => {},
    openNewThread: () => {},
    openServerDaemonLogs: () => {},
    openSettings: () => {},
    reloadWindow,
    sendActionToFirstResponder,
    selectServer: () => {},
    serverDaemonLogsMenuEnabled: false,
    servers: [{ checked: true, id: "builtin", name: "This Mac" }],
    setServerUrl: () => {},
    ...overrides,
  };
}

function findServerSubmenu(
  template: MenuItemConstructorOptions[],
): MenuItemConstructorOptions[] {
  const windowMenu = template.find((item) => item.label === "Window");
  const windowSubmenu = getMenuSubmenu(windowMenu);
  const serverMenu = windowSubmenu.find((item) => item.label === "Server");
  return getMenuSubmenu(serverMenu);
}

function getMenuSubmenu(
  item: MenuItemConstructorOptions | undefined,
): MenuItemConstructorOptions[] {
  if (!Array.isArray(item?.submenu)) {
    throw new Error("Expected a menu item submenu.");
  }
  return item.submenu;
}

function clickMenuItem(
  item: MenuItemConstructorOptions | undefined,
  browserWindow: BaseWindow | undefined | null,
): void {
  const click = item?.click;
  if (click === undefined) return;
  // SAFETY: These menu callbacks only inspect the browser window in this test.
  click(undefined as never, browserWindow as never, undefined as never);
}

describe("application menu", () => {
  it("closes a native panel when Electron omits its window", () => {
    sendActionToFirstResponder.mockClear();
    const closeWindowOrSideTab = vi.fn();
    const template = buildApplicationMenuTemplate(
      menuArgs(() => {}, { closeWindowOrSideTab }),
    );
    const fileMenu = template.find((item) => item.label === "File");
    const submenu = getMenuSubmenu(fileMenu);
    const closeWindow = submenu.find((item) => item.label === "Close Window");

    clickMenuItem(closeWindow, null);

    expect(sendActionToFirstResponder).toHaveBeenCalledWith("performClose:");
    expect(closeWindowOrSideTab).not.toHaveBeenCalled();
  });

  it("forwards an undefined window for detached DevTools", () => {
    sendActionToFirstResponder.mockClear();
    const closeWindowOrSideTab = vi.fn();
    const template = buildApplicationMenuTemplate(
      menuArgs(() => {}, { closeWindowOrSideTab }),
    );
    const fileMenu = template.find((item) => item.label === "File");
    const submenu = getMenuSubmenu(fileMenu);
    const closeWindow = submenu.find((item) => item.label === "Close Window");

    clickMenuItem(closeWindow, undefined);

    expect(closeWindowOrSideTab).toHaveBeenCalledWith(undefined);
    expect(sendActionToFirstResponder).not.toHaveBeenCalled();
  });

  it("shows reload shortcuts without globally stealing browser commands", () => {
    const reloadWindow = vi.fn();
    const template = buildApplicationMenuTemplate(menuArgs(reloadWindow));
    const viewMenu = template.find((item) => item.label === "View");
    const submenu = getMenuSubmenu(viewMenu);
    const reload = submenu.find((item) => item.label === "Reload");
    const forceReload = submenu.find((item) => item.label === "Force Reload");
    // SAFETY: The test uses an identity-only window for the reload callback.
    const focusedWindow = {} as BaseWindow;

    expect(reload?.accelerator).toBe("CommandOrControl+R");
    expect(reload?.registerAccelerator).toBe(false);
    expect(forceReload?.accelerator).toBe("CommandOrControl+Shift+R");
    expect(forceReload?.registerAccelerator).toBe(false);
    clickMenuItem(reload, focusedWindow);
    clickMenuItem(forceReload, focusedWindow);
    expect(reloadWindow).toHaveBeenNthCalledWith(1, focusedWindow, false);
    expect(reloadWindow).toHaveBeenNthCalledWith(2, focusedWindow, true);
  });

  it("builds a Window ▸ Server radio submenu with a Set Server URL item", () => {
    const selectServer = vi.fn();
    const setServerUrl = vi.fn();
    const template = buildApplicationMenuTemplate(
      menuArgs(() => {}, {
        selectServer,
        servers: [
          { checked: false, id: "builtin", name: "This Mac" },
          { checked: true, id: "custom", name: "example.com" },
        ],
        setServerUrl,
      }),
    );
    const serverSubmenu = findServerSubmenu(template);

    expect(serverSubmenu).toHaveLength(4);
    expect(serverSubmenu[0]?.type).toBe("radio");
    expect(serverSubmenu[0]?.checked).toBe(false);
    expect(serverSubmenu[1]?.type).toBe("radio");
    expect(serverSubmenu[1]?.checked).toBe(true);
    expect(serverSubmenu[2]?.type).toBe("separator");
    expect(serverSubmenu[3]?.label).toBe(SET_SERVER_URL_MENU_LABEL);
    clickMenuItem(serverSubmenu[1], undefined);
    expect(selectServer).toHaveBeenCalledWith("custom");
    clickMenuItem(serverSubmenu[3], undefined);
    expect(setServerUrl).toHaveBeenCalledTimes(1);
  });

  it("explains an empty Connect list with a disabled row when the sync was skipped", () => {
    const template = buildApplicationMenuTemplate(
      menuArgs(() => {}, {
        connectServersSkipReason: "no-credential",
        servers: [
          { checked: false, id: "builtin", name: "This Mac" },
          {
            checked: true,
            id: "custom",
            name: "old-host.tailnet.ts.net:38886",
          },
        ],
      }),
    );
    const serverSubmenu = findServerSubmenu(template);

    expect(serverSubmenu.map((item) => item.label ?? `<${item.type}>`)).toEqual(
      [
        "This Mac",
        "old-host.tailnet.ts.net:38886",
        CONNECT_SERVERS_SKIPPED_MENU_LABELS["no-credential"],
        "<separator>",
        SET_SERVER_URL_MENU_LABEL,
      ],
    );
    const note = serverSubmenu[2];
    expect(note?.enabled).toBe(false);
    expect(note?.type).toBeUndefined();
    expect(note?.click).toBeUndefined();
    expect(note?.label).toMatch(/sign in to bb Connect/u);
  });

  it("builds a native Linux menu with the Linux DevTools accelerator", () => {
    sendActionToFirstResponder.mockClear();
    const template = buildApplicationMenuTemplate(
      menuArgs(() => {}, { isMac: false }),
    );
    const appMenu = getMenuSubmenu(template[0]);
    const windowMenu = template.find((item) => item.label === "Window");
    const windowSubmenu = getMenuSubmenu(windowMenu);
    const viewMenu = template.find((item) => item.label === "View");
    const viewSubmenu = getMenuSubmenu(viewMenu);
    const fileMenu = template.find((item) => item.label === "File");
    const fileSubmenu = getMenuSubmenu(fileMenu);
    const closeWindow = fileSubmenu.find(
      (item) => item.label === "Close Window",
    );

    expect(appMenu.map((item) => item.role).filter(Boolean)).toEqual(["quit"]);
    expect(windowSubmenu.map((item) => item.role).filter(Boolean)).toEqual([
      "minimize",
    ]);
    expect(windowSubmenu.some((item) => item.label === "Server")).toBe(true);
    expect(
      viewSubmenu.find((item) => item.label === "Toggle Developer Tools")
        ?.accelerator,
    ).toBe("Control+Shift+I");

    clickMenuItem(closeWindow, null);
    expect(sendActionToFirstResponder).not.toHaveBeenCalled();
  });
});
