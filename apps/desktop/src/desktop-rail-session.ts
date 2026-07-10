import { WebContentsView, type WebContents } from "electron";
import type {
  BbDesktopServerListEntry,
  BbDesktopThemeResolved,
} from "@bb/desktop-contract";
import type { DesktopContextMenuWebContents } from "./desktop-context-menu.js";
import {
  BB_DESKTOP_RAIL_STATE_CHANNEL,
  BB_DESKTOP_RAIL_THEME_CHANNEL,
} from "./desktop-rail-ipc.js";
import {
  computeRailLayoutBounds,
  DESKTOP_RAIL_TRAFFIC_LIGHT_WITH_RAIL,
  DESKTOP_RAIL_WIDTH_PX,
  type DesktopContentBounds,
} from "./desktop-rail-layout.js";
import { DEFAULT_RAIL_THEME_DARK } from "./desktop-rail-theme.js";
import { createDesktopRailViewUrl } from "./desktop-rail-view.js";
import {
  buildDesktopRailViewModel,
  type DesktopRailViewModel,
} from "./desktop-rail-view-model.js";

export interface DesktopRailHostContentView {
  addChildView(view: WebContentsView | unknown): void;
  removeChildView(view: WebContentsView | unknown): void;
}

/**
 * Structural BrowserWindow surface the rail session needs. Kept structural so
 * the window factory can pass its abstract window type without Electron-typed
 * casts in production call sites.
 */
export interface DesktopRailHostWindow {
  contentView: DesktopRailHostContentView;
  getContentBounds(): DesktopContentBounds;
  isDestroyed(): boolean;
  on(
    eventName: "closed" | "leave-full-screen" | "resize",
    listener: () => void,
  ): void;
  /**
   * Electron ≥34 renames macOS traffic-light positioning to window-button
   * APIs. Prefer setWindowButtonPosition; trafficLightPosition on create is
   * still used for the initial position.
   */
  setWindowButtonPosition?: (
    position: { x: number; y: number } | null,
  ) => void;
  webContents: {
    id: number;
    loadURL(url: string): Promise<void>;
  };
}

/**
 * SPA child webContents. Real Electron WebContents is used at runtime; this
 * structural type covers the methods the shell needs without widening to the
 * full Electron surface.
 */
export type DesktopRailSpaWebContents = DesktopContextMenuWebContents & {
  focus(): void;
  getURL(): string;
  id: number;
  isDestroyed(): boolean;
  loadURL(url: string): Promise<void>;
  openDevTools(options: { mode: "detach" }): void;
  send(channel: string, payload: unknown): void;
  setWindowOpenHandler(
    handler: (details: { url: string }) => { action: "deny" },
  ): void;
  setZoomFactor(factor: number): void;
};

export interface DesktopRailSession {
  dispose(): void;
  hostWebContentsId: number;
  loadUrl(url: string): Promise<void>;
  openDevTools(): void;
  pushServers(servers: BbDesktopServerListEntry[]): void;
  pushTheme(theme: BbDesktopThemeResolved): void;
  railWebContentsId: number;
  reapplyTrafficLights(): void;
  send(channel: string, payload: unknown): void;
  spaWebContents: DesktopRailSpaWebContents;
  spaWebContentsId: number;
}

export interface InstallDesktopRailSessionArgs {
  hostWindow: DesktopRailHostWindow;
  initialServers: BbDesktopServerListEntry[];
  initialTheme?: BbDesktopThemeResolved;
  openExternalUrl: (url: string) => void;
  preloadPath: string;
  railPreloadPath: string;
}

const sessionsByHostId = new Map<number, DesktopRailSession>();
const sessionsBySpaId = new Map<number, DesktopRailSession>();
const sessionsByRailId = new Map<number, DesktopRailSession>();

let latestTheme: BbDesktopThemeResolved = DEFAULT_RAIL_THEME_DARK;

export function getLatestRailTheme(): BbDesktopThemeResolved {
  return latestTheme;
}

export function setLatestRailTheme(theme: BbDesktopThemeResolved): void {
  latestTheme = theme;
  for (const session of sessionsByHostId.values()) {
    session.pushTheme(theme);
  }
}

export function getDesktopRailSession(
  hostWebContentsId: number,
): DesktopRailSession | null {
  return sessionsByHostId.get(hostWebContentsId) ?? null;
}

export function getDesktopRailSessionForWebContents(
  webContentsId: number,
): DesktopRailSession | null {
  return (
    sessionsBySpaId.get(webContentsId) ??
    sessionsByHostId.get(webContentsId) ??
    sessionsByRailId.get(webContentsId) ??
    null
  );
}

export function getDesktopRailWidthForHost(
  hostWebContentsId: number,
): number {
  return getDesktopRailSession(hostWebContentsId) === null
    ? 0
    : DESKTOP_RAIL_WIDTH_PX;
}

function setHostTrafficLightPosition(
  hostWindow: DesktopRailHostWindow,
  position: { x: number; y: number },
): void {
  if (typeof hostWindow.setWindowButtonPosition === "function") {
    hostWindow.setWindowButtonPosition(position);
  }
}

function layoutRailViews(args: {
  hostWindow: DesktopRailHostWindow;
  railView: WebContentsView;
  spaView: WebContentsView;
}): void {
  if (args.hostWindow.isDestroyed()) {
    return;
  }
  const bounds = computeRailLayoutBounds(args.hostWindow.getContentBounds());
  args.railView.setBounds(bounds.rail);
  args.spaView.setBounds(bounds.spa);
}

async function loadUrlIntoSpa(
  spaWebContents: DesktopRailSpaWebContents,
  url: string,
): Promise<void> {
  spaWebContents.setZoomFactor(1);
  try {
    await spaWebContents.loadURL(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("ERR_ABORTED")) {
      return;
    }
    throw error;
  }
}

/**
 * Install rail + SPA child WebContentsViews on a just-created BrowserWindow.
 * The host webContents is left blank; all SPA loads/sends go through the session.
 */
export function installDesktopRailSession(
  args: InstallDesktopRailSessionArgs,
): DesktopRailSession {
  const existing = sessionsByHostId.get(args.hostWindow.webContents.id);
  if (existing !== undefined) {
    return existing;
  }

  const theme = args.initialTheme ?? latestTheme;
  const viewModel = buildDesktopRailViewModel({
    servers: args.initialServers,
  });

  const railView = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: args.railPreloadPath,
      sandbox: true,
    },
  });

  const spaView = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: args.preloadPath,
      sandbox: true,
      spellcheck: true,
    },
  });

  // Electron WebContentsView.webContents is the SPA surface.
  const spaWebContents: WebContents = spaView.webContents;
  spaWebContents.session.setSpellCheckerEnabled(true);
  spaWebContents.setWindowOpenHandler((details) => {
    args.openExternalUrl(details.url);
    return { action: "deny" };
  });

  // Rail then SPA: later addChildView (browser tabs) stays above both.
  args.hostWindow.contentView.addChildView(railView);
  args.hostWindow.contentView.addChildView(spaView);
  layoutRailViews({
    hostWindow: args.hostWindow,
    railView,
    spaView,
  });
  setHostTrafficLightPosition(args.hostWindow, {
    x: DESKTOP_RAIL_TRAFFIC_LIGHT_WITH_RAIL.x,
    y: DESKTOP_RAIL_TRAFFIC_LIGHT_WITH_RAIL.y,
  });

  void railView.webContents
    .loadURL(createDesktopRailViewUrl({ theme, viewModel }))
    .catch(() => {
      // Rail chrome is non-critical; SPA still works without it.
    });
  void args.hostWindow.webContents.loadURL("about:blank").catch(() => {
    // Host webContents stays blank under the child views.
  });

  let disposed = false;
  let currentViewModel: DesktopRailViewModel = viewModel;

  const session: DesktopRailSession = {
    hostWebContentsId: args.hostWindow.webContents.id,
    railWebContentsId: railView.webContents.id,
    // WebContents structurally covers DesktopRailSpaWebContents at the boundary.
    spaWebContents: spaWebContents as DesktopRailSpaWebContents,
    spaWebContentsId: spaWebContents.id,
    async loadUrl(url) {
      await loadUrlIntoSpa(spaWebContents, url);
    },
    openDevTools() {
      if (!spaWebContents.isDestroyed()) {
        spaWebContents.openDevTools({ mode: "detach" });
      }
    },
    send(channel, payload) {
      if (!spaWebContents.isDestroyed()) {
        spaWebContents.send(channel, payload);
      }
    },
    pushServers(servers) {
      currentViewModel = buildDesktopRailViewModel({ servers });
      if (!railView.webContents.isDestroyed()) {
        railView.webContents.send(
          BB_DESKTOP_RAIL_STATE_CHANNEL,
          currentViewModel,
        );
      }
    },
    pushTheme(nextTheme) {
      if (!railView.webContents.isDestroyed()) {
        railView.webContents.send(BB_DESKTOP_RAIL_THEME_CHANNEL, nextTheme);
      }
    },
    reapplyTrafficLights() {
      if (args.hostWindow.isDestroyed()) {
        return;
      }
      setHostTrafficLightPosition(args.hostWindow, {
        x: DESKTOP_RAIL_TRAFFIC_LIGHT_WITH_RAIL.x,
        y: DESKTOP_RAIL_TRAFFIC_LIGHT_WITH_RAIL.y,
      });
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      sessionsByHostId.delete(args.hostWindow.webContents.id);
      sessionsBySpaId.delete(spaWebContents.id);
      sessionsByRailId.delete(railView.webContents.id);
      if (!args.hostWindow.isDestroyed()) {
        try {
          args.hostWindow.contentView.removeChildView(railView);
        } catch {
          // already torn down
        }
        try {
          args.hostWindow.contentView.removeChildView(spaView);
        } catch {
          // already torn down
        }
      }
      if (!railView.webContents.isDestroyed()) {
        railView.webContents.close();
      }
      if (!spaView.webContents.isDestroyed()) {
        spaView.webContents.close();
      }
    },
  };

  const onResize = () => {
    layoutRailViews({
      hostWindow: args.hostWindow,
      railView,
      spaView,
    });
  };
  const onLeaveFullScreen = () => {
    session.reapplyTrafficLights();
  };

  args.hostWindow.on("resize", onResize);
  args.hostWindow.on("leave-full-screen", onLeaveFullScreen);
  args.hostWindow.on("closed", () => {
    session.dispose();
  });

  sessionsByHostId.set(args.hostWindow.webContents.id, session);
  sessionsBySpaId.set(spaWebContents.id, session);
  sessionsByRailId.set(railView.webContents.id, session);
  return session;
}
