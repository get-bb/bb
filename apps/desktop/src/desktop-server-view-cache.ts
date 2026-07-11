import {
  WebContentsView,
  type BrowserWindow,
  type WebContents,
} from "electron";

export type DesktopServerRendererWebContents = WebContents;

interface ServerViewEntry {
  serverId: string;
  view: WebContentsView;
  webContents: DesktopServerRendererWebContents;
}

interface WindowCache {
  activeServerId: string;
  entries: Map<string, ServerViewEntry>;
  hostWindow: BrowserWindow;
  primaryServerId: string;
}

export interface CreateDesktopServerViewCacheArgs {
  onRendererCreated(args: {
    hostWindow: BrowserWindow;
    serverId: string;
    webContents: DesktopServerRendererWebContents;
  }): void;
  onRendererDestroyed(args: {
    hostWindow: BrowserWindow;
    serverId: string;
    webContentsId: number;
  }): void;
  openExternalUrl(url: string): void;
  preloadPath: string;
}

export interface ActivateDesktopServerViewArgs {
  hostWindow: BrowserWindow;
  serverId: string;
  url: string;
}

export interface DesktopServerViewCache {
  activate(args: ActivateDesktopServerViewArgs): Promise<{
    previousRendererWebContentsId: number;
    rendererWebContentsId: number;
  }>;
  destroyAll(): void;
  getActiveWebContents(
    hostWindow: BrowserWindow,
  ): DesktopServerRendererWebContents | WebContents;
  getAllWebContents(hostWindow: BrowserWindow): WebContents[];
  getHostWindow(webContentsId: number): BrowserWindow | null;
  registerWindow(args: {
    hostWindow: BrowserWindow;
    primaryServerId: string;
  }): void;
  reload(hostWindow: BrowserWindow, ignoreCache: boolean): void;
  removeServer(serverId: string): void;
}

function fullWindowBounds(hostWindow: BrowserWindow): {
  height: number;
  width: number;
  x: number;
  y: number;
} {
  const { height, width } = hostWindow.getContentBounds();
  return { height, width, x: 0, y: 0 };
}

async function loadRendererUrl(
  webContents: DesktopServerRendererWebContents,
  url: string,
): Promise<void> {
  webContents.setZoomFactor(1);
  try {
    await webContents.loadURL(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("ERR_ABORTED")) {
      return;
    }
    throw error;
  }
}

export function createDesktopServerViewCache(
  args: CreateDesktopServerViewCacheArgs,
): DesktopServerViewCache {
  const cachesByWindowId = new Map<number, WindowCache>();
  const windowByRendererWebContentsId = new Map<number, BrowserWindow>();

  function requireCache(hostWindow: BrowserWindow): WindowCache {
    const cache = cachesByWindowId.get(hostWindow.id);
    if (cache === undefined) {
      throw new Error(`Desktop window ${hostWindow.id} is not registered`);
    }
    return cache;
  }

  function activeWebContents(cache: WindowCache): WebContents {
    if (cache.activeServerId === cache.primaryServerId) {
      return cache.hostWindow.webContents;
    }
    return (
      cache.entries.get(cache.activeServerId)?.webContents ??
      cache.hostWindow.webContents
    );
  }

  function destroyEntry(cache: WindowCache, entry: ServerViewEntry): void {
    cache.entries.delete(entry.serverId);
    windowByRendererWebContentsId.delete(entry.webContents.id);
    args.onRendererDestroyed({
      hostWindow: cache.hostWindow,
      serverId: entry.serverId,
      webContentsId: entry.webContents.id,
    });
    if (!cache.hostWindow.isDestroyed()) {
      try {
        cache.hostWindow.contentView.removeChildView(entry.view);
      } catch {
        // The BrowserWindow may already be tearing down its content tree.
      }
    }
    if (!entry.webContents.isDestroyed()) {
      entry.webContents.close();
    }
  }

  function disposeWindow(hostWindow: BrowserWindow): void {
    const cache = cachesByWindowId.get(hostWindow.id);
    if (cache === undefined) {
      return;
    }
    cachesByWindowId.delete(hostWindow.id);
    windowByRendererWebContentsId.delete(hostWindow.webContents.id);
    for (const entry of [...cache.entries.values()]) {
      destroyEntry(cache, entry);
    }
  }

  return {
    async activate({ hostWindow, serverId, url }) {
      const cache = requireCache(hostWindow);
      const previousRendererWebContentsId = activeWebContents(cache).id;

      if (serverId === cache.primaryServerId) {
        for (const entry of cache.entries.values()) {
          entry.view.setVisible(false);
        }
        cache.activeServerId = serverId;
        hostWindow.webContents.focus();
        return {
          previousRendererWebContentsId,
          rendererWebContentsId: hostWindow.webContents.id,
        };
      }

      let entry = cache.entries.get(serverId);
      if (entry !== undefined && entry.webContents.isDestroyed()) {
        destroyEntry(cache, entry);
        entry = undefined;
      }
      if (entry === undefined) {
        const view = new WebContentsView({
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            preload: args.preloadPath,
            sandbox: true,
            spellcheck: true,
          },
        });
        const webContents =
          view.webContents as DesktopServerRendererWebContents;
        webContents.session.setSpellCheckerEnabled(true);
        webContents.setWindowOpenHandler((details) => {
          args.openExternalUrl(details.url);
          return { action: "deny" };
        });
        view.setBounds(fullWindowBounds(hostWindow));
        view.setVisible(false);
        hostWindow.contentView.addChildView(view);
        entry = { serverId, view, webContents };
        cache.entries.set(serverId, entry);
        windowByRendererWebContentsId.set(webContents.id, hostWindow);
        args.onRendererCreated({ hostWindow, serverId, webContents });
        try {
          await loadRendererUrl(webContents, url);
        } catch (error) {
          destroyEntry(cache, entry);
          throw error;
        }
      }

      for (const candidate of cache.entries.values()) {
        candidate.view.setVisible(candidate === entry);
      }
      cache.activeServerId = serverId;
      entry.webContents.focus();
      return {
        previousRendererWebContentsId,
        rendererWebContentsId: entry.webContents.id,
      };
    },
    destroyAll() {
      for (const cache of [...cachesByWindowId.values()]) {
        disposeWindow(cache.hostWindow);
      }
    },
    getActiveWebContents(hostWindow) {
      const cache = cachesByWindowId.get(hostWindow.id);
      return cache === undefined
        ? hostWindow.webContents
        : activeWebContents(cache);
    },
    getAllWebContents(hostWindow) {
      const cache = cachesByWindowId.get(hostWindow.id);
      if (cache === undefined) {
        return [hostWindow.webContents];
      }
      return [
        hostWindow.webContents,
        ...[...cache.entries.values()].map((entry) => entry.webContents),
      ];
    },
    getHostWindow(webContentsId) {
      return windowByRendererWebContentsId.get(webContentsId) ?? null;
    },
    registerWindow({ hostWindow, primaryServerId }) {
      if (cachesByWindowId.has(hostWindow.id)) {
        return;
      }
      cachesByWindowId.set(hostWindow.id, {
        activeServerId: primaryServerId,
        entries: new Map(),
        hostWindow,
        primaryServerId,
      });
      windowByRendererWebContentsId.set(hostWindow.webContents.id, hostWindow);
      hostWindow.on("resize", () => {
        if (hostWindow.isDestroyed()) {
          return;
        }
        const bounds = fullWindowBounds(hostWindow);
        for (const entry of requireCache(hostWindow).entries.values()) {
          entry.view.setBounds(bounds);
        }
      });
      hostWindow.once("closed", () => {
        disposeWindow(hostWindow);
      });
    },
    reload(hostWindow, ignoreCache) {
      const cache = cachesByWindowId.get(hostWindow.id);
      const webContents =
        cache === undefined ? hostWindow.webContents : activeWebContents(cache);
      if (ignoreCache) {
        webContents.reloadIgnoringCache();
        return;
      }
      webContents.reload();
    },
    removeServer(serverId) {
      for (const cache of cachesByWindowId.values()) {
        const entry = cache.entries.get(serverId);
        if (entry !== undefined) {
          destroyEntry(cache, entry);
        }
      }
    },
  };
}
