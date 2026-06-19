import { z } from "zod";
import type { BbDesktopBrowserApi } from "./browser.js";
import type { BbDesktopPopoutApi } from "./popout.js";

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

export const bbDesktopThemeSchema = z.enum(["light", "dark"]);
export type BbDesktopTheme = z.infer<typeof bbDesktopThemeSchema>;

export type BbDesktopInfoChangeHandler = (info: BbDesktopInfo) => void;
export type BbDesktopInfoUnsubscribe = () => void;
export type BbDesktopOpenNewTabHandler = () => void;

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
  checkForUpdates(): Promise<BbDesktopInfo>;
  getInfo(): Promise<BbDesktopInfo>;
  installUpdate(): Promise<void>;
  onChange(listener: BbDesktopInfoChangeHandler): BbDesktopInfoUnsubscribe;
  /**
   * Subscribe to native desktop requests to open the current thread's secondary
   * panel new-tab page. Optional for desktop shells that predate this command.
   */
  onOpenNewTab?(
    listener: BbDesktopOpenNewTabHandler,
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
