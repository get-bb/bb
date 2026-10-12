import {
  bbDesktopServerChoiceSchema,
  type BbDesktopServerChoice,
} from "@bb/desktop-contract";
import { ipcMain } from "electron";
import {
  BB_DESKTOP_GET_SERVER_CHOICES_CHANNEL,
  BB_DESKTOP_SELECT_SERVER_CHANNEL,
} from "./desktop-window-command-ipc.js";

export function registerServerChoiceIpc({
  applicationWindowWebContentsIds,
  onListRequested,
  list,
  select,
  onError,
}: {
  applicationWindowWebContentsIds: ReadonlySet<number>;
  onListRequested(): void;
  list(webContentsId: number): BbDesktopServerChoice[];
  select(webContentsId: number, id: string): Promise<void>;
  onError(error: unknown): void;
}): void {
  ipcMain.handle(BB_DESKTOP_GET_SERVER_CHOICES_CHANNEL, (event) => {
    if (
      !applicationWindowWebContentsIds.has(event.sender.id) ||
      event.senderFrame !== event.sender.mainFrame
    ) {
      throw new Error("Server choices are limited to bb windows");
    }
    onListRequested();
    return list(event.sender.id);
  });
  ipcMain.on(BB_DESKTOP_SELECT_SERVER_CHANNEL, (event, payload: unknown) => {
    const parsed = bbDesktopServerChoiceSchema.shape.id.safeParse(payload);
    if (
      !applicationWindowWebContentsIds.has(event.sender.id) ||
      event.senderFrame !== event.sender.mainFrame ||
      !parsed.success
    )
      return;
    if (
      !list(event.sender.id).some(
        (choice) => choice.id === parsed.data && !choice.active,
      )
    )
      return;
    void select(event.sender.id, parsed.data).catch(onError);
  });
}
