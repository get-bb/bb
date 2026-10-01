import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { ipcMain } from "electron";
import {
  resolveDesktopExternalUrl,
  resolveEditorFilePath,
} from "@bb/desktop-contract";
import { BB_DESKTOP_OPEN_EXTERNAL_URL_CHANNEL } from "./desktop-update-ipc.js";

type OpenExternal = (url: string) => Promise<void>;

async function isRegularFile(path: string): Promise<boolean> {
  if (!isAbsolute(path)) {
    return false;
  }
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export async function openDesktopExternalUrl(
  value: unknown,
  openExternal: OpenExternal,
): Promise<boolean> {
  const url = resolveDesktopExternalUrl(value);
  if (url === null) {
    return false;
  }
  const filePath = resolveEditorFilePath(url);
  if (filePath !== null && !(await isRegularFile(filePath))) {
    return false;
  }
  await openExternal(url);
  return true;
}

export function registerDesktopExternalUrlIpc(
  openExternal: OpenExternal,
): void {
  ipcMain.on(
    BB_DESKTOP_OPEN_EXTERNAL_URL_CHANNEL,
    (_event, payload: unknown) => {
      void openDesktopExternalUrl(payload, openExternal);
    },
  );
}
