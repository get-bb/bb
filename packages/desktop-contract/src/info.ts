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

export const bbDesktopServerKindSchema = z.enum([
  "builtin",
  "connect",
  "custom",
]);
export type BbDesktopServerKind = z.infer<typeof bbDesktopServerKindSchema>;

export const bbDesktopServerOptionSchema = z
  .object({
    id: z.string().min(1),
    kind: bbDesktopServerKindSchema,
    name: z.string().min(1),
    selected: z.boolean(),
    url: z.string().min(1).nullable(),
  })
  .strict();
export type BbDesktopServerOption = z.infer<typeof bbDesktopServerOptionSchema>;

export const bbDesktopServerTargetSchema = z
  .object({
    customUrl: z.string().min(1).nullable(),
    servers: z.array(bbDesktopServerOptionSchema),
  })
  .strict();
export type BbDesktopServerTarget = z.infer<typeof bbDesktopServerTargetSchema>;

export type BbDesktopServerTargetChangeHandler = (
  target: BbDesktopServerTarget,
) => void;

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
  experimental_getServerTarget?(): Promise<BbDesktopServerTarget | null>;
  experimental_setServerTarget?(serverId: string): Promise<boolean>;
  experimental_setCustomServerUrl?(url: string | null): Promise<boolean>;
  experimental_onServerTargetChange?(
    listener: BbDesktopServerTargetChangeHandler,
  ): BbDesktopInfoUnsubscribe;
}
