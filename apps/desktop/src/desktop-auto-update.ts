import type {
  AppUpdater,
  UpdateCheckResult,
  UpdateDownloadedEvent,
  UpdateInfo,
} from "electron-updater";
import type { BbDesktopInfo } from "@bb/desktop-contract";
import {
  DESKTOP_AUTO_UPDATE_FEED_CONFIG,
  type DesktopAutoUpdateFeedConfig,
} from "./desktop-update-provider.js";
import {
  createDesktopUpdateScheduler,
  type DesktopUpdateService,
} from "./desktop-update-scheduler.js";

export interface DesktopAutoUpdateLogger {
  error(message: string): void;
  info(message: string): void;
  warn(message: string): void;
}

export type DesktopAutoUpdateAvailableHandler = (info: UpdateInfo) => void;
export type DesktopAutoUpdateDownloadedHandler = (
  event: UpdateDownloadedEvent,
) => void;
export type DesktopAutoUpdateNotAvailableHandler = (info: UpdateInfo) => void;

export interface DesktopAutoUpdateErrorArgs {
  error: Error;
  message: string | null;
}

export type DesktopAutoUpdateErrorHandler = (
  args: DesktopAutoUpdateErrorArgs,
) => void;

export interface DesktopAutoUpdaterAdapter {
  checkForUpdates(): Promise<UpdateCheckResult | null>;
  downloadUpdate(): Promise<Array<string>>;
  onError(handler: DesktopAutoUpdateErrorHandler): void;
  onUpdateAvailable(handler: DesktopAutoUpdateAvailableHandler): void;
  onUpdateDownloaded(handler: DesktopAutoUpdateDownloadedHandler): void;
  onUpdateNotAvailable(handler: DesktopAutoUpdateNotAvailableHandler): void;
  quitAndInstall(): void;
  setAutoDownload(enabled: boolean): void;
  setAutoInstallOnAppQuit(enabled: boolean): void;
  setFeedURL(config: DesktopAutoUpdateFeedConfig): void;
  setForceDevUpdateConfig(enabled: boolean): void;
  setLogger(logger: DesktopAutoUpdateLogger): void;
}

interface CreateDesktopAutoUpdateServiceArgs {
  currentVersion: string;
  enabled: boolean;
  forceDevUpdateConfig: boolean;
  logger: DesktopAutoUpdateLogger;
  now?: () => number;
  platform: BbDesktopInfo["platform"];
  updater: DesktopAutoUpdaterAdapter;
}

interface ShouldEnableDesktopAutoUpdateArgs {
  env: NodeJS.ProcessEnv;
  isPackaged: boolean;
}

interface ApplyUpdateAvailableArgs {
  checkedAt: string;
  version: string;
}

interface ApplyUpdateDownloadedArgs {
  checkedAt: string;
  version: string;
}

interface ApplyUpdateNotAvailableArgs {
  checkedAt: string;
  version: string;
}

export interface DesktopAutoUpdateService extends DesktopUpdateService {
  installUpdate(): void;
}

function createBaseInfo(
  currentVersion: string,
  platform: BbDesktopInfo["platform"],
): BbDesktopInfo {
  return {
    downloadState: "idle",
    lastCheckedAt: null,
    latestVersion: null,
    pendingVersion: null,
    platform,
    updateAvailable: false,
    updateDownloaded: false,
    version: currentVersion,
  };
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error
    ? (error.stack ?? error.message)
    : String(error);
}

function formatCheckedAt(now: () => number): string {
  return new Date(now()).toISOString();
}

export function shouldEnableDesktopAutoUpdate(
  args: ShouldEnableDesktopAutoUpdateArgs,
): boolean {
  return args.isPackaged || args.env.BB_DESKTOP_AUTO_UPDATE === "1";
}

export function createElectronAutoUpdaterAdapter(
  updater: AppUpdater,
): DesktopAutoUpdaterAdapter {
  return {
    checkForUpdates() {
      return updater.checkForUpdates();
    },
    downloadUpdate() {
      return updater.downloadUpdate();
    },
    onError(handler) {
      updater.on("error", (error, message) => {
        handler({ error, message: message ?? null });
      });
    },
    onUpdateAvailable(handler) {
      updater.on("update-available", handler);
    },
    onUpdateDownloaded(handler) {
      updater.on("update-downloaded", handler);
    },
    onUpdateNotAvailable(handler) {
      updater.on("update-not-available", handler);
    },
    quitAndInstall() {
      updater.quitAndInstall();
    },
    setAutoDownload(enabled) {
      updater.autoDownload = enabled;
    },
    setAutoInstallOnAppQuit(enabled) {
      updater.autoInstallOnAppQuit = enabled;
    },
    setFeedURL(config) {
      updater.setFeedURL(config);
    },
    setForceDevUpdateConfig(enabled) {
      updater.forceDevUpdateConfig = enabled;
    },
    setLogger(logger) {
      updater.logger = logger;
    },
  };
}

export function createDesktopAutoUpdateService(
  args: CreateDesktopAutoUpdateServiceArgs,
): DesktopAutoUpdateService {
  const now = args.now ?? (() => Date.now());
  let downloadInFlight: Promise<Array<string>> | null = null;
  const scheduler = createDesktopUpdateScheduler({
    enabled: args.enabled,
    initialInfo: createBaseInfo(args.currentVersion, args.platform),
    now,
    runCheck,
    shouldSkipCheck,
  });

  function shouldSkipCheck(): boolean {
    return scheduler.getInfo().updateDownloaded;
  }

  function applyUpdateAvailable(applyArgs: ApplyUpdateAvailableArgs): void {
    scheduler.updateInfo({
      ...scheduler.getInfo(),
      lastCheckedAt: applyArgs.checkedAt,
      latestVersion: applyArgs.version,
      updateAvailable: true,
    });
  }

  function applyUpdateDownloaded(applyArgs: ApplyUpdateDownloadedArgs): void {
    scheduler.updateInfo({
      ...scheduler.getInfo(),
      downloadState: "downloaded",
      lastCheckedAt: applyArgs.checkedAt,
      latestVersion: applyArgs.version,
      pendingVersion: applyArgs.version,
      updateAvailable: true,
      updateDownloaded: true,
    });
  }

  function applyUpdateNotAvailable(
    applyArgs: ApplyUpdateNotAvailableArgs,
  ): void {
    scheduler.updateInfo({
      ...scheduler.getInfo(),
      downloadState: "idle",
      lastCheckedAt: applyArgs.checkedAt,
      latestVersion: applyArgs.version,
      pendingVersion: null,
      updateAvailable: false,
      updateDownloaded: false,
    });
  }

  function startDownload(): void {
    if (downloadInFlight !== null) {
      return;
    }
    scheduler.updateInfo({
      ...scheduler.getInfo(),
      downloadState: "downloading",
    });
    try {
      downloadInFlight = args.updater.downloadUpdate();
    } catch (error: unknown) {
      scheduler.updateInfo({
        ...scheduler.getInfo(),
        downloadState: "failed",
      });
      args.logger.error(
        `Desktop auto-update download failed; preserving current update state: ${formatErrorMessage(
          error,
        )}`,
      );
      return;
    }
    void downloadInFlight
      .catch((error: unknown) => {
        scheduler.updateInfo({
          ...scheduler.getInfo(),
          downloadState: "failed",
        });
        args.logger.error(
          `Desktop auto-update download failed; preserving current update state: ${formatErrorMessage(
            error,
          )}`,
        );
      })
      .finally(() => {
        downloadInFlight = null;
      });
  }

  async function runCheck(checkedAt: string): Promise<void> {
    let result: UpdateCheckResult | null;
    try {
      result = await args.updater.checkForUpdates();
    } catch (error: unknown) {
      args.logger.error(
        `Desktop auto-update check failed; update installation remains disabled until a later check succeeds: ${formatErrorMessage(
          error,
        )}`,
      );
      scheduler.updateInfo({
        ...scheduler.getInfo(),
        lastCheckedAt: checkedAt,
      });
      return;
    }

    if (result === null) {
      return;
    }
    if (result.isUpdateAvailable) {
      applyUpdateAvailable({
        checkedAt,
        version: result.updateInfo.version,
      });
      return;
    }
    applyUpdateNotAvailable({
      checkedAt,
      version: result.updateInfo.version,
    });
  }

  if (args.enabled) {
    args.updater.setLogger(args.logger);
    args.updater.setFeedURL(DESKTOP_AUTO_UPDATE_FEED_CONFIG);
    args.updater.setAutoDownload(false);
    args.updater.setAutoInstallOnAppQuit(true);
    args.updater.setForceDevUpdateConfig(args.forceDevUpdateConfig);
    args.updater.onUpdateAvailable((info) => {
      args.logger.info(
        `Desktop auto-update available: ${info.version}; downloading in background.`,
      );
      applyUpdateAvailable({
        checkedAt: formatCheckedAt(now),
        version: info.version,
      });
      startDownload();
    });
    args.updater.onUpdateDownloaded((event) => {
      args.logger.info(
        `Desktop auto-update downloaded: ${event.version}; it will install on restart or quit.`,
      );
      applyUpdateDownloaded({
        checkedAt: formatCheckedAt(now),
        version: event.version,
      });
    });
    args.updater.onUpdateNotAvailable((info) => {
      args.logger.info(`Desktop auto-update not available: ${info.version}.`);
      applyUpdateNotAvailable({
        checkedAt: formatCheckedAt(now),
        version: info.version,
      });
    });
    args.updater.onError((errorArgs) => {
      const suffix = errorArgs.message === null ? "" : ` ${errorArgs.message}`;
      args.logger.error(
        `Desktop auto-update error; preserving current update state.${suffix} ${formatErrorMessage(
          errorArgs.error,
        )}`,
      );
      if (scheduler.getInfo().downloadState === "downloading") {
        scheduler.updateInfo({
          ...scheduler.getInfo(),
          downloadState: "failed",
        });
      }
    });
  }

  return {
    ...scheduler,
    installUpdate(): void {
      if (!scheduler.getInfo().updateDownloaded) {
        args.logger.warn(
          "Desktop auto-update install requested before an update was downloaded; ignoring.",
        );
        return;
      }
      args.updater.quitAndInstall();
    },
  };
}
