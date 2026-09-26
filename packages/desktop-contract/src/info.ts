import { z } from "zod";
import type { BbDesktopBrowserApi } from "./browser.js";
import type { BbDesktopWindowFindRequest } from "./find.js";
import type {
  BbDesktopServerTarget,
  BbDesktopServerTargetsChangeHandler,
} from "./servers.js";
import { bbDesktopVersionFeedPlatformSchema } from "./version-feed.js";
import type { AppCommandId } from "@bb/domain";

const isoUtcDateTimeSchema = z.iso.datetime();

const bbDesktopDownloadStateSchema = z.enum([
  "idle",
  "downloading",
  "downloaded",
  "failed",
]);

export const bbDesktopInfoSchema = z.object({
  downloadState: bbDesktopDownloadStateSchema.optional(),
  lastCheckedAt: isoUtcDateTimeSchema.nullable(),
  latestVersion: z.string().min(1).nullable(),
  pendingVersion: z.string().min(1).nullable(),
  platform: bbDesktopVersionFeedPlatformSchema,
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

export const bbDesktopZoomCommandSchema = z.enum(["in", "out", "reset"]);
export type BbDesktopZoomCommand = z.infer<typeof bbDesktopZoomCommandSchema>;
export const BB_DESKTOP_MIN_ZOOM_PERCENT = 50;
export const BB_DESKTOP_MAX_ZOOM_PERCENT = 300;

export type BbDesktopInfoChangeHandler = (info: BbDesktopInfo) => void;
export type BbDesktopInfoUnsubscribe = () => void;
export type BbDesktopWindowStateChangeHandler = (
  state: BbDesktopWindowState,
) => void;
export type BbDesktopZoomChangeHandler = (zoomFactor: number) => void;
export type BbDesktopOpenNewTabHandler = () => void;
export type BbDesktopAppCommandHandler = (command: AppCommandId) => void;
export type BbDesktopCloseWindowRequestHandler = () => boolean;

export interface BbDesktopApi extends BbDesktopInfo {
  browser: BbDesktopBrowserApi;
  checkForUpdates(): Promise<BbDesktopInfo>;
  getInfo(): Promise<BbDesktopInfo>;
  getWindowState?(): Promise<BbDesktopWindowState>;
  getServerTargets?(): Promise<BbDesktopServerTarget[]>;
  installUpdate(): Promise<void>;
  onChange(listener: BbDesktopInfoChangeHandler): BbDesktopInfoUnsubscribe;
  onWindowStateChange?(
    listener: BbDesktopWindowStateChangeHandler,
  ): BbDesktopInfoUnsubscribe;
  onZoomChange?(listener: BbDesktopZoomChangeHandler): BbDesktopInfoUnsubscribe;
  zoom?(command: BbDesktopZoomCommand): void;
  onOpenNewTab?(listener: BbDesktopOpenNewTabHandler): BbDesktopInfoUnsubscribe;
  onAppCommand?(listener: BbDesktopAppCommandHandler): BbDesktopInfoUnsubscribe;
  onCloseWindowRequest?(
    listener: BbDesktopCloseWindowRequestHandler,
  ): BbDesktopInfoUnsubscribe;
  onServerTargetsChange?(
    listener: BbDesktopServerTargetsChangeHandler,
  ): BbDesktopInfoUnsubscribe;
  openWindowFind?(request: BbDesktopWindowFindRequest): void;
  openDataDirectory?(): Promise<void>;
  openExternalUrl(url: string): void;
  openServerDaemonLogs?(): Promise<void>;
  selectServerTarget?(id: string): void;
  setSplitNavigationEnabled?(
    enabled: boolean,
    directionalCommands?: readonly AppCommandId[],
  ): void;
  setTheme(theme: BbDesktopTheme): void;
}
