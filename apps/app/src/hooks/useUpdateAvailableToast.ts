import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { BbDesktopInfo } from "@bb/server-contract";
import { getBbDesktopInfo } from "@/lib/bb-desktop";
import { useSystemVersion } from "./queries/system-queries";

const DISMISSED_STORAGE_KEY_PREFIX = "bb:update-toast:dismissed:";
const DESKTOP_DISMISSED_STORAGE_KEY_PREFIX =
  "bb:desktop-update-toast:dismissed:";

interface VersionDismissalArgs {
  latestVersion: string;
  storageKeyPrefix: string;
}

interface AppToastContentArgs {
  upgradeCommand: string;
}

interface DesktopToastContentArgs {
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

function appToastDescription(args: AppToastContentArgs): string {
  return `Restart \`${args.upgradeCommand}\` to get the latest version`;
}

function desktopToastDescription(args: DesktopToastContentArgs): string {
  return `bb desktop ${args.latestVersion} is available`;
}

export function useUpdateAvailableToast(): void {
  const { data } = useSystemVersion();
  const shownForVersionRef = useRef<string | null>(null);

  useEffect(() => {
    if (!data) {
      return;
    }
    if (data.isDevelopment) {
      return;
    }
    if (!data.updateAvailable) {
      return;
    }
    const { latestVersion, upgradeCommand } = data;
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
    toast(`Update available: bb-app ${latestVersion}`, {
      id: `bb-update-available:${latestVersion}`,
      description: appToastDescription({ upgradeCommand }),
      duration: Infinity,
      action: {
        label: "Dismiss",
        onClick: () => {
          markDismissedForVersion({
            latestVersion,
            storageKeyPrefix: DISMISSED_STORAGE_KEY_PREFIX,
          });
          toast.dismiss(`bb-update-available:${latestVersion}`);
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
  const [desktopInfo, setDesktopInfo] = useState<BbDesktopInfo | null>(null);
  const shownForVersionRef = useRef<string | null>(null);

  useEffect(() => {
    const desktopApi = getBbDesktopInfo();
    if (desktopApi === null) {
      return;
    }

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
    if (!desktopInfo.updateAvailable) {
      return;
    }
    const { latestVersion } = desktopInfo;
    if (latestVersion === null) {
      return;
    }
    if (shownForVersionRef.current === latestVersion) {
      return;
    }
    if (
      isDismissedForVersion({
        latestVersion,
        storageKeyPrefix: DESKTOP_DISMISSED_STORAGE_KEY_PREFIX,
      })
    ) {
      shownForVersionRef.current = latestVersion;
      return;
    }
    shownForVersionRef.current = latestVersion;
    toast("Desktop update available", {
      id: `bb-desktop-update-available:${latestVersion}`,
      description: desktopToastDescription({ latestVersion }),
      duration: Infinity,
      action: {
        label: "Dismiss",
        onClick: () => {
          markDismissedForVersion({
            latestVersion,
            storageKeyPrefix: DESKTOP_DISMISSED_STORAGE_KEY_PREFIX,
          });
          toast.dismiss(`bb-desktop-update-available:${latestVersion}`);
        },
      },
      onDismiss: () => {
        markDismissedForVersion({
          latestVersion,
          storageKeyPrefix: DESKTOP_DISMISSED_STORAGE_KEY_PREFIX,
        });
      },
    });
  }, [desktopInfo]);
}
