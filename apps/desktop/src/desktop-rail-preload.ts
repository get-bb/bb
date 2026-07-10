import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import {
  bbDesktopServerSourceSchema,
  bbDesktopThemeResolvedSchema,
  type BbDesktopThemeResolved,
} from "@bb/desktop-contract";
import { z } from "zod";
import {
  BB_DESKTOP_RAIL_ADD_SERVER_CHANNEL,
  BB_DESKTOP_RAIL_CONTEXT_MENU_CHANNEL,
  BB_DESKTOP_RAIL_SET_ACTIVE_CHANNEL,
  BB_DESKTOP_RAIL_STATE_CHANNEL,
  BB_DESKTOP_RAIL_THEME_CHANNEL,
} from "./desktop-rail-ipc.js";
import type { DesktopRailViewModel } from "./desktop-rail-view-model.js";

const railServerTileSchema = z
  .object({
    active: z.boolean(),
    id: z.string().min(1),
    initial: z.string().min(1),
    name: z.string().min(1),
    source: bbDesktopServerSourceSchema,
    status: z.enum(["connected", "offline", "incompatible", "unknown"]),
  })
  .strict();

const railViewModelSchema = z
  .object({
    servers: z.array(railServerTileSchema),
  })
  .strict();

const railContextMenuRequestSchema = z
  .object({
    id: z.string().min(1),
    source: bbDesktopServerSourceSchema,
  })
  .strict();

export type DesktopRailStateHandler = (state: DesktopRailViewModel) => void;
export type DesktopRailThemeHandler = (theme: BbDesktopThemeResolved) => void;
export type DesktopRailUnsubscribe = () => void;

export interface BbDesktopRailApi {
  addServer(): void;
  onState(handler: DesktopRailStateHandler): DesktopRailUnsubscribe;
  onTheme(handler: DesktopRailThemeHandler): DesktopRailUnsubscribe;
  setActive(id: string): void;
  showContextMenu(request: { id: string; source: string }): void;
}

function onState(handler: DesktopRailStateHandler): DesktopRailUnsubscribe {
  const listener = (_event: IpcRendererEvent, payload: unknown): void => {
    const parsed = railViewModelSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    handler(parsed.data);
  };
  ipcRenderer.on(BB_DESKTOP_RAIL_STATE_CHANNEL, listener);
  return () => {
    ipcRenderer.removeListener(BB_DESKTOP_RAIL_STATE_CHANNEL, listener);
  };
}

function onTheme(handler: DesktopRailThemeHandler): DesktopRailUnsubscribe {
  const listener = (_event: IpcRendererEvent, payload: unknown): void => {
    const parsed = bbDesktopThemeResolvedSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    handler(parsed.data);
  };
  ipcRenderer.on(BB_DESKTOP_RAIL_THEME_CHANNEL, listener);
  return () => {
    ipcRenderer.removeListener(BB_DESKTOP_RAIL_THEME_CHANNEL, listener);
  };
}

const railApi: BbDesktopRailApi = {
  addServer() {
    ipcRenderer.send(BB_DESKTOP_RAIL_ADD_SERVER_CHANNEL);
  },
  onState,
  onTheme,
  setActive(id: string) {
    if (typeof id !== "string" || id.length === 0) {
      return;
    }
    void ipcRenderer.invoke(BB_DESKTOP_RAIL_SET_ACTIVE_CHANNEL, { id });
  },
  showContextMenu(request) {
    const parsed = railContextMenuRequestSchema.safeParse(request);
    if (!parsed.success) {
      return;
    }
    ipcRenderer.send(BB_DESKTOP_RAIL_CONTEXT_MENU_CHANNEL, parsed.data);
  },
};

contextBridge.exposeInMainWorld("bbDesktopRail", railApi);
