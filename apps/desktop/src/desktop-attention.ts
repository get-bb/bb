import {
  app,
  BrowserWindow,
  ipcMain,
  nativeImage,
  type IpcMainEvent,
  type NativeImage,
} from "electron";
import { z } from "zod";
import { BB_DESKTOP_SET_ATTENTION_THREADS_CHANNEL } from "./desktop-window-command-ipc.js";

const threadIdsSchema = z.array(z.string().min(1).max(256)).max(10000);
const attentionThreadsSchema = z.object({
  pendingThreadIds: threadIdsSchema,
  unreadThreadIds: threadIdsSchema,
});

export function registerDesktopAttentionIpc(
  applicationWindowWebContentsIds: ReadonlySet<number>,
): void {
  const reports = new Map<
    number,
    { origin: string; pending: string[]; unread: string[] }
  >();
  const tracked = new Set<number>();
  let overlayImage: NativeImage | undefined;

  function windows() {
    return BrowserWindow.getAllWindows().filter(
      (window) =>
        !window.isDestroyed() &&
        applicationWindowWebContentsIds.has(window.webContents.id),
    );
  }

  function overlayIcon() {
    if (overlayImage) return overlayImage;
    const bitmap = Buffer.alloc(16 * 16 * 4);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        if ((x - 7.5) ** 2 + (y - 7.5) ** 2 > 56) continue;
        bitmap.set([60, 70, 230, 255], (y * 16 + x) * 4);
      }
    }
    overlayImage = nativeImage.createFromBitmap(bitmap, {
      width: 16,
      height: 16,
    });
    return overlayImage;
  }

  function updateBadge() {
    const pending = new Set<string>();
    const unread = new Set<string>();
    for (const report of reports.values()) {
      for (const id of report.pending) pending.add(`${report.origin}/${id}`);
      for (const id of report.unread) unread.add(`${report.origin}/${id}`);
    }
    const pendingCount = pending.size;
    const hasUnread = [...unread].some((key) => !pending.has(key));
    if (process.platform === "win32") {
      const overlay = pendingCount > 0 || hasUnread ? overlayIcon() : null;
      const description =
        pendingCount > 0
          ? `${pendingCount} ${pendingCount === 1 ? "thread needs" : "threads need"} your input`
          : hasUnread
            ? "Unread threads"
            : "";
      for (const window of windows())
        window.setOverlayIcon(overlay, description);
    } else if (process.platform === "darwin") {
      app.dock?.setBadge(
        pendingCount > 0 ? String(pendingCount) : hasUnread ? "•" : "",
      );
    } else {
      app.setBadgeCount(pendingCount);
    }
  }

  function senderWindow(event: IpcMainEvent) {
    if (
      !applicationWindowWebContentsIds.has(event.sender.id) ||
      event.senderFrame !== event.sender.mainFrame
    )
      return null;
    const window = BrowserWindow.fromWebContents(event.sender);
    return window && !window.isDestroyed() ? window : null;
  }

  ipcMain.on(
    BB_DESKTOP_SET_ATTENTION_THREADS_CHANNEL,
    (event, payload: unknown) => {
      if (!senderWindow(event)) return;
      const parsed = attentionThreadsSchema.safeParse(payload);
      if (!parsed.success) return;
      let origin: string;
      try {
        origin = new URL(event.sender.getURL()).origin;
      } catch {
        return;
      }
      const id = event.sender.id;
      reports.set(id, {
        origin,
        pending: parsed.data.pendingThreadIds,
        unread: parsed.data.unreadThreadIds,
      });
      if (!tracked.has(id)) {
        tracked.add(id);
        event.sender.on(
          "did-start-navigation",
          (_event, _url, isInPlace, isMainFrame) => {
            if (isMainFrame && !isInPlace) {
              reports.delete(id);
              updateBadge();
            }
          },
        );
        event.sender.on("render-process-gone", () => {
          reports.delete(id);
          updateBadge();
        });
        event.sender.once("destroyed", () => {
          reports.delete(id);
          tracked.delete(id);
          updateBadge();
        });
      }
      updateBadge();
    },
  );

  app.on("before-quit", () => {
    reports.clear();
    updateBadge();
  });
}
