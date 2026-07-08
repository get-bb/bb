import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { BbDesktopApi, BbDesktopInfo } from "@bb/desktop-contract";
import type { SystemVersionResponse } from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  SettingsSection,
  SettingsWithControl,
} from "@/components/ui/settings-section.js";
import { appToast } from "@/components/ui/app-toast.js";
import { hydrateSystemVersionCache } from "@/hooks/cache-owners/system-version-cache-owner";
import { getBbDesktopInfo } from "@/lib/bb-desktop";
import * as api from "@/lib/api";

function updateCheckErrorDescription(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return "The update check did not complete.";
}

function relaunchDesktopUpdate(desktopApi: BbDesktopApi): void {
  void desktopApi.installUpdate().catch((error: unknown) => {
    appToast.error("Relaunch failed", {
      description: updateCheckErrorDescription(error),
    });
  });
}

function desktopUpdateVersionLabel(info: BbDesktopInfo): string | null {
  return info.pendingVersion ?? info.latestVersion;
}

function showDesktopUpdateCheckResult(
  desktopApi: BbDesktopApi,
  info: BbDesktopInfo,
): void {
  const latestVersion = desktopUpdateVersionLabel(info);

  if (info.updateDownloaded) {
    appToast.message("Desktop update ready", {
      description:
        latestVersion === null
          ? "A desktop update is ready to install."
          : `bb desktop ${latestVersion} is ready to install.`,
      duration: Infinity,
      action: {
        label: "Relaunch",
        onClick: () => relaunchDesktopUpdate(desktopApi),
      },
    });
    return;
  }

  if (info.updateAvailable) {
    appToast.message("Desktop update available", {
      description:
        latestVersion === null
          ? "An update is available. It will download in the background."
          : `${latestVersion} is available. It will download in the background.`,
      duration: Infinity,
    });
    return;
  }

  appToast.success("bb desktop is up to date", {
    description: `You're running ${info.version}.`,
  });
}

function showWebUpdateCheckResult(version: SystemVersionResponse): void {
  if (version.isDevelopment) {
    appToast.message("Update checks disabled", {
      description: "bb-app is running in development mode.",
    });
    return;
  }

  if (version.latestVersion === null) {
    appToast.warning("Couldn't check for updates", {
      description: "The npm registry did not return a bb-app version.",
    });
    return;
  }

  if (version.updateAvailable) {
    appToast.message("bb-app update available", {
      description:
        `${version.latestVersion} is available. ` +
        `Run \`${version.upgradeCommand}\` to update.`,
      duration: Infinity,
    });
    return;
  }

  appToast.success("bb-app is up to date", {
    description: `You're running ${version.currentVersion}.`,
  });
}

export function UpdatesSettingsSection() {
  const queryClient = useQueryClient();
  const [isChecking, setIsChecking] = useState(false);
  const [desktopShellAvailable] = useState(() => getBbDesktopInfo() !== null);

  async function handleCheckForUpdates(): Promise<void> {
    if (isChecking) {
      return;
    }

    setIsChecking(true);
    try {
      const desktopApi = getBbDesktopInfo();
      if (desktopApi !== null) {
        showDesktopUpdateCheckResult(
          desktopApi,
          await desktopApi.checkForUpdates(),
        );
        return;
      }

      const version = await api.getSystemVersion({ force: true });
      hydrateSystemVersionCache({ queryClient, version });
      showWebUpdateCheckResult(version);
    } catch (error: unknown) {
      appToast.error("Update check failed", {
        description: updateCheckErrorDescription(error),
      });
    } finally {
      setIsChecking(false);
    }
  }

  return (
    <SettingsSection title="Updates">
      <SettingsWithControl
        label="bb app"
        description={
          desktopShellAvailable
            ? "Check the desktop update feed."
            : "Check npm for the latest bb-app release."
        }
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          aria-busy={isChecking}
          aria-label="Check for updates"
          disabled={isChecking}
          onClick={() => {
            void handleCheckForUpdates();
          }}
        >
          <Icon
            name={isChecking ? "Spinner" : "RotateCcw"}
            className={cn("size-3.5", isChecking && "animate-spin")}
          />
          {isChecking ? "Checking" : "Check for updates"}
        </Button>
      </SettingsWithControl>
    </SettingsSection>
  );
}
