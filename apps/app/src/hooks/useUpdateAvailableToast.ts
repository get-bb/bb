import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { BbDesktopApi, BbDesktopInfo } from "@bb/server-contract";
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
  updateDownloaded: boolean;
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

function appToastDescription(args: AppToastContentArgs): string {
  return `Restart \`${args.upgradeCommand}\` to get the latest version`;
}

function desktopToastDescription(args: DesktopToastContentArgs): string {
  if (args.updateDownloaded) {
    return `bb desktop ${args.latestVersion} is ready to install`;
  }
  return `bb desktop ${args.latestVersion} is available`;
}

function restartDesktopUpdate(args: DesktopToastActionArgs): void {
  void args.desktopApi.installUpdate().catch(() => undefined);
  toast.dismiss(`bb-desktop-update-ready:${args.latestVersion}`);
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
    if (!desktopInfo.updateAvailable) {
      return;
    }
    const latestVersion =
      desktopInfo.updateDownloaded && desktopInfo.pendingVersion !== null
        ? desktopInfo.pendingVersion
        : desktopInfo.latestVersion;
    if (latestVersion === null) {
      return;
    }
    const toastState = desktopInfo.updateDownloaded
      ? `downloaded:${latestVersion}`
      : `available:${latestVersion}`;
    if (shownForVersionRef.current === toastState) {
      return;
    }
    if (
      !desktopInfo.updateDownloaded &&
      isDismissedForVersion({
        latestVersion,
        storageKeyPrefix: DESKTOP_DISMISSED_STORAGE_KEY_PREFIX,
      })
    ) {
      shownForVersionRef.current = toastState;
      return;
    }
    shownForVersionRef.current = toastState;
    const toastId = desktopInfo.updateDownloaded
      ? `bb-desktop-update-ready:${latestVersion}`
      : `bb-desktop-update-available:${latestVersion}`;
    if (desktopInfo.updateDownloaded) {
      toast.dismiss(`bb-desktop-update-available:${latestVersion}`);
    }
    toast(
      desktopInfo.updateDownloaded
        ? "Desktop update ready"
        : "Desktop update available",
      {
        id: toastId,
        description: desktopToastDescription({
          latestVersion,
          updateDownloaded: desktopInfo.updateDownloaded,
        }),
        duration: Infinity,
        action: {
          label: desktopInfo.updateDownloaded ? "Restart" : "Dismiss",
          onClick: () => {
            if (desktopInfo.updateDownloaded && desktopApi !== null) {
              restartDesktopUpdate({ desktopApi, latestVersion });
              return;
            }
            markDismissedForVersion({
              latestVersion,
              storageKeyPrefix: DESKTOP_DISMISSED_STORAGE_KEY_PREFIX,
            });
            toast.dismiss(toastId);
          },
        },
        onDismiss: () => {
          if (desktopInfo.updateDownloaded) {
            return;
          }
          markDismissedForVersion({
            latestVersion,
            storageKeyPrefix: DESKTOP_DISMISSED_STORAGE_KEY_PREFIX,
          });
        },
      },
    );
  }, [desktopApi, desktopInfo]);
}
