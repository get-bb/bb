import type { MenuItemConstructorOptions } from "electron";
import { describe, expect, it, vi } from "vitest";
import {
  CLOSE_WINDOW_ACCELERATOR,
  CLOSE_WINDOW_MENU_LABEL,
  OPEN_NEW_TAB_ACCELERATOR,
  OPEN_NEW_TAB_MENU_LABEL,
  SERVER_DAEMON_LOGS_MENU_LABEL,
  TOGGLE_DEVELOPER_TOOLS_ACCELERATOR,
  TOGGLE_DEVELOPER_TOOLS_MENU_LABEL,
  buildApplicationMenuTemplate,
} from "../src/menu.js";

vi.mock("electron", () => ({
  app: {
    name: "bb",
  },
  Menu: {
    buildFromTemplate(template: MenuItemConstructorOptions[]) {
      return template;
    },
    setApplicationMenu() {},
  },
}));

interface FindSubmenuItemArgs {
  itemLabel: string;
  parentLabel: string;
  template: MenuItemConstructorOptions[];
}

function findSubmenuItem(
  args: FindSubmenuItemArgs,
): MenuItemConstructorOptions | null {
  const parentItem = args.template.find(
    (templateItem) => templateItem.label === args.parentLabel,
  );
  if (parentItem === undefined || !Array.isArray(parentItem.submenu)) {
    return null;
  }

  return (
    parentItem.submenu.find(
      (submenuItem) => submenuItem.label === args.itemLabel,
    ) ?? null
  );
}

describe("application menu", () => {
  it("shows a developer tools toggle in the view menu", () => {
    const template = buildApplicationMenuTemplate({
      closeWindowOrSideTab() {},
      createNewWindow() {},
      openNewTab() {},
      openServerDaemonLogs() {},
      serverDaemonLogsMenuEnabled: true,
    });

    const menuItem = findSubmenuItem({
      itemLabel: TOGGLE_DEVELOPER_TOOLS_MENU_LABEL,
      parentLabel: "View",
      template,
    });

    expect(menuItem).not.toBeNull();
    expect(menuItem?.accelerator).toBe(TOGGLE_DEVELOPER_TOOLS_ACCELERATOR);
    expect(menuItem?.role).toBe("toggleDevTools");
  });

  it("shows a new-tab command in the file menu", () => {
    const openNewTab = vi.fn();
    const template = buildApplicationMenuTemplate({
      closeWindowOrSideTab() {},
      createNewWindow() {},
      openNewTab,
      openServerDaemonLogs() {},
      serverDaemonLogsMenuEnabled: true,
    });

    const menuItem = findSubmenuItem({
      itemLabel: OPEN_NEW_TAB_MENU_LABEL,
      parentLabel: "File",
      template,
    });

    expect(menuItem).not.toBeNull();
    expect(menuItem?.accelerator).toBe(OPEN_NEW_TAB_ACCELERATOR);
    menuItem?.click?.(
      undefined as never,
      undefined as never,
      undefined as never,
    );
    expect(openNewTab).toHaveBeenCalledOnce();
  });

  it("routes the close-window accelerator through the app before closing", () => {
    const closeWindowOrSideTab = vi.fn();
    const browserWindow = {};
    const template = buildApplicationMenuTemplate({
      closeWindowOrSideTab,
      createNewWindow() {},
      openNewTab() {},
      openServerDaemonLogs() {},
      serverDaemonLogsMenuEnabled: true,
    });

    const menuItem = findSubmenuItem({
      itemLabel: CLOSE_WINDOW_MENU_LABEL,
      parentLabel: "File",
      template,
    });

    expect(menuItem).not.toBeNull();
    expect(menuItem?.accelerator).toBe(CLOSE_WINDOW_ACCELERATOR);
    expect(menuItem?.role).toBeUndefined();
    menuItem?.click?.(
      undefined as never,
      browserWindow as never,
      undefined as never,
    );
    expect(closeWindowOrSideTab).toHaveBeenCalledWith(browserWindow);
  });

  it("shows an enabled server and daemon logs item for owned runtimes", () => {
    const template = buildApplicationMenuTemplate({
      closeWindowOrSideTab() {},
      createNewWindow() {},
      openNewTab() {},
      openServerDaemonLogs() {},
      serverDaemonLogsMenuEnabled: true,
    });

    const menuItem = findSubmenuItem({
      itemLabel: SERVER_DAEMON_LOGS_MENU_LABEL,
      parentLabel: "View",
      template,
    });

    expect(menuItem).not.toBeNull();
    expect(menuItem?.enabled).toBe(true);
  });

  it("shows a disabled server and daemon logs item for attached runtimes", () => {
    const template = buildApplicationMenuTemplate({
      closeWindowOrSideTab() {},
      createNewWindow() {},
      openNewTab() {},
      openServerDaemonLogs() {},
      serverDaemonLogsMenuEnabled: false,
    });

    const menuItem = findSubmenuItem({
      itemLabel: SERVER_DAEMON_LOGS_MENU_LABEL,
      parentLabel: "View",
      template,
    });

    expect(menuItem).not.toBeNull();
    expect(menuItem?.enabled).toBe(false);
  });
});
