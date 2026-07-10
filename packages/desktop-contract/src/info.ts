import { z } from "zod";
import type { BbDesktopBrowserApi } from "./browser.js";
import type { BbDesktopPopoutApi } from "./popout.js";
import type { BbDesktopServersApi } from "./servers.js";
import type { AppCommandId } from "@bb/domain";

const isoUtcDateTimeSchema = z.iso.datetime();

export const bbDesktopInfoSchema = z.object({
  lastCheckedAt: isoUtcDateTimeSchema.nullable(),
  latestVersion: z.string().min(1).nullable(),
  pendingVersion: z.string().min(1).nullable(),
  platform: z.literal("macos"),
  updateAvailable: z.boolean(),
  updateDownloaded: z.boolean(),
  version: z.string().min(1),
});
export type BbDesktopInfo = z.infer<typeof bbDesktopInfoSchema>;

export const bbDesktopWindowStateSchema = z
  .object({
    isFullScreen: z.boolean(),
  })
  .strict();
export type BbDesktopWindowState = z.infer<
  typeof bbDesktopWindowStateSchema
>;

export const bbDesktopThemeSchema = z.enum(["light", "dark"]);
export type BbDesktopTheme = z.infer<typeof bbDesktopThemeSchema>;

export type BbDesktopInfoChangeHandler = (info: BbDesktopInfo) => void;
export type BbDesktopInfoUnsubscribe = () => void;
export type BbDesktopWindowStateChangeHandler = (
  state: BbDesktopWindowState,
) => void;
export type BbDesktopOpenNewTabHandler = () => void;
export type BbDesktopAppCommandHandler = (command: AppCommandId) => void;
export type BbDesktopCloseWindowRequestHandler = () => boolean;

export interface BbDesktopApi extends BbDesktopInfo {
  /**
   * Control surface for the desktop-only web browser tab. The renderer drives
   * a hardened, isolated Electron `WebContentsView` through these methods; the
   * web build has no `window.bbDesktop`, so this surface is desktop-only by
   * construction.
   */
  browser: BbDesktopBrowserApi;
  /**
   * Control surface for the desktop-only popout chat window. The Electron main
   * process owns the native window and global hotkey; the renderer only sends
   * typed commands over the preload bridge.
   */
  popout: BbDesktopPopoutApi;
  /**
   * Multi-server registry and per-window switching. Optional for version skew
   * with desktop shells that predate multi-server support; callers should
   * feature-detect before use.
   */
  servers?: BbDesktopServersApi;
  checkForUpdates(): Promise<BbDesktopInfo>;
  getInfo(): Promise<BbDesktopInfo>;
  /**
   * Current native window state for renderer chrome geometry. Optional for
   * version skew with desktop shells that predate this bridge; callers should
   * feature-detect and fall back to the normal window layout.
   */
  getWindowState?(): Promise<BbDesktopWindowState>;
  installUpdate(): Promise<void>;
  onChange(listener: BbDesktopInfoChangeHandler): BbDesktopInfoUnsubscribe;
  /**
   * Subscribe to native window state pushes for this BrowserWindow. Optional
   * for version skew with desktop shells that predate fullscreen-aware chrome.
   */
  onWindowStateChange?(
    listener: BbDesktopWindowStateChangeHandler,
  ): BbDesktopInfoUnsubscribe;
  /**
   * Subscribe to native desktop requests to open the current thread's secondary
   * panel new-tab page. Optional for desktop shells that predate this command.
   */
  onOpenNewTab?(
    listener: BbDesktopOpenNewTabHandler,
  ): BbDesktopInfoUnsubscribe;
  /** Subscribe to native menu commands that are executed by the renderer. */
  onAppCommand?(
    listener: BbDesktopAppCommandHandler,
  ): BbDesktopInfoUnsubscribe;
  /**
   * Subscribe to native desktop close-window requests. Return true when the
   * renderer handled the request, for example by closing an active secondary
   * panel tab; returning false preserves the native close-window fallback.
   * Optional for desktop shells that predate this command.
   */
  onCloseWindowRequest?(
    listener: BbDesktopCloseWindowRequestHandler,
  ): BbDesktopInfoUnsubscribe;
  /**
   * Open a URL in the user's default system browser, leaving the in-app
   * browser tab. The main process only honors `http(s)` URLs — the address
   * originates from a possibly-hostile page, so other schemes are dropped.
   * No-op on the web build where `window.bbDesktop` is undefined.
   */
  openExternalUrl(url: string): void;
  /**
   * Push the renderer-resolved theme to the Electron main process so the
   * NSWindow appearance — traffic lights and inactive title-bar chrome —
   * follows bb's theme rather than the OS appearance. No-op on the web build
   * where `window.bbDesktop` is undefined.
   */
  setTheme(theme: BbDesktopTheme): void;
}
