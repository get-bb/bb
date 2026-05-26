import { useEffect, useRef, useState } from "react";
import { appToast } from "@/components/ui/app-toast";
import type { BbDesktopApi, BbDesktopInfo } from "@bb/server-contract";
import { getBbDesktopInfo } from "@/lib/bb-desktop";
import { useSystemVersion } from "./queries/system-queries";

const DISMISSED_STORAGE_KEY_PREFIX = "bb:update-toast:dismissed:";

interface VersionDismissalArgs {
  latestVersion: string;
  storageKeyPrefix: string;
}

interface DesktopToastActionArgs {
  desktopApi: BbDesktopApi;
  latestVersion: string;
}

function getLocalStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isDismissedForVersion(args: VersionDismissalArgs): boolean {
  const storage = getLocalStorage();
  if (storage === null) {
    return false;
  }
  try {
    return (
      storage.getItem(`${args.storageKeyPrefix}${args.latestVersion}`) ===
      "true"
    );
  } catch {
    return false;
  }
}

function markDismissedForVersion(args: VersionDismissalArgs): void {
  const storage = getLocalStorage();
  if (storage === null) {
    return;
  }
  try {
    storage.setItem(`${args.storageKeyPrefix}${args.latestVersion}`, "true");
  } catch {
    // localStorage may be disabled; the in-memory ref keeps the toast hidden
    // for the rest of this session.
  }
}

function appUpdateDescription(latestVersion: string): string {
  return `${latestVersion} is available. Restart bb-app to update.`;
}

function desktopReadyToastDescription(latestVersion: string): string {
  return `bb desktop ${latestVersion} is ready to install.`;
}

function relaunchDesktopUpdate(args: DesktopToastActionArgs): void {
  void args.desktopApi.installUpdate().catch(() => undefined);
  appToast.dismiss(`bb-desktop-update-ready:${args.latestVersion}`);
}

export function useUpdateAvailableToast(): void {
  const { data } = useSystemVersion();
  const shownForVersionRef = useRef<string | null>(null);

  useEffect(() => {
    if (!data) {
      return;
    }
    if (getBbDesktopInfo() !== null) {
      return;
    }
    if (data.isDevelopment) {
      return;
    }
    if (!data.updateAvailable) {
      return;
    }
    const { latestVersion } = data;
    if (latestVersion === null) {
      return;
    }
    if (shownForVersionRef.current === latestVersion) {
      return;
    }
    if (
      isDismissedForVersion({
        latestVersion,
        storageKeyPrefix: DISMISSED_STORAGE_KEY_PREFIX,
      })
    ) {
      shownForVersionRef.current = latestVersion;
      return;
    }
    shownForVersionRef.current = latestVersion;
    appToast.message("bb-app update available", {
      id: `bb-update-available:${latestVersion}`,
      description: appUpdateDescription(latestVersion),
      duration: Infinity,
      cancel: {
        label: "Dismiss",
        onClick: () => {
          markDismissedForVersion({
            latestVersion,
            storageKeyPrefix: DISMISSED_STORAGE_KEY_PREFIX,
          });
          appToast.dismiss(`bb-update-available:${latestVersion}`);
        },
      },
      onDismiss: () => {
        markDismissedForVersion({
          latestVersion,
          storageKeyPrefix: DISMISSED_STORAGE_KEY_PREFIX,
        });
      },
    });
  }, [data]);
}

export function useDesktopUpdateAvailableToast(): void {
  const [desktopApi, setDesktopApi] = useState<BbDesktopApi | null>(null);
  const [desktopInfo, setDesktopInfo] = useState<BbDesktopInfo | null>(null);
  const shownForVersionRef = useRef<string | null>(null);

  useEffect(() => {
    const desktopApi = getBbDesktopInfo();
    if (desktopApi === null) {
      return;
    }
    setDesktopApi(desktopApi);

    let mounted = true;
    void desktopApi
      .getInfo()
      .then((info) => {
        if (mounted) {
          setDesktopInfo(info);
        }
      })
      .catch(() => undefined);
    const unsubscribe = desktopApi.onChange((info) => {
      setDesktopInfo(info);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (desktopInfo === null) {
      return;
    }
    if (desktopApi === null) {
      return;
    }
    if (!desktopInfo.updateDownloaded) {
      return;
    }
    const latestVersion =
      desktopInfo.pendingVersion !== null
        ? desktopInfo.pendingVersion
        : desktopInfo.latestVersion;
    if (latestVersion === null) {
      return;
    }
    if (shownForVersionRef.current === latestVersion) {
      return;
    }
    shownForVersionRef.current = latestVersion;
    appToast.message("Desktop update ready", {
      id: `bb-desktop-update-ready:${latestVersion}`,
      description: desktopReadyToastDescription(latestVersion),
      duration: Infinity,
      action: {
        label: "Relaunch",
        onClick: () => {
          relaunchDesktopUpdate({ desktopApi, latestVersion });
        },
      },
    });
  }, [desktopApi, desktopInfo]);
}
