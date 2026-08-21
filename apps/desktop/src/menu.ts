import {
  app,
  Menu,
  type BaseWindow,
  type MenuItemConstructorOptions,
} from "electron";
import type { ApplicationMenuAccelerators } from "./desktop-menu-shortcuts.js";

const SERVER_DAEMON_LOGS_MENU_LABEL = "Server & Daemon Logs";
const OPEN_NEW_TAB_MENU_LABEL = "New Tab";
const NEW_THREAD_MENU_LABEL = "New Thread";
const NEW_WINDOW_MENU_LABEL = "New Window";
const CLOSE_WINDOW_MENU_LABEL = "Close Window";
const OPEN_SETTINGS_MENU_LABEL = "Settings…";
const TOGGLE_DEVELOPER_TOOLS_MENU_LABEL = "Toggle Developer Tools";
const TOGGLE_DEVELOPER_TOOLS_ACCELERATOR = "Command+Option+I";
const RELOAD_ACCELERATOR = "CommandOrControl+R";
const FORCE_RELOAD_ACCELERATOR = "CommandOrControl+Shift+R";
const SERVER_MENU_LABEL = "Server";
const SERVER_MENU_ITEM_ID = "bb-server-menu";
export const SET_SERVER_URL_MENU_LABEL = "Set Server URL…";

interface ApplicationMenuServerItem {
  checked: boolean;
  id: string;
  name: string;
}

export interface InstallApplicationMenuArgs {
  accelerators: ApplicationMenuAccelerators;
  isMac: boolean;
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
        ...(args.isMac
          ? [
              { role: "services" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
            ]
          : []),
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
            // Electron sends null here for native panels such as the About
            // window. Its type defines only BaseWindow | undefined.
            // These panels have no Electron BaseWindow, so use the native
            // close action.
            if (browserWindow === null) {
              if (args.isMac) {
                Menu.sendActionToFirstResponder("performClose:");
              }
              return;
            }
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
          accelerator: args.isMac
            ? TOGGLE_DEVELOPER_TOOLS_ACCELERATOR
            : "Control+Shift+I",
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
        ...(args.isMac ? [{ role: "zoom" as const }] : []),
        { type: "separator" },
        {
          id: SERVER_MENU_ITEM_ID,
          label: SERVER_MENU_LABEL,
          submenu: createServerMenuItems(args),
        },
        ...(args.isMac
          ? [
              { type: "separator" as const },
              { role: "front" as const },
            ]
          : []),
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
