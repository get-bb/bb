import { app, Menu, type MenuItemConstructorOptions } from "electron";

export const SERVER_DAEMON_LOGS_MENU_LABEL = "Server & Daemon Logs";
export const OPEN_NEW_TAB_ACCELERATOR = "CmdOrCtrl+T";
export const OPEN_NEW_TAB_MENU_LABEL = "New Tab";
export const TOGGLE_DEVELOPER_TOOLS_MENU_LABEL = "Toggle Developer Tools";
export const TOGGLE_DEVELOPER_TOOLS_ACCELERATOR = "Command+Option+I";

export interface InstallApplicationMenuArgs {
  openNewTab(): void;
  createNewWindow(): void;
  openServerDaemonLogs(): void;
  serverDaemonLogsMenuEnabled: boolean;
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

export function buildApplicationMenuTemplate(
  args: InstallApplicationMenuArgs,
): MenuItemConstructorOptions[] {
  return [
    {
      label: app.name,
      submenu: [
        { role: "about" },
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
          accelerator: OPEN_NEW_TAB_ACCELERATOR,
          click() {
            args.openNewTab();
          },
          label: OPEN_NEW_TAB_MENU_LABEL,
        },
        {
          accelerator: "CmdOrCtrl+N",
          click() {
            args.createNewWindow();
          },
          label: "New Window",
        },
        { type: "separator" },
        { role: "close" },
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
        { role: "reload" },
        { role: "forceReload" },
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
        { role: "front" },
      ],
    },
  ];
}

export function installApplicationMenu(args: InstallApplicationMenuArgs): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(buildApplicationMenuTemplate(args)),
  );
}
