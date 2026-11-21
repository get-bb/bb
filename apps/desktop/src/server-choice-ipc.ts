import {
  bbDesktopConnectSignInLabel,
  bbDesktopServerChoiceSchema,
  type BbDesktopServerList,
} from "@bb/desktop-contract";
import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import {
  BB_DESKTOP_ADD_SERVER_CHANNEL,
  BB_DESKTOP_GET_SERVER_CHOICES_CHANNEL,
  BB_DESKTOP_SELECT_SERVER_CHANNEL,
  BB_DESKTOP_SIGN_IN_TO_CONNECT_CHANNEL,
} from "./desktop-window-command-ipc.js";

export function registerServerChoiceIpc({
  applicationWindowWebContentsIds,
  onListRequested,
  list,
  select,
  addServer,
  signInToConnect,
  onError,
}: {
  applicationWindowWebContentsIds: ReadonlySet<number>;
  onListRequested(): void;
  list(): BbDesktopServerList;
  select(id: string): Promise<void>;
  addServer(): void;
  signInToConnect(): void;
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
