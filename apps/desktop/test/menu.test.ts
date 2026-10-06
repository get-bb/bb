import { describe, expect, it, vi } from "vitest";
import type { BaseWindow, MenuItemConstructorOptions } from "electron";

vi.mock("electron", () => ({
  app: { name: "bb" },
  Menu: { sendActionToFirstResponder: vi.fn() },
}));

import { Menu } from "electron";

import {
  buildApplicationMenuTemplate,
  CONNECT_SERVERS_SKIPPED_MENU_LABELS,
  SET_SERVER_URL_MENU_LABEL,
  type InstallApplicationMenuArgs,
} from "../src/menu.js";
import { BUILTIN_SERVER_NAME } from "../src/server-target.js";

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
      reopenClosedTab: undefined,
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
    reopenClosedTab: () => {},
    reloadWindow,
    zoomFocusedPage: () => {},
    selectServer: () => {},
    serverDaemonLogsMenuEnabled: false,
    servers: [{ checked: true, id: "builtin", name: BUILTIN_SERVER_NAME }],
    setServerUrl: () => {},
    addServer: () => {},
    ...overrides,
  };
}

function findServerSubmenu(
  template: MenuItemConstructorOptions[],
): MenuItemConstructorOptions[] {
  const windowMenu = template.find((item) => item.label === "Window");
  const windowSubmenu = windowMenu?.submenu as MenuItemConstructorOptions[];
  const serverMenu = windowSubmenu.find((item) => item.label === "Server");
  return serverMenu?.submenu as MenuItemConstructorOptions[];
}

function findDesktopSettingsServerSubmenu(
  template: MenuItemConstructorOptions[],
): MenuItemConstructorOptions[] {
  const appSubmenu = template[0]?.submenu as MenuItemConstructorOptions[];
  const desktopSettingsMenu = appSubmenu.find(
    (item) => item.label === "Desktop Settings",
  );
  const desktopSettingsSubmenu =
    desktopSettingsMenu?.submenu as MenuItemConstructorOptions[];
  const serverMenu = desktopSettingsSubmenu.find(
    (item) => item.label === "Server",
  );
  return serverMenu?.submenu as MenuItemConstructorOptions[];
}

describe("application menu", () => {
  it("reopens the last closed tab from the File menu", () => {
    const reopenClosedTab = vi.fn();
    const template = buildApplicationMenuTemplate(
      menuArgs(() => {}, {
        accelerators: {
          closeWindowOrSideTab: undefined,
          createNewWindow: undefined,
          openNewTab: undefined,
          openNewThread: undefined,
          openSettings: undefined,
          reopenClosedTab: "CommandOrControl+Shift+T",
        },
        reopenClosedTab,
      }),
    );
    const fileMenu = template.find((item) => item.label === "File");
    const submenu = fileMenu?.submenu as MenuItemConstructorOptions[];
    const reopen = submenu.find((item) => item.label === "Reopen Closed Tab");

    expect(reopen?.accelerator).toBe("CommandOrControl+Shift+T");
    reopen?.click?.({} as never, {} as BaseWindow, {} as never);
    expect(reopenClosedTab).toHaveBeenCalledTimes(1);
  });

  it("closes a native panel when Electron omits its window", () => {
    vi.mocked(Menu.sendActionToFirstResponder).mockClear();
    const closeWindowOrSideTab = vi.fn();
    const template = buildApplicationMenuTemplate(
      menuArgs(() => {}, { closeWindowOrSideTab }),
    );
    const fileMenu = template.find((item) => item.label === "File");
    const submenu = fileMenu?.submenu as MenuItemConstructorOptions[];
    const closeWindow = submenu.find((item) => item.label === "Close Window");

    closeWindow?.click?.({} as never, null as never, {} as never);

    expect(Menu.sendActionToFirstResponder).toHaveBeenCalledWith(
      "performClose:",
    );
    expect(closeWindowOrSideTab).not.toHaveBeenCalled();
  });

  it("forwards an undefined window for detached DevTools", () => {
    vi.mocked(Menu.sendActionToFirstResponder).mockClear();
    const closeWindowOrSideTab = vi.fn();
    const template = buildApplicationMenuTemplate(
      menuArgs(() => {}, { closeWindowOrSideTab }),
    );
    const fileMenu = template.find((item) => item.label === "File");
    const submenu = fileMenu?.submenu as MenuItemConstructorOptions[];
    const closeWindow = submenu.find((item) => item.label === "Close Window");

    closeWindow?.click?.({} as never, undefined, {} as never);

    expect(closeWindowOrSideTab).toHaveBeenCalledWith(undefined);
    expect(Menu.sendActionToFirstResponder).not.toHaveBeenCalled();
  });

  it("routes zoom shortcuts to the focused page's clamped zoom", () => {
    const zoomFocusedPage = vi.fn();
    const template = buildApplicationMenuTemplate(
      menuArgs(vi.fn(), { zoomFocusedPage }),
    );
    const viewMenu = template.find((item) => item.label === "View");
    const submenu = viewMenu?.submenu as MenuItemConstructorOptions[];

    for (const [label, accelerator] of [
      ["Actual Size", "CommandOrControl+0"],
      ["Zoom In", "CommandOrControl+Plus"],
      ["Zoom Out", "CommandOrControl+-"],
    ]) {
      const item = submenu.find((entry) => entry.label === label);
      expect(item?.accelerator).toBe(accelerator);
      item?.click?.({} as never, undefined, {} as never);
    }
    expect(zoomFocusedPage.mock.calls).toEqual([["reset"], ["in"], ["out"]]);
  });

  it("shows reload shortcuts without globally stealing browser commands", () => {
    const reloadWindow = vi.fn();
    const template = buildApplicationMenuTemplate(menuArgs(reloadWindow));
    const viewMenu = template.find((item) => item.label === "View");
    const submenu = viewMenu?.submenu as MenuItemConstructorOptions[];
    const reload = submenu.find((item) => item.label === "Reload");
    const forceReload = submenu.find((item) => item.label === "Force Reload");
    const focusedWindow = {} as BaseWindow;

    expect(reload?.accelerator).toBe("CommandOrControl+R");
    expect(reload?.registerAccelerator).toBe(false);
    expect(forceReload?.accelerator).toBe("CommandOrControl+Shift+R");
    expect(forceReload?.registerAccelerator).toBe(false);
    reload?.click?.({} as never, focusedWindow, {} as never);
    forceReload?.click?.({} as never, focusedWindow, {} as never);
    expect(reloadWindow).toHaveBeenNthCalledWith(1, focusedWindow, false);
    expect(reloadWindow).toHaveBeenNthCalledWith(2, focusedWindow, true);
  });

  it("builds a Server menu with multiple custom targets and separate add/edit actions", () => {
    const selectServer = vi.fn();
    const setServerUrl = vi.fn();
    const addServer = vi.fn();
    const template = buildApplicationMenuTemplate(
      menuArgs(() => {}, {
        selectServer,
        servers: [
          { checked: false, id: "builtin", name: BUILTIN_SERVER_NAME },
          {
            checked: true,
            id: "custom:https://first.example",
            name: "first.example",
          },
          {
            checked: false,
            id: "custom:https://second.example",
            name: "second.example",
          },
        ],
        setServerUrl,
        addServer,
      }),
    );
    const serverSubmenu = findServerSubmenu(template);

    expect(serverSubmenu).toHaveLength(6);
    expect(
      serverSubmenu.slice(0, 3).map((item) => [item.type, item.checked]),
    ).toEqual([
      ["radio", false],
      ["radio", true],
      ["radio", false],
    ]);
    expect(serverSubmenu[3]?.type).toBe("separator");
    expect(serverSubmenu[4]?.label).toBe("Add Server…");
    expect(serverSubmenu[5]?.label).toBe(SET_SERVER_URL_MENU_LABEL);
    serverSubmenu[1]?.click?.({} as never, undefined, {} as never);
    serverSubmenu[2]?.click?.({} as never, undefined, {} as never);
    expect(selectServer).toHaveBeenNthCalledWith(
      1,
      "custom:https://first.example",
    );
    expect(selectServer).toHaveBeenNthCalledWith(
      2,
      "custom:https://second.example",
    );
    serverSubmenu[4]?.click?.({} as never, undefined, {} as never);
    expect(addServer).toHaveBeenCalledTimes(1);
    serverSubmenu[5]?.click?.({} as never, undefined, {} as never);
    expect(setServerUrl).toHaveBeenCalledTimes(1);
  });

  it("offers the Server menu under Desktop Settings with Window → Server as an alias", () => {
    const selectServer = vi.fn();
    const addServer = vi.fn();
    const template = buildApplicationMenuTemplate(
      menuArgs(() => {}, {
        addServer,
        selectServer,
        servers: [
          { checked: true, id: "builtin", name: "This Mac" },
          {
            checked: false,
            id: "custom:https://first.example",
            name: "first.example",
          },
        ],
      }),
    );
    const desktopSettingsServerSubmenu =
      findDesktopSettingsServerSubmenu(template);
    const labels = (items: MenuItemConstructorOptions[]) =>
      items.map((item) => item.label ?? `<${item.type}>`);

    expect(labels(desktopSettingsServerSubmenu)).toEqual([
      "This Mac",
      "first.example",
      "<separator>",
      "Add Server…",
      SET_SERVER_URL_MENU_LABEL,
    ]);
    expect(labels(findServerSubmenu(template))).toEqual(
      labels(desktopSettingsServerSubmenu),
    );
    desktopSettingsServerSubmenu[1]?.click?.(
      {} as never,
      undefined,
      {} as never,
    );
    desktopSettingsServerSubmenu[3]?.click?.(
      {} as never,
      undefined,
      {} as never,
    );
    expect(selectServer).toHaveBeenCalledWith("custom:https://first.example");
    expect(addServer).toHaveBeenCalledTimes(1);
  });

  it("explains an empty Connect list with a disabled row when the sync was skipped", () => {
    const template = buildApplicationMenuTemplate(
      menuArgs(() => {}, {
        connectServersSkipReason: "no-credential",
        servers: [
          { checked: false, id: "builtin", name: BUILTIN_SERVER_NAME },
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
        BUILTIN_SERVER_NAME,
        "old-host.tailnet.ts.net:38886",
        CONNECT_SERVERS_SKIPPED_MENU_LABELS["no-credential"],
        "<separator>",
        "Add Server…",
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
    vi.mocked(Menu.sendActionToFirstResponder).mockClear();
    const template = buildApplicationMenuTemplate(
      menuArgs(() => {}, { isMac: false }),
    );
    const appMenu = template[0]?.submenu as MenuItemConstructorOptions[];
    const windowMenu = template.find((item) => item.label === "Window");
    const windowSubmenu = windowMenu?.submenu as MenuItemConstructorOptions[];
    const viewMenu = template.find((item) => item.label === "View");
    const viewSubmenu = viewMenu?.submenu as MenuItemConstructorOptions[];
    const fileMenu = template.find((item) => item.label === "File");
    const fileSubmenu = fileMenu?.submenu as MenuItemConstructorOptions[];
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

    closeWindow?.click?.({} as never, null as never, {} as never);
    expect(Menu.sendActionToFirstResponder).not.toHaveBeenCalled();
  });
});
