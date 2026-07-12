import {
  app,
  Menu,
  type BaseWindow,
  type MenuItemConstructorOptions,
} from "electron";
import type { ApplicationMenuAccelerators } from "./desktop-menu-shortcuts.js";

export const SERVER_DAEMON_LOGS_MENU_LABEL = "Server & Daemon Logs";
export const OPEN_NEW_TAB_MENU_LABEL = "New Tab";
export const NEW_THREAD_MENU_LABEL = "New Thread";
export const NEW_WINDOW_MENU_LABEL = "New Window";
export const CLOSE_WINDOW_MENU_LABEL = "Close Window";
export const OPEN_SETTINGS_MENU_LABEL = "Settings…";
export const TOGGLE_DEVELOPER_TOOLS_MENU_LABEL = "Toggle Developer Tools";
export const TOGGLE_DEVELOPER_TOOLS_ACCELERATOR = "Command+Option+I";
export const RELOAD_ACCELERATOR = "CommandOrControl+R";
export const FORCE_RELOAD_ACCELERATOR = "CommandOrControl+Shift+R";
export const SERVER_MENU_LABEL = "Server";
export const SERVER_MENU_ITEM_ID = "bb-server-menu";
export const SET_SERVER_URL_MENU_LABEL = "Set Server URL…";

export interface ApplicationMenuServerItem {
  checked: boolean;
  id: string;
  name: string;
}

export interface InstallApplicationMenuArgs {
  accelerators: ApplicationMenuAccelerators;
  openNewTab(): void;
  openNewThread(): void;
  openSettings(): void;
  reloadWindow(
    browserWindow: BaseWindow | undefined,
    ignoreCache: boolean,
  ): void;
  closeWindowOrSideTab(browserWindow: BaseWindow | undefined): void;
  createNewWindow(): void;
  openServerDaemonLogs(): void;
  selectServer(serverId: string): void;
  setServerUrl(): void;
  /** Fired when the Window ▸ Server submenu opens (freshness trigger). */
  onServerMenuWillShow?: () => void;
  serverDaemonLogsMenuEnabled: boolean;
  servers: ApplicationMenuServerItem[];
}

function createServerDaemonLogsMenuItems(
  args: InstallApplicationMenuArgs,
): MenuItemConstructorOptions[] {
  return [
    { type: "separator" },
    {
      enabled: args.serverDaemonLogsMenuEnabled,
      label: SERVER_DAEMON_LOGS_MENU_LABEL,
      click() {
        args.openServerDaemonLogs();
      },
    },
  ];
}

function createServerMenuItems(
  args: InstallApplicationMenuArgs,
): MenuItemConstructorOptions[] {
  const serverItems: MenuItemConstructorOptions[] = args.servers.map(
    (server) => ({
      checked: server.checked,
      click() {
        args.selectServer(server.id);
      },
      label: server.name,
      type: "radio" as const,
    }),
  );
  return [
    ...serverItems,
    { type: "separator" },
    {
      label: SET_SERVER_URL_MENU_LABEL,
      click() {
        args.setServerUrl();
      },
    },
  ];
}

export function buildApplicationMenuTemplate(
  args: InstallApplicationMenuArgs,
): MenuItemConstructorOptions[] {
  return [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        {
          accelerator: args.accelerators.openSettings,
          click() {
            args.openSettings();
          },
          label: OPEN_SETTINGS_MENU_LABEL,
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [
        {
          accelerator: args.accelerators.openNewTab,
          click() {
            args.openNewTab();
          },
          label: OPEN_NEW_TAB_MENU_LABEL,
        },
        {
          accelerator: args.accelerators.openNewThread,
          click() {
            args.openNewThread();
          },
          label: NEW_THREAD_MENU_LABEL,
        },
        {
          accelerator: args.accelerators.createNewWindow,
          click() {
            args.createNewWindow();
          },
          label: NEW_WINDOW_MENU_LABEL,
        },
        { type: "separator" },
        {
          accelerator: args.accelerators.closeWindowOrSideTab,
          click(_menuItem, browserWindow) {
            args.closeWindowOrSideTab(browserWindow);
          },
          label: CLOSE_WINDOW_MENU_LABEL,
        },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        {
          accelerator: RELOAD_ACCELERATOR,
          label: "Reload",
          registerAccelerator: false,
          click(_menuItem, browserWindow) {
            args.reloadWindow(browserWindow, false);
          },
        },
        {
          accelerator: FORCE_RELOAD_ACCELERATOR,
          label: "Force Reload",
          registerAccelerator: false,
          click(_menuItem, browserWindow) {
            args.reloadWindow(browserWindow, true);
          },
        },
        {
          accelerator: TOGGLE_DEVELOPER_TOOLS_ACCELERATOR,
          label: TOGGLE_DEVELOPER_TOOLS_MENU_LABEL,
          role: "toggleDevTools",
        },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        ...createServerDaemonLogsMenuItems(args),
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { type: "separator" },
        {
          id: SERVER_MENU_ITEM_ID,
          label: SERVER_MENU_LABEL,
          submenu: createServerMenuItems(args),
        },
        { type: "separator" },
        { role: "front" },
      ],
    },
  ];
}

export function installApplicationMenu(args: InstallApplicationMenuArgs): void {
  const menu = Menu.buildFromTemplate(buildApplicationMenuTemplate(args));
  const onServerMenuWillShow = args.onServerMenuWillShow;
  if (onServerMenuWillShow !== undefined) {
    menu
      .getMenuItemById(SERVER_MENU_ITEM_ID)
      ?.submenu?.on("menu-will-show", () => {
        onServerMenuWillShow();
      });
  }
  Menu.setApplicationMenu(menu);
}
