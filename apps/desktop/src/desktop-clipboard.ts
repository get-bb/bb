import { bbDesktopClipboardContentSchema } from "@bb/desktop-contract";
import { clipboard, ClipboardItem, ipcMain } from "electron";
import { BB_DESKTOP_WRITE_CLIPBOARD_CHANNEL } from "./desktop-window-command-ipc.js";

export function registerDesktopClipboardIpc(
  applicationWindowWebContentsIds: ReadonlySet<number>,
): void {
  ipcMain.handle(
    BB_DESKTOP_WRITE_CLIPBOARD_CHANNEL,
    async (event, payload: unknown) => {
      if (!applicationWindowWebContentsIds.has(event.sender.id)) {
        throw new Error("Clipboard writes are limited to bb windows");
      }
      const { text, html } = bbDesktopClipboardContentSchema.parse(payload);
      if (html === undefined) {
        await clipboard.writeText(text);
        return;
      }
      await clipboard.write([
        new ClipboardItem({ "text/plain": text, "text/html": html }),
      ]);
    },
  );
}
