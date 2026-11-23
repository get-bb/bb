import {
  bbDesktopConnectSignInLabel,
  bbDesktopServerChoiceSchema,
  bbDesktopServerRouteSchema,
  type BbDesktopServerList,
  type BbDesktopServerRoute,
} from "@bb/desktop-contract";
import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import {
  BB_DESKTOP_ADD_SERVER_CHANNEL,
  BB_DESKTOP_GET_SERVER_CHOICES_CHANNEL,
  BB_DESKTOP_GET_SERVER_ROUTE_CHANNEL,
  BB_DESKTOP_SELECT_SERVER_CHANNEL,
  BB_DESKTOP_SET_SERVER_ROUTE_CHANNEL,
  BB_DESKTOP_SIGN_IN_TO_CONNECT_CHANNEL,
} from "./desktop-window-command-ipc.js";

export function registerServerChoiceIpc({
  applicationWindowWebContentsIds,
  onListRequested,
  list,
  select,
  addServer,
  signInToConnect,
  getRoute,
  setRoute,
  onError,
}: {
  applicationWindowWebContentsIds: ReadonlySet<number>;
  onListRequested(): void;
  list(): BbDesktopServerList;
  select(id: string): Promise<void>;
  addServer(): void;
  signInToConnect(): void;
  getRoute(): BbDesktopServerRoute | null;
  setRoute(url: string | null): Promise<void>;
  onError(error: unknown): void;
}): void {
  const fromApplicationWindow = (
    event: IpcMainEvent | IpcMainInvokeEvent,
  ): boolean =>
    applicationWindowWebContentsIds.has(event.sender.id) &&
    event.senderFrame === event.sender.mainFrame;
  ipcMain.handle(BB_DESKTOP_GET_SERVER_CHOICES_CHANNEL, (event) => {
    if (!fromApplicationWindow(event)) {
      throw new Error("Server choices are limited to bb windows");
    }
    onListRequested();
    return list();
  });
  ipcMain.on(BB_DESKTOP_SELECT_SERVER_CHANNEL, (event, payload: unknown) => {
    const parsed = bbDesktopServerChoiceSchema.shape.id.safeParse(payload);
    if (!fromApplicationWindow(event) || !parsed.success) return;
    if (
      !list().servers.some(
        (choice) => choice.id === parsed.data && !choice.active,
      )
    )
      return;
    void select(parsed.data).catch(onError);
  });
  ipcMain.handle(BB_DESKTOP_GET_SERVER_ROUTE_CHANNEL, (event) => {
    if (!fromApplicationWindow(event)) {
      throw new Error("Server routes are limited to bb windows");
    }
    return getRoute();
  });
  ipcMain.on(BB_DESKTOP_SET_SERVER_ROUTE_CHANNEL, (event, payload: unknown) => {
    const parsed =
      bbDesktopServerRouteSchema.shape.pinnedUrl.safeParse(payload);
    if (!fromApplicationWindow(event) || !parsed.success) return;
    const route = getRoute();
    if (
      route === null ||
      (parsed.data !== null &&
        !route.routes.some((option) => option.url === parsed.data))
    )
      return;
    void setRoute(parsed.data).catch(onError);
  });
  ipcMain.on(BB_DESKTOP_ADD_SERVER_CHANNEL, (event) => {
    if (fromApplicationWindow(event)) addServer();
  });
  ipcMain.on(BB_DESKTOP_SIGN_IN_TO_CONNECT_CHANNEL, (event) => {
    if (
      fromApplicationWindow(event) &&
      bbDesktopConnectSignInLabel(list().connectServersSkipReason) !== null
    )
      signInToConnect();
  });
}
