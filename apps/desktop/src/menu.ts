import {
  app,
  Menu,
  type BaseWindow,
  type MenuItemConstructorOptions,
} from "electron";
import type { BbDesktopZoomCommand } from "@bb/desktop-contract";
import type { ApplicationMenuAccelerators } from "./desktop-menu-shortcuts.js";
import type { ConnectServerSyncSkipReason } from "./connect-server-sync.js";
import { BUILTIN_SERVER_NAME } from "./server-target.js";

const SERVER_DAEMON_LOGS_MENU_LABEL = "Server & Daemon Logs";
const OPEN_NEW_TAB_MENU_LABEL = "New Tab";
const REOPEN_CLOSED_TAB_MENU_LABEL = "Reopen Closed Tab";
const NEW_THREAD_MENU_LABEL = "New Thread";
const NEW_WINDOW_MENU_LABEL = "New Window";
const CLOSE_WINDOW_MENU_LABEL = "Close Window";
const OPEN_SETTINGS_MENU_LABEL = "Settings…";
const TOGGLE_DEVELOPER_TOOLS_MENU_LABEL = "Toggle Developer Tools";
const TOGGLE_DEVELOPER_TOOLS_ACCELERATOR = "Command+Option+I";
const RELOAD_ACCELERATOR = "CommandOrControl+R";
const FORCE_RELOAD_ACCELERATOR = "CommandOrControl+Shift+R";
const DESKTOP_SETTINGS_MENU_LABEL = "Desktop Settings";
const SERVER_MENU_LABEL = "Server";
const DESKTOP_SETTINGS_SERVER_MENU_ITEM_ID = "bb-desktop-settings-server-menu";
const WINDOW_SERVER_MENU_ITEM_ID = "bb-server-menu";
const SERVER_MENU_ITEM_IDS = [
  DESKTOP_SETTINGS_SERVER_MENU_ITEM_ID,
  WINDOW_SERVER_MENU_ITEM_ID,
];
export const SET_SERVER_URL_MENU_LABEL = "Set Server URL…";
export const CONNECT_SERVERS_SKIPPED_MENU_LABELS: Record<
  ConnectServerSyncSkipReason,
  string
> = {
  "no-credential": "No Connect servers — sign in to bb Connect",
  "not-paired": `No Connect servers — Connect not paired on ${BUILTIN_SERVER_NAME}`,
  "plugin-disabled": "No Connect servers — Connect plugin disabled",
  unauthorized: "No Connect servers — sign in to bb Connect again",
  unavailable: "No Connect servers — could not reach bb Connect",
};

interface ApplicationMenuServerItem {
  checked: boolean;
  id: string;
  name: string;
}

export interface InstallApplicationMenuArgs {
  accelerators: ApplicationMenuAccelerators;
  isMac: boolean;
  openAbout(): void;
  openNewTab(): void;
  openNewThread(): void;
  openSettings(): void;
  reopenClosedTab(): void;
  reloadWindow(
    browserWindow: BaseWindow | undefined,
    ignoreCache: boolean,
  ): void;
  zoomFocusedPage(command: BbDesktopZoomCommand): void;
  closeWindowOrSideTab(browserWindow: BaseWindow | undefined): void;
  createNewWindow(): void;
  openServerDaemonLogs(): void;
  selectServer(serverId: string): void;
  setServerUrl(): void;
  addServer(): void;
  onServerMenuWillShow?: () => void;
  serverDaemonLogsMenuEnabled: boolean;
  servers: ApplicationMenuServerItem[];
  connectServersSkipReason: ConnectServerSyncSkipReason | null;
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

export type ServerMenuArgs = Pick<
  InstallApplicationMenuArgs,
  | "addServer"
  | "connectServersSkipReason"
  | "selectServer"
  | "servers"
  | "setServerUrl"
>;

export function createServerMenuItems(
  args: ServerMenuArgs,
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
  const skipReason = args.connectServersSkipReason;
  return [
    ...serverItems,
    ...(skipReason === null
      ? []
      : [
          {
            enabled: false,
            label: CONNECT_SERVERS_SKIPPED_MENU_LABELS[skipReason],
          },
        ]),
    { type: "separator" },
    {
      label: "Add Server…",
      click() {
        args.addServer();
      },
    },
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
        {
          label: `About ${app.name}`,
          click() {
            args.openAbout();
          },
        },
        { type: "separator" },
        {
          accelerator: args.accelerators.openSettings,
          click() {
            args.openSettings();
          },
          label: OPEN_SETTINGS_MENU_LABEL,
        },
        {
          label: DESKTOP_SETTINGS_MENU_LABEL,
          submenu: [
            {
              id: DESKTOP_SETTINGS_SERVER_MENU_ITEM_ID,
              label: SERVER_MENU_LABEL,
              submenu: createServerMenuItems(args),
            },
          ],
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
          accelerator: args.accelerators.reopenClosedTab,
          click() {
            args.reopenClosedTab();
          },
          label: REOPEN_CLOSED_TAB_MENU_LABEL,
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
        {
          accelerator: "CommandOrControl+0",
          label: "Actual Size",
          click() {
            args.zoomFocusedPage("reset");
          },
        },
        {
          accelerator: "CommandOrControl+Plus",
          label: "Zoom In",
          click() {
            args.zoomFocusedPage("in");
          },
        },
        {
          accelerator: "CommandOrControl+-",
          label: "Zoom Out",
          click() {
            args.zoomFocusedPage("out");
          },
        },
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
          id: WINDOW_SERVER_MENU_ITEM_ID,
          label: SERVER_MENU_LABEL,
          submenu: createServerMenuItems(args),
        },
        ...(args.isMac
          ? [{ type: "separator" as const }, { role: "front" as const }]
          : []),
      ],
    },
  ];
}

export function installApplicationMenu(args: InstallApplicationMenuArgs): void {
  const menu = Menu.buildFromTemplate(buildApplicationMenuTemplate(args));
  const onServerMenuWillShow = args.onServerMenuWillShow;
  if (onServerMenuWillShow !== undefined) {
    for (const id of SERVER_MENU_ITEM_IDS) {
      menu.getMenuItemById(id)?.submenu?.on("menu-will-show", () => {
        onServerMenuWillShow();
      });
    }
  }
  Menu.setApplicationMenu(menu);
}
