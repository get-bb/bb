import { EventEmitter } from "node:events";
import { AppImageUpdater } from "electron-updater";
import { describe, expect, it, vi } from "vitest";
import type {
  UpdateCheckResult,
  UpdateDownloadedEvent,
  UpdateInfo,
} from "electron-updater";
import {
  createDesktopAutoUpdateService,
  createElectronAutoUpdaterAdapter,
  shouldEnableDesktopAutoUpdate,
  type DesktopAutoUpdateAvailableHandler,
  type DesktopAutoUpdateDownloadedHandler,
  type DesktopAutoUpdateErrorArgs,
  type DesktopAutoUpdateErrorHandler,
  type DesktopAutoUpdateLogger,
  type DesktopAutoUpdateNotAvailableHandler,
  type DesktopAutoUpdaterAdapter,
} from "../src/desktop-auto-update.js";
import {
  DESKTOP_AUTO_UPDATE_FEED_CONFIG,
  type DesktopAutoUpdateFeedConfig,
} from "../src/desktop-update-provider.js";

const checkedAt = "2026-05-21T00:00:00.000Z";

interface LoggerMessages {
  errors: string[];
  infos: string[];
  warnings: string[];
}

interface DeferredDownload {
  promise: Promise<Array<string>>;
  resolve(paths: Array<string>): void;
}

class DesktopAutoUpdaterAdapterStub implements DesktopAutoUpdaterAdapter {
  autoDownload: boolean | null = null;
  autoInstallOnAppQuit: boolean | null = null;
  checkForUpdatesCalls = 0;
  downloadUpdateResult: Promise<Array<string>> = Promise.resolve([
    "/tmp/bb.zip",
  ]);
  downloadUpdateCalls = 0;
  feedConfigs: DesktopAutoUpdateFeedConfig[] = [];
  forceDevUpdateConfig: boolean | null = null;
  logger: DesktopAutoUpdateLogger | null = null;
  quitAndInstallCalls = 0;
  updateCheckResult: UpdateCheckResult | null = null;
  updateCheckError: Error | null = null;

  private readonly errorHandlers = new Set<DesktopAutoUpdateErrorHandler>();
  private readonly updateAvailableHandlers =
    new Set<DesktopAutoUpdateAvailableHandler>();
  private readonly updateDownloadedHandlers =
    new Set<DesktopAutoUpdateDownloadedHandler>();
  private readonly updateNotAvailableHandlers =
    new Set<DesktopAutoUpdateNotAvailableHandler>();

  checkForUpdates(): Promise<UpdateCheckResult | null> {
    this.checkForUpdatesCalls += 1;
    if (this.updateCheckError !== null) {
      return Promise.reject(this.updateCheckError);
    }
    return Promise.resolve(this.updateCheckResult);
  }

  downloadUpdate(): Promise<Array<string>> {
    this.downloadUpdateCalls += 1;
    return this.downloadUpdateResult;
  }

  emitError(args: DesktopAutoUpdateErrorArgs): void {
    for (const handler of this.errorHandlers) {
      handler(args);
    }
  }

  emitUpdateAvailable(info: UpdateInfo): void {
    for (const handler of this.updateAvailableHandlers) {
      handler(info);
    }
  }

  emitUpdateDownloaded(event: UpdateDownloadedEvent): void {
    for (const handler of this.updateDownloadedHandlers) {
      handler(event);
    }
  }

  emitUpdateNotAvailable(info: UpdateInfo): void {
    for (const handler of this.updateNotAvailableHandlers) {
      handler(info);
    }
  }

  onError(handler: DesktopAutoUpdateErrorHandler): void {
    this.errorHandlers.add(handler);
  }

  onUpdateAvailable(handler: DesktopAutoUpdateAvailableHandler): void {
    this.updateAvailableHandlers.add(handler);
  }

  onUpdateDownloaded(handler: DesktopAutoUpdateDownloadedHandler): void {
    this.updateDownloadedHandlers.add(handler);
  }

  onUpdateNotAvailable(handler: DesktopAutoUpdateNotAvailableHandler): void {
    this.updateNotAvailableHandlers.add(handler);
  }

  async quitAndInstall(): Promise<void> {
    this.quitAndInstallCalls += 1;
  }

  setAutoDownload(enabled: boolean): void {
    this.autoDownload = enabled;
  }

  setAutoInstallOnAppQuit(enabled: boolean): void {
    this.autoInstallOnAppQuit = enabled;
  }

  setFeedURL(config: DesktopAutoUpdateFeedConfig): void {
    this.feedConfigs.push(config);
  }

  setForceDevUpdateConfig(enabled: boolean): void {
    this.forceDevUpdateConfig = enabled;
  }

  setLogger(logger: DesktopAutoUpdateLogger): void {
    this.logger = logger;
  }
}

function createUpdateInfo(version: string): UpdateInfo {
  return {
    files: [
      {
        sha512: "BASE64_SHA512",
        url: `bb-${version}-universal.zip`,
      },
    ],
    path: `bb-${version}-universal.zip`,
    releaseDate: checkedAt,
    sha512: "BASE64_SHA512",
    version,
  };
}

function createUpdateCheckResult(version: string): UpdateCheckResult {
  const updateInfo = createUpdateInfo(version);
  return {
    downloadPromise: null,
    isUpdateAvailable: true,
    updateInfo,
    versionInfo: updateInfo,
  };
}

function createDownloadedEvent(version: string): UpdateDownloadedEvent {
  return {
    ...createUpdateInfo(version),
    downloadedFile: "/tmp/bb.zip",
  };
}

function createLoggerMessages(): LoggerMessages {
  return {
    errors: [],
    infos: [],
    warnings: [],
  };
}

function createLogger(messages: LoggerMessages): DesktopAutoUpdateLogger {
  return {
    error(message) {
      messages.errors.push(message);
    },
    info(message) {
      messages.infos.push(message);
    },
    warn(message) {
      messages.warnings.push(message);
    },
  };
}

function createDeferredDownload(): DeferredDownload {
  let resolveDownload: ((paths: Array<string>) => void) | null = null;
  const promise = new Promise<Array<string>>((resolve) => {
    resolveDownload = resolve;
  });

  return {
    promise,
    resolve(paths) {
      if (resolveDownload === null) {
        throw new Error(
          "Deferred download resolve handler was not initialized.",
        );
      }
      resolveDownload(paths);
    },
  };
}

describe("desktop auto-update service", () => {
  it("configures electron-updater for the desktop-latest GitHub release assets", () => {
    const updater = new DesktopAutoUpdaterAdapterStub();
    const messages = createLoggerMessages();

    createDesktopAutoUpdateService({
      currentVersion: "0.0.1",
      enabled: true,
      forceDevUpdateConfig: false,
      logger: createLogger(messages),
      now: () => Date.parse(checkedAt),
      platform: "macos",
      updater,
    });

    expect(updater.feedConfigs).toEqual([DESKTOP_AUTO_UPDATE_FEED_CONFIG]);
    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(true);
    expect(updater.forceDevUpdateConfig).toBe(false);
    expect(updater.logger).not.toBeNull();
  });

  it("updates state from updater events and downloads available updates in the background", () => {
    const updater = new DesktopAutoUpdaterAdapterStub();
    const messages = createLoggerMessages();
    const service = createDesktopAutoUpdateService({
      currentVersion: "0.0.1",
      enabled: true,
      forceDevUpdateConfig: false,
      logger: createLogger(messages),
      now: () => Date.parse(checkedAt),
      platform: "macos",
      updater,
    });

    updater.emitUpdateAvailable(createUpdateInfo("0.0.2"));

    expect(updater.downloadUpdateCalls).toBe(1);
    expect(service.getInfo()).toEqual({
      downloadState: "downloading",
      lastCheckedAt: checkedAt,
      latestVersion: "0.0.2",
      pendingVersion: null,
      platform: "macos",
      updateAvailable: true,
      updateDownloaded: false,
      version: "0.0.1",
    });

    updater.emitUpdateDownloaded(createDownloadedEvent("0.0.2"));

    expect(service.getInfo()).toEqual({
      downloadState: "downloaded",
      lastCheckedAt: checkedAt,
      latestVersion: "0.0.2",
      pendingVersion: "0.0.2",
      platform: "macos",
      updateAvailable: true,
      updateDownloaded: true,
      version: "0.0.1",
    });
    expect(messages.infos).toContain(
      "Desktop auto-update available: 0.0.2; downloading in background.",
    );
    expect(messages.infos).toContain(
      "Desktop auto-update downloaded: 0.0.2; it will install on restart or quit.",
    );
  });

  it("does not start duplicate background downloads while one is in flight", async () => {
    const updater = new DesktopAutoUpdaterAdapterStub();
    const download = createDeferredDownload();
    updater.downloadUpdateResult = download.promise;
    createDesktopAutoUpdateService({
      currentVersion: "0.0.1",
      enabled: true,
      forceDevUpdateConfig: false,
      logger: createLogger(createLoggerMessages()),
      now: () => Date.parse(checkedAt),
      platform: "macos",
      updater,
    });

    updater.emitUpdateAvailable(createUpdateInfo("0.0.2"));
    updater.emitUpdateAvailable(createUpdateInfo("0.0.2"));

    expect(updater.autoDownload).toBe(false);
    expect(updater.downloadUpdateCalls).toBe(1);

    download.resolve(["/tmp/bb.zip"]);
    await download.promise;
    await Promise.resolve();

    updater.emitUpdateAvailable(createUpdateInfo("0.0.2"));

    expect(updater.downloadUpdateCalls).toBe(2);
  });

  it("logs updater errors without throwing or clearing current state", () => {
    const updater = new DesktopAutoUpdaterAdapterStub();
    const messages = createLoggerMessages();
    const service = createDesktopAutoUpdateService({
      currentVersion: "0.0.1",
      enabled: true,
      forceDevUpdateConfig: false,
      logger: createLogger(messages),
      now: () => Date.parse(checkedAt),
      platform: "macos",
      updater,
    });

    updater.emitUpdateAvailable(createUpdateInfo("0.0.2"));
    updater.emitError({
      error: new Error("signature rejected"),
      message: "download failed",
    });

    expect(messages.errors).toHaveLength(1);
    expect(messages.errors[0]).toContain("download failed");
    expect(messages.errors[0]).toContain("signature rejected");
    expect(service.getInfo()).toEqual({
      downloadState: "failed",
      lastCheckedAt: checkedAt,
      latestVersion: "0.0.2",
      pendingVersion: null,
      platform: "macos",
      updateAvailable: true,
      updateDownloaded: false,
      version: "0.0.1",
    });
  });

  it("checks for updates through the updater without using the desktop-version feed", async () => {
    const updater = new DesktopAutoUpdaterAdapterStub();
    updater.updateCheckResult = createUpdateCheckResult("0.0.2");
    const service = createDesktopAutoUpdateService({
      currentVersion: "0.0.1",
      enabled: true,
      forceDevUpdateConfig: false,
      logger: createLogger(createLoggerMessages()),
      now: () => Date.parse(checkedAt),
      platform: "macos",
      updater,
    });

    const info = await service.checkForUpdates();

    expect(updater.checkForUpdatesCalls).toBe(1);
    expect(info).toEqual({
      downloadState: "idle",
      lastCheckedAt: checkedAt,
      latestVersion: "0.0.2",
      pendingVersion: null,
      platform: "macos",
      updateAvailable: true,
      updateDownloaded: false,
      version: "0.0.1",
    });
  });

  it("holds a downloaded update by skipping re-checks that would tear down its staging", async () => {
    const updater = new DesktopAutoUpdaterAdapterStub();
    updater.updateCheckResult = createUpdateCheckResult("0.0.2");
    let currentTime = Date.parse(checkedAt);
    const service = createDesktopAutoUpdateService({
      currentVersion: "0.0.1",
      enabled: true,
      forceDevUpdateConfig: false,
      logger: createLogger(createLoggerMessages()),
      now: () => currentTime,
      platform: "macos",
      updater,
    });

    await service.checkForUpdates();
    expect(updater.checkForUpdatesCalls).toBe(1);

    updater.emitUpdateDownloaded(createDownloadedEvent("0.0.2"));
    await service.checkForUpdates();
    currentTime += 16 * 60 * 1000;
    await service.checkAfterActive();

    expect(updater.checkForUpdatesCalls).toBe(1);
    expect(service.getInfo()).toEqual({
      downloadState: "downloaded",
      lastCheckedAt: checkedAt,
      latestVersion: "0.0.2",
      pendingVersion: "0.0.2",
      platform: "macos",
      updateAvailable: true,
      updateDownloaded: true,
      version: "0.0.1",
    });
  });

  it("does not initialize electron-updater in dev mode without the override", async () => {
    const updater = new DesktopAutoUpdaterAdapterStub();
    const enabled = shouldEnableDesktopAutoUpdate({
      env: {},
      isPackaged: false,
    });
    const service = createDesktopAutoUpdateService({
      currentVersion: "0.0.1",
      enabled,
      forceDevUpdateConfig: false,
      logger: createLogger(createLoggerMessages()),
      now: () => Date.parse(checkedAt),
      platform: "macos",
      updater,
    });

    service.start();
    await service.checkForUpdates();

    expect(enabled).toBe(false);
    expect(updater.feedConfigs).toEqual([]);
    expect(updater.checkForUpdatesCalls).toBe(0);
    expect(updater.autoDownload).toBeNull();
  });

  it("allows the dev-mode auto-update override", () => {
    expect(
      shouldEnableDesktopAutoUpdate({
        env: { BB_DESKTOP_AUTO_UPDATE: "1" },
        isPackaged: false,
      }),
    ).toBe(true);
  });
});

describe("native installer acceptance", () => {
  it.each([false, true])(
    "reports native errors and retries (AppImage: %s)",
    async (isAppImage) => {
      const nativeUpdater = new EventEmitter();
      const updater = new AppImageUpdater(null, {
        version: "1.0.0",
        name: "bb",
        isPackaged: true,
        appUpdateConfigPath: "",
        userDataPath: "",
        baseCachePath: "",
        whenReady: async () => undefined,
        relaunch: () => undefined,
        quit: () => undefined,
        onQuit: () => undefined,
      });
      updater.logger = null;
      const errorListeners = updater.listenerCount("error");
      const relaunch = vi.fn();
      const adapter = createElectronAutoUpdaterAdapter(
        updater,
        nativeUpdater,
        isAppImage ? { path: "/bb-1.0.0.AppImage", relaunch } : null,
      );
      await expect(adapter.quitAndInstall()).rejects.toThrow(
        "No update filepath provided",
      );
      expect(nativeUpdater.listenerCount("before-quit-for-update")).toBe(0);

      const install = vi
        .spyOn(updater, "quitAndInstall")
        .mockImplementation(() => undefined);
      const failed = adapter.quitAndInstall();
      const rejection = expect(failed).rejects.toThrow(
        "Native installer failed",
      );
      await Promise.resolve();
      updater.emit("error", new Error("Native installer failed"));
      await rejection;
      expect(nativeUpdater.listenerCount("before-quit-for-update")).toBe(0);

      const retry = adapter.quitAndInstall();
      expect(adapter.quitAndInstall()).toBe(retry);
      expect(install).toHaveBeenCalledTimes(2);
      expect(relaunch).not.toHaveBeenCalled();
      if (isAppImage) {
        expect(install).toHaveBeenLastCalledWith(true, false);
        updater.emit("appimage-filename-updated", "/bb-1.1.0.AppImage");
      } else {
        expect(install).toHaveBeenLastCalledWith();
      }
      nativeUpdater.emit("before-quit-for-update");
      await retry;
      if (isAppImage) {
        expect(relaunch).toHaveBeenCalledWith("/bb-1.1.0.AppImage");
      } else {
        expect(relaunch).not.toHaveBeenCalled();
      }
      expect(nativeUpdater.listenerCount("before-quit-for-update")).toBe(0);
      expect(updater.listenerCount("error")).toBe(errorListeners);
    },
  );
});

describe("macOS native preparation", () => {
  it.runIf(process.platform === "darwin")(
    "waits for native readiness and prepares again after failure",
    async () => {
      const nativeUpdater = new EventEmitter();
      const updater = new AppImageUpdater(null, {
        version: "0.0.1",
        name: "bb",
        isPackaged: true,
        appUpdateConfigPath: "",
        userDataPath: "",
        baseCachePath: "",
        whenReady: async () => undefined,
        relaunch: () => undefined,
        quit: () => undefined,
        onQuit: () => undefined,
      });
      const check = vi
        .spyOn(updater, "checkForUpdates")
        .mockImplementation(async () => {
          updater.emit("update-available", createUpdateInfo("0.46.0"));
          return createUpdateCheckResult("0.46.0");
        });
      const download = vi
        .spyOn(updater, "downloadUpdate")
        .mockImplementation(async () => {
          updater.emit("update-downloaded", createDownloadedEvent("0.46.0"));
          return ["/tmp/bb.zip"];
        });
      const install = vi
        .spyOn(updater, "quitAndInstall")
        .mockImplementation(() => undefined);
      const service = createDesktopAutoUpdateService({
        currentVersion: "0.0.1",
        enabled: true,
        forceDevUpdateConfig: false,
        logger: createLogger(createLoggerMessages()),
        platform: "macos",
        updater: createElectronAutoUpdaterAdapter(updater, nativeUpdater, null),
      });

      await service.checkForUpdates();
      expect(service.getInfo()).toMatchObject({
        downloadState: "downloading",
        updateDownloaded: false,
        pendingVersion: null,
      });
      updater.emit("error", new Error("Native preparation failed"));
      expect(service.getInfo()).toMatchObject({
        downloadState: "failed",
        updateDownloaded: false,
        pendingVersion: null,
      });
      await service.installUpdate();
      expect(install).not.toHaveBeenCalled();

      await service.checkForUpdates();
      expect(check).toHaveBeenCalledTimes(2);
      expect(download).toHaveBeenCalledTimes(2);
      expect(service.getInfo().updateDownloaded).toBe(false);
      nativeUpdater.emit("update-downloaded");
      expect(service.getInfo()).toMatchObject({
        downloadState: "downloaded",
        updateDownloaded: true,
        pendingVersion: "0.46.0",
      });
      const installing = service.installUpdate();
      expect(install).toHaveBeenCalledTimes(1);
      nativeUpdater.emit("before-quit-for-update");
      await installing;
    },
  );
});
