import { WebContentsView, ipcMain, type IpcMainEvent } from "electron";

import type { z } from "zod";
import {
  BB_DESKTOP_FIND_BAR_ACTIVATE_CHANNEL,
  BB_DESKTOP_FIND_BAR_CLOSE_CHANNEL,
  BB_DESKTOP_FIND_BAR_QUERY_CHANNEL,
  BB_DESKTOP_FIND_BAR_RESULT_CHANNEL,
  BB_DESKTOP_FIND_BAR_STEP_CHANNEL,
  findBarQueryRequestSchema,
  findBarStepRequestSchema,
  type FindBarResult,
} from "./find-bar-ipc.js";
import {
  FIND_BAR_VIEW_HEIGHT,
  FIND_BAR_VIEW_WIDTH,
  createFindBarViewUrl,
} from "./find-bar-view.js";
import type { BbDesktopWindowFindRequest } from "@bb/desktop-contract";

export interface FindViewBounds {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface FindViewHostWebContents {
  id: number;
  focus(): void;
  isDestroyed(): boolean;
  findInPage(
    text: string,
    options: { findNext: boolean; forward: boolean },
  ): number;
  stopFindInPage(action: "clearSelection"): void;
  on(
    event: "found-in-page",
    listener: (
      event: unknown,
      result: {
        requestId: number;
        activeMatchOrdinal: number;
        matches: number;
      },
    ) => void,
  ): void;
}

export interface FindViewHostContentView {
  addChildView(view: WebContentsView): void;
  removeChildView(view: WebContentsView): void;
}

export interface FindViewHostWindow {
  contentView: FindViewHostContentView;
  getContentBounds(): FindViewBounds;
  webContents: FindViewHostWebContents;
}

export interface DesktopFindViewManager {
  open(
    hostWindow: FindViewHostWindow,
    request: BbDesktopWindowFindRequest,
  ): void;
  close(hostWindow: FindViewHostWindow): void;
  layout(hostWindow: FindViewHostWindow): void;
  releaseWindow(hostWebContentsId: number): void;
  destroyAll(): void;
}

export interface CreateDesktopFindViewManagerArgs {
  preloadPath: string;
}

interface FindViewEntry {
  activeRequestId: number | null;
  hostWindow: FindViewHostWindow;
  query: string;
  topOffset: number;
  view: WebContentsView;
  visible: boolean;
}

function createFindBarView(preloadPath: string): WebContentsView {
  return new WebContentsView({
    webPreferences: {
      preload: preloadPath,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      transparent: true,
    },
  });
}

export function findBarViewBounds(
  contentBounds: FindViewBounds,
  topOffset: number,
): FindViewBounds {
  const height = Math.min(FIND_BAR_VIEW_HEIGHT, contentBounds.height);
  return {
    x: Math.max(0, contentBounds.width - FIND_BAR_VIEW_WIDTH),
    y: Math.max(0, Math.min(topOffset, contentBounds.height - height)),
    width: Math.min(FIND_BAR_VIEW_WIDTH, contentBounds.width),
    height,
  };
}

export function createDesktopFindViewManager({
  preloadPath,
}: CreateDesktopFindViewManagerArgs): DesktopFindViewManager {
  const entriesByHostId = new Map<number, FindViewEntry>();
  const entriesByViewId = new Map<number, FindViewEntry>();
  const observedHostIds = new Set<number>();

  function observeHost(hostWindow: FindViewHostWindow): void {
    if (observedHostIds.has(hostWindow.webContents.id)) {
      return;
    }
    observedHostIds.add(hostWindow.webContents.id);
    hostWindow.webContents.on("found-in-page", (_event, result) => {
      const entry = entriesByHostId.get(hostWindow.webContents.id);
      if (
        entry === undefined ||
        entry.activeRequestId !== result.requestId ||
        entry.view.webContents.isDestroyed()
      ) {
        return;
      }
      entry.view.webContents.send(BB_DESKTOP_FIND_BAR_RESULT_CHANNEL, {
        activeMatchOrdinal: Math.max(0, result.activeMatchOrdinal),
        matches: Math.max(0, result.matches),
      } satisfies FindBarResult);
    });
  }

  function ensureEntry(hostWindow: FindViewHostWindow): FindViewEntry {
    const existing = entriesByHostId.get(hostWindow.webContents.id);
    if (existing !== undefined) {
      return existing;
    }
    const view = createFindBarView(preloadPath);
    view.setBackgroundColor("#00000000");
    void view.webContents.loadURL(createFindBarViewUrl());
    const entry: FindViewEntry = {
      activeRequestId: null,
      hostWindow,
      query: "",
      topOffset: 0,
      view,
      visible: false,
    };
    entriesByHostId.set(hostWindow.webContents.id, entry);
    entriesByViewId.set(view.webContents.id, entry);
    hostWindow.contentView.addChildView(view);
    observeHost(hostWindow);
    return entry;
  }

  function layoutEntry(entry: FindViewEntry): void {
    entry.view.setBounds(
      findBarViewBounds(entry.hostWindow.getContentBounds(), entry.topOffset),
    );
  }

  function stopFind(entry: FindViewEntry): void {
    entry.activeRequestId = null;
    if (!entry.hostWindow.webContents.isDestroyed()) {
      entry.hostWindow.webContents.stopFindInPage("clearSelection");
    }
  }

  function closeEntry(entry: FindViewEntry): void {
    stopFind(entry);
    entry.visible = false;
    entry.view.setVisible(false);
    if (!entry.hostWindow.webContents.isDestroyed()) {
      entry.hostWindow.webContents.focus();
    }
  }

  function destroyEntry(entry: FindViewEntry): void {
    entriesByHostId.delete(entry.hostWindow.webContents.id);
    entriesByViewId.delete(entry.view.webContents.id);
    observedHostIds.delete(entry.hostWindow.webContents.id);
    entry.hostWindow.contentView.removeChildView(entry.view);
    if (!entry.view.webContents.isDestroyed()) {
      entry.view.webContents.close();
    }
  }

  function entryForEvent(event: IpcMainEvent): FindViewEntry | null {
    return entriesByViewId.get(event.sender.id) ?? null;
  }

  function registerViewCommand<T>(
    channel: string,
    schema: z.ZodType<T>,
    run: (args: { entry: FindViewEntry; request: T }) => void,
  ): void {
    ipcMain.on(channel, (event, payload: unknown) => {
      const entry = entryForEvent(event);
      if (entry === null) {
        return;
      }
      const parsed = schema.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      run({ entry, request: parsed.data });
    });
  }

  registerViewCommand(
    BB_DESKTOP_FIND_BAR_QUERY_CHANNEL,
    findBarQueryRequestSchema,
    ({ entry, request }) => {
      entry.query = request.text;
      if (request.text.length === 0) {
        stopFind(entry);
        return;
      }
      entry.activeRequestId = entry.hostWindow.webContents.findInPage(
        request.text,
        { forward: true, findNext: true },
      );
    },
  );

  registerViewCommand(
    BB_DESKTOP_FIND_BAR_STEP_CHANNEL,
    findBarStepRequestSchema,
    ({ entry, request }) => {
      if (entry.query.length === 0) {
        return;
      }
      entry.activeRequestId = entry.hostWindow.webContents.findInPage(
        entry.query,
        { forward: request.forward, findNext: false },
      );
    },
  );

  ipcMain.on(BB_DESKTOP_FIND_BAR_CLOSE_CHANNEL, (event) => {
    const entry = entryForEvent(event);
    if (entry === null) {
      return;
    }
    closeEntry(entry);
  });

  return {
    open(hostWindow, request) {
      const entry = ensureEntry(hostWindow);
      entry.topOffset = request.topOffset;
      hostWindow.contentView.removeChildView(entry.view);
      hostWindow.contentView.addChildView(entry.view);
      layoutEntry(entry);
      entry.visible = true;
      entry.view.setVisible(true);
      entry.view.webContents.focus();
      entry.view.webContents.send(BB_DESKTOP_FIND_BAR_ACTIVATE_CHANNEL);
    },
    close(hostWindow) {
      const entry = entriesByHostId.get(hostWindow.webContents.id);
      if (entry === undefined || !entry.visible) {
        return;
      }
      closeEntry(entry);
    },
    layout(hostWindow) {
      const entry = entriesByHostId.get(hostWindow.webContents.id);
      if (entry === undefined || !entry.visible) {
        return;
      }
      layoutEntry(entry);
    },
    releaseWindow(hostWebContentsId) {
      const entry = entriesByHostId.get(hostWebContentsId);
      if (entry === undefined) {
        return;
      }
      destroyEntry(entry);
    },
    destroyAll() {
      for (const entry of [...entriesByHostId.values()]) {
        destroyEntry(entry);
      }
    },
  };
}
