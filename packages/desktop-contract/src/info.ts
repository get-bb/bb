import { z } from "zod";
import type { BbDesktopBrowserApi } from "./browser.js";
import type { AppCommandId } from "@bb/domain";

const isoUtcDateTimeSchema = z.iso.datetime();

const bbDesktopDownloadStateSchema = z.enum([
  "idle",
  "downloading",
  "downloaded",
  "failed",
]);

/**
 * What the settings row needs to tell the user whether the `bb` they type is
 * the `bb` this app runs. `matches` holds every entry on PATH, in order, so a
 * shadowing npm-global or Homebrew install is visible rather than silent.
 */
export const bbDesktopCliCommandStatusSchema = z.object({
  binDir: z.string().min(1),
  commandName: z.string().min(1),
  matches: z.array(z.string().min(1)),
  onPath: z.boolean(),
  /** True when the app's own ~/.bb/bin entry is the first match. */
  ownEntryWins: z.boolean(),
  wrapperInstalled: z.boolean(),
});
export type BbDesktopCliCommandStatus = z.infer<
  typeof bbDesktopCliCommandStatusSchema
>;

export interface BbDesktopCliCommandApi {
  getStatus(): Promise<BbDesktopCliCommandStatus>;
  install(): Promise<BbDesktopCliCommandStatus>;
}

export const bbDesktopInfoSchema = z.object({
  downloadState: bbDesktopDownloadStateSchema.optional(),
  lastCheckedAt: isoUtcDateTimeSchema.nullable(),
  latestVersion: z.string().min(1).nullable(),
  pendingVersion: z.string().min(1).nullable(),
  platform: z.enum(["macos", "linux"]),
  serverDaemonLogsAvailable: z.boolean().optional(),
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
export type BbDesktopWindowState = z.infer<typeof bbDesktopWindowStateSchema>;

export const bbDesktopThemeSchema = z.enum(["system", "light", "dark"]);
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
  browser: BbDesktopBrowserApi;
  checkForUpdates(): Promise<BbDesktopInfo>;
  /**
   * Install and inspect the app's own bb command in ~/.bb/bin. Optional for
   * version skew with desktop shells that predate it, and absent on the web
   * build; the settings row feature-detects and does not render without it.
   */
  cliCommand?: BbDesktopCliCommandApi;
  getInfo(): Promise<BbDesktopInfo>;
  getWindowState?(): Promise<BbDesktopWindowState>;
  installUpdate(): Promise<void>;
  onChange(listener: BbDesktopInfoChangeHandler): BbDesktopInfoUnsubscribe;
  onWindowStateChange?(
    listener: BbDesktopWindowStateChangeHandler,
  ): BbDesktopInfoUnsubscribe;
  onOpenNewTab?(listener: BbDesktopOpenNewTabHandler): BbDesktopInfoUnsubscribe;
  onAppCommand?(listener: BbDesktopAppCommandHandler): BbDesktopInfoUnsubscribe;
  onCloseWindowRequest?(
    listener: BbDesktopCloseWindowRequestHandler,
  ): BbDesktopInfoUnsubscribe;
  openExternalUrl(url: string): void;
  openServerDaemonLogs?(): Promise<void>;
  setTheme(theme: BbDesktopTheme): void;
}
