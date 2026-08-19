import type { WebContents } from "electron";
import { BB_DESKTOP_SELECT_ALL_CHANNEL } from "./desktop-window-command-ipc.js";

type DesktopSelectAllWebContents = Pick<
  WebContents,
  "id" | "isDestroyed" | "selectAll" | "send"
>;

export function requestDesktopSelectAll(
  target: DesktopSelectAllWebContents,
  applicationWindowWebContentsIds: ReadonlySet<number>,
): void {
  if (target.isDestroyed()) return;
  if (!applicationWindowWebContentsIds.has(target.id)) {
    target.selectAll();
    return;
  }
  target.send(BB_DESKTOP_SELECT_ALL_CHANNEL, null);
}

export function handleDesktopSelectAllFallback(
  sender: Pick<WebContents, "id" | "selectAll">,
  applicationWindowWebContentsIds: ReadonlySet<number>,
): boolean {
  if (!applicationWindowWebContentsIds.has(sender.id)) {
    return false;
  }
  sender.selectAll();
  return true;
}
