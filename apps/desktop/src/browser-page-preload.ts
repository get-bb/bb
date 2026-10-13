import { contextBridge, ipcRenderer } from "electron";
import {
  BB_DESKTOP_BROWSER_GUEST_MESSAGE_CHANNEL,
  BB_DESKTOP_BROWSER_PAGE_BRIDGE_KEY,
  BB_DESKTOP_BROWSER_PAGE_WORLD_ID,
} from "./desktop-browser-ipc.js";

contextBridge.exposeInIsolatedWorld(
  BB_DESKTOP_BROWSER_PAGE_WORLD_ID,
  BB_DESKTOP_BROWSER_PAGE_BRIDGE_KEY,
  {
    postMessage(channel: unknown, data: unknown): void {
      ipcRenderer.send(BB_DESKTOP_BROWSER_GUEST_MESSAGE_CHANNEL, {
        channel,
        data,
      });
    },
  },
);
