import { app, ipcMain } from "electron";
import { homedir } from "node:os";
import type {
  BbDesktopCliCommandInstallResult,
  BbDesktopCliCommandStatus,
} from "@bb/desktop-contract";
import { resolveCliCommandStatus } from "./cli-command-status.js";
import {
  refreshCliCommandLink,
  resolveCliCommandName,
  type BbCliLinkStatus,
} from "./cli-link.js";
import type { DesktopReleaseInfo } from "./desktop-update-provider.js";
import {
  BB_DESKTOP_CLI_COMMAND_AVAILABLE_CHANNEL,
  BB_DESKTOP_CLI_COMMAND_INSTALL_CHANNEL,
  BB_DESKTOP_CLI_COMMAND_STATUS_CHANNEL,
} from "./desktop-update-ipc.js";

interface CliCommandIpcLogger {
  warn(message: string): void;
}

export interface RegisterCliCommandIpcArgs {
  applicationName: DesktopReleaseInfo["applicationName"];
  logger: CliCommandIpcLogger;
}

/** What the settings row's IPC handlers report, for the app currently running. */
function getStatusForRunningApp(
  applicationName: DesktopReleaseInfo["applicationName"],
): BbDesktopCliCommandStatus {
  return resolveCliCommandStatus({
    commandName: resolveCliCommandName({ productName: applicationName }),
    homeDir: homedir(),
    path: process.env.PATH ?? "",
  });
}

/**
 * Map what `refreshCliCommandLink` actually did to the outcome the settings
 * row needs, so it can show a real result rather than always reporting
 * success. `null` covers both "not packaged" (never reached here, since this
 * channel is only registered when packaged) and "no stable target for this
 * build" (e.g. a non-AppImage Linux build) -- both are "nothing to install".
 */
function toInstallResult(
  linkStatus: BbCliLinkStatus | null,
  status: BbDesktopCliCommandStatus,
): BbDesktopCliCommandInstallResult {
  if (linkStatus === null) {
    return { outcome: "unsupported", status };
  }
  switch (linkStatus.kind) {
    case "written":
      return { detail: linkStatus.path, outcome: "written", status };
    case "unchanged":
      return { detail: linkStatus.path, outcome: "unchanged", status };
    case "foreign-file":
      return { detail: linkStatus.path, outcome: "foreign-file", status };
    case "failed":
      return { detail: linkStatus.message, outcome: "failed", status };
  }
}

/**
 * Register the cli-command settings-row IPC surface.
 *
 * The status/install handlers are only registered when `app.isPackaged`: a
 * dev run has no stable resourcesPath or app bundle, and this handler must
 * never be reachable in a way that could overwrite a developer's real
 * ~/.bb/bin/bb. The availability channel is always registered so the
 * renderer can feature-detect and hide the settings row entirely in dev,
 * rather than rendering it and having its calls reject.
 */
export function registerCliCommandIpc(args: RegisterCliCommandIpcArgs): void {
  ipcMain.handle(BB_DESKTOP_CLI_COMMAND_AVAILABLE_CHANNEL, () => {
    return app.isPackaged;
  });

  if (!app.isPackaged) {
    return;
  }

  ipcMain.handle(BB_DESKTOP_CLI_COMMAND_STATUS_CHANNEL, () => {
    return getStatusForRunningApp(args.applicationName);
  });
  ipcMain.handle(BB_DESKTOP_CLI_COMMAND_INSTALL_CHANNEL, async () => {
    const linkStatus = await refreshCliCommandLink({
      env: process.env,
      homeDir: homedir(),
      isPackaged: app.isPackaged,
      logger: args.logger,
      platform: process.platform,
      productName: args.applicationName,
      resourcesPath: process.resourcesPath,
    });
    return toInstallResult(
      linkStatus,
      getStatusForRunningApp(args.applicationName),
    );
  });
}
