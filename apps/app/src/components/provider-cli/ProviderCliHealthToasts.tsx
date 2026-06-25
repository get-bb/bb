import { useCallback, useEffect, useRef } from "react";
import { appToast } from "@/components/ui/app-toast";
import type { ProviderCliIssue } from "./provider-cli-install";
import {
  buildProviderCliIssue,
  hasProviderCliAction,
  isProviderCliIssue,
  providerCliEntries,
  useProviderCliInstallRunner,
} from "./provider-cli-install";
import {
  useLocalProviderCliStatus,
  useSystemConfig,
} from "@/hooks/queries/system-queries";
import { isLoopbackOrigin } from "@/lib/system-config-atoms";

const PROVIDER_CLI_TOAST_DISMISSED_STORAGE_KEY_PREFIX =
  "bb:provider-cli-toast:dismissed-v2:";

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

function dismissedStorageKey(fingerprint: string): string {
  return `${PROVIDER_CLI_TOAST_DISMISSED_STORAGE_KEY_PREFIX}${fingerprint}`;
}

function isDismissedForFingerprint(fingerprint: string): boolean {
  const storage = getLocalStorage();
  if (storage === null) {
    return false;
  }
  try {
    return storage.getItem(dismissedStorageKey(fingerprint)) === "true";
  } catch {
    return false;
  }
}

function markDismissedForFingerprint(fingerprint: string): void {
  const storage = getLocalStorage();
  if (storage === null) {
    return;
  }
  try {
    storage.setItem(dismissedStorageKey(fingerprint), "true");
  } catch {
    // The in-memory dismissal set still keeps the toast hidden this session.
  }
}

function clearDismissedForFingerprint(fingerprint: string): void {
  const storage = getLocalStorage();
  if (storage === null) {
    return;
  }
  try {
    storage.removeItem(dismissedStorageKey(fingerprint));
  } catch {
    // Clearing localStorage is best-effort; refs still reset this session.
  }
}

export function ProviderCliHealthToasts() {
  const systemConfig = useSystemConfig();
  // Only probe the loopback-bound daemon when the page is itself a loopback
  // origin; from a remote/Tailscale origin the request is always CORS-blocked.
  const daemonPort = isLoopbackOrigin()
    ? (systemConfig.data?.hostDaemonPort ?? null)
    : null;
  const providerCliStatus = useLocalProviderCliStatus({
    daemonPort,
    enabled: daemonPort !== null,
  });
  const refetchProviderCliStatus = providerCliStatus.refetch;
  const { installLogDialog, startInstall } = useProviderCliInstallRunner({
    daemonPort,
    onStatusUpdated: () => {
      void refetchProviderCliStatus();
    },
  });
  const dismissedFingerprintsRef = useRef<Set<string>>(new Set());
  const shownFingerprintsRef = useRef<Set<string>>(new Set());
  const activeIssuesRef = useRef<Map<string, ProviderCliIssue>>(new Map());

  const markIssueDismissed = useCallback((issue: ProviderCliIssue) => {
    dismissedFingerprintsRef.current.add(issue.fingerprint);
    markDismissedForFingerprint(issue.fingerprint);
  }, []);

  const clearIssueDismissal = useCallback((issue: ProviderCliIssue) => {
    dismissedFingerprintsRef.current.delete(issue.fingerprint);
    clearDismissedForFingerprint(issue.fingerprint);
  }, []);

  const dismissIssue = useCallback(
    (issue: ProviderCliIssue) => {
      markIssueDismissed(issue);
      appToast.dismiss(issue.toastId);
    },
    [markIssueDismissed],
  );

  useEffect(() => {
    const data = providerCliStatus.data;
    if (!data) {
      return;
    }

    const currentIssues = providerCliEntries(data)
      .map(buildProviderCliIssue)
      .filter(isProviderCliIssue);
    const currentIssuesByFingerprint = new Map<string, ProviderCliIssue>();

    for (const issue of currentIssues) {
      currentIssuesByFingerprint.set(issue.fingerprint, issue);
    }

    for (const previousIssue of activeIssuesRef.current.values()) {
      if (!currentIssuesByFingerprint.has(previousIssue.fingerprint)) {
        appToast.dismiss(previousIssue.toastId);
        shownFingerprintsRef.current.delete(previousIssue.fingerprint);
        clearIssueDismissal(previousIssue);
      }
    }

    activeIssuesRef.current = currentIssuesByFingerprint;

    for (const issue of currentIssues) {
      if (
        dismissedFingerprintsRef.current.has(issue.fingerprint) ||
        isDismissedForFingerprint(issue.fingerprint)
      ) {
        dismissedFingerprintsRef.current.add(issue.fingerprint);
        continue;
      }
      if (shownFingerprintsRef.current.has(issue.fingerprint)) {
        continue;
      }

      shownFingerprintsRef.current.add(issue.fingerprint);
      if (hasProviderCliAction(issue)) {
        appToast.warning(issue.title, {
          id: issue.toastId,
          description: issue.description,
          duration: Infinity,
          action: {
            label: issue.action.label,
            onClick: () => startInstall(issue),
          },
          cancel: {
            label: "Dismiss",
            onClick: () => dismissIssue(issue),
          },
        });
      } else {
        appToast.warning(issue.title, {
          id: issue.toastId,
          description: issue.description,
          duration: Infinity,
          cancel: {
            label: "Dismiss",
            onClick: () => dismissIssue(issue),
          },
        });
      }
    }
  }, [clearIssueDismissal, dismissIssue, providerCliStatus.data, startInstall]);

  return installLogDialog;
}
