import { useCallback, useEffect, useRef, useState } from "react";
import { appToast } from "@/components/ui/app-toast";
import { AppToastCommandDescription } from "@/components/ui/app-toast-descriptions";
import type {
  ProviderCliInstallEvent,
  ProviderCliInstallAction,
  ProviderCliInstallActionKind,
  ProviderCliKey,
  ProviderCliStatus,
  ProviderCliStatusResponse,
} from "@bb/host-daemon-contract";
import { providerCliKeyValues } from "@bb/host-daemon-contract";
import { installProviderCli } from "@/lib/api-host-daemon";
import {
  useLocalProviderCliStatus,
  useSystemConfig,
} from "@/hooks/queries/system-queries";
import { isLoopbackOrigin } from "@/lib/system-config-atoms";
import {
  ProviderCliInstallLogDialog,
  type ProviderCliInstallLogDialogState,
} from "@/components/dialogs/ProviderCliInstallLogDialog";

type ProviderCliInstallCompletedEvent = Extract<
  ProviderCliInstallEvent,
  { type: "completed" }
>;

interface ProviderCliStatusEntry {
  provider: ProviderCliKey;
  status: ProviderCliStatus;
}

interface ProviderCliToastIssue {
  provider: ProviderCliKey;
  status: ProviderCliStatus;
  action: ProviderCliStatus["installAction"];
  title: string;
  description: string;
  fingerprint: string;
  toastId: string;
}

interface ProviderCliActionableToastIssue extends ProviderCliToastIssue {
  action: ProviderCliInstallAction;
}

interface ShowProviderCliInstallFailureToastParams {
  issue: ProviderCliActionableToastIssue;
  log: string;
  message: string;
  onViewLog: ViewProviderCliInstallLog;
  toastId: string;
}

type ViewProviderCliInstallLog = (
  state: ProviderCliInstallLogDialogState,
) => void;

type ProviderCliTitlePhase = "progress" | "success" | "failure" | "log";

type ProviderCliTitleTemplate = (displayName: string) => string;

type StartProviderCliInstall = (issue: ProviderCliActionableToastIssue) => void;

interface GetProviderCliTitleParams {
  issue: ProviderCliActionableToastIssue;
  phase: ProviderCliTitlePhase;
}

const PROVIDER_CLI_TOAST_DISMISSED_STORAGE_KEY_PREFIX =
  "bb:provider-cli-toast:dismissed-v2:";

const PROVIDER_CLI_TITLE_TEMPLATES = {
  progress: {
    install: (displayName) => `Installing ${displayName}`,
    update: (displayName) => `Updating ${displayName}`,
  },
  success: {
    install: (displayName) => `${displayName} installed`,
    update: (displayName) => `${displayName} is up to date`,
  },
  failure: {
    install: (displayName) => `${displayName} install failed`,
    update: (displayName) => `${displayName} update failed`,
  },
  log: {
    install: (displayName) => `${displayName} install log`,
    update: (displayName) => `${displayName} update log`,
  },
} satisfies Record<
  ProviderCliTitlePhase,
  Record<ProviderCliInstallActionKind, ProviderCliTitleTemplate>
>;

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

function providerCliEntries(
  status: ProviderCliStatusResponse,
): ProviderCliStatusEntry[] {
  return providerCliKeyValues.map((provider) => ({
    provider,
    status: status[provider],
  }));
}

function buildProviderCliIssue(
  entry: ProviderCliStatusEntry,
): ProviderCliToastIssue | null {
  const { provider, status } = entry;
  const toastId = `provider-cli-health:${provider}`;
  if (!status.installed) {
    return {
      provider,
      status,
      action: status.installAction,
      title: `${status.displayName} CLI not installed`,
      description: `Install ${status.displayName} so bb can start ${status.displayName} sessions.`,
      fingerprint: `${provider}:missing:${status.latestVersion ?? "latest"}`,
      toastId,
    };
  }

  if (status.needsUpdate) {
    if (status.installAction === null) {
      return null;
    }
    const description = `${status.currentVersion ?? "Installed version unknown"} -> ${status.latestVersion ?? "latest"}`;
    const fingerprint = [
      provider,
      "outdated",
      status.installSource,
      status.currentVersion ?? "unknown",
      status.latestVersion ?? "unknown",
      status.executablePath ?? status.executableName,
    ].join(":");
    return {
      provider,
      status,
      action: status.installAction,
      title: `${status.displayName} update available`,
      description,
      fingerprint,
      toastId,
    };
  }

  return null;
}

function isProviderCliToastIssue(
  issue: ProviderCliToastIssue | null,
): issue is ProviderCliToastIssue {
  return issue !== null;
}

function hasProviderCliAction(
  issue: ProviderCliToastIssue,
): issue is ProviderCliActionableToastIssue {
  return issue.action !== null;
}

function exitDescription(event: ProviderCliInstallCompletedEvent): string {
  if (event.exitCode !== null) {
    return `Command exited with code ${event.exitCode}`;
  }
  return `Command exited after signal ${event.signal ?? "unknown"}`;
}

function getProviderCliRunToastId(provider: ProviderCliKey): string {
  return `provider-cli-health-run:${provider}`;
}

function getProviderCliTitle({
  issue,
  phase,
}: GetProviderCliTitleParams): string {
  return PROVIDER_CLI_TITLE_TEMPLATES[phase][issue.action.kind](
    issue.status.displayName,
  );
}

function showProviderCliInstallFailureToast({
  issue,
  log,
  message,
  onViewLog,
  toastId,
}: ShowProviderCliInstallFailureToastParams): void {
  const logDialogState: ProviderCliInstallLogDialogState = {
    displayName: issue.status.displayName,
    log,
    message,
    title: getProviderCliTitle({ issue, phase: "log" }),
  };

  appToast.error(getProviderCliTitle({ issue, phase: "failure" }), {
    id: toastId,
    description: message,
    action: {
      label: "View log",
      onClick: () => onViewLog(logDialogState),
    },
  });
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
  const dismissedFingerprintsRef = useRef<Set<string>>(new Set());
  const shownFingerprintsRef = useRef<Set<string>>(new Set());
  const activeIssuesRef = useRef<Map<string, ProviderCliToastIssue>>(new Map());
  const runningProviderRef = useRef<ProviderCliKey | null>(null);
  const [logDialogState, setLogDialogState] =
    useState<ProviderCliInstallLogDialogState | null>(null);

  const markIssueDismissed = useCallback((issue: ProviderCliToastIssue) => {
    dismissedFingerprintsRef.current.add(issue.fingerprint);
    markDismissedForFingerprint(issue.fingerprint);
  }, []);

  const clearIssueDismissal = useCallback((issue: ProviderCliToastIssue) => {
    dismissedFingerprintsRef.current.delete(issue.fingerprint);
    clearDismissedForFingerprint(issue.fingerprint);
  }, []);

  const dismissIssue = useCallback(
    (issue: ProviderCliToastIssue) => {
      markIssueDismissed(issue);
      appToast.dismiss(issue.toastId);
    },
    [markIssueDismissed],
  );

  const handleCloseProviderCliInstallLog = useCallback(() => {
    setLogDialogState(null);
  }, []);

  const startInstall = useCallback<StartProviderCliInstall>(
    (issue) => {
      const action = issue.action;
      if (daemonPort === null) {
        appToast.error("Host daemon unavailable", {
          description: "Start bb again and retry the provider CLI setup.",
        });
        return;
      }
      if (runningProviderRef.current !== null) {
        appToast.warning("Provider CLI setup already running", {
          description: "Wait for the current install or update to finish.",
        });
        return;
      }

      runningProviderRef.current = issue.provider;
      appToast.dismiss(issue.toastId);
      const runToastId = getProviderCliRunToastId(issue.provider);
      let installLogChunks = [`$ ${action.command}\n`];
      let completedEvent: ProviderCliInstallCompletedEvent | null = null;
      let errorMessage: string | null = null;

      appToast.loading(getProviderCliTitle({ issue, phase: "progress" }), {
        id: runToastId,
        description: <AppToastCommandDescription command={action.command} />,
      });

      void installProviderCli({
        port: daemonPort,
        request: {
          provider: issue.provider,
          actionKind: action.kind,
        },
        onEvent: (event) => {
          if (event.provider !== issue.provider) {
            return;
          }
          switch (event.type) {
            case "started":
              installLogChunks = [`$ ${event.command}\n`];
              appToast.loading(
                getProviderCliTitle({ issue, phase: "progress" }),
                {
                  id: runToastId,
                  description: (
                    <AppToastCommandDescription command={event.command} />
                  ),
                },
              );
              break;
            case "output":
              if (event.text.length > 0) {
                installLogChunks.push(event.text);
              }
              break;
            case "completed":
              completedEvent = event;
              break;
            case "error":
              errorMessage = event.message;
              installLogChunks.push(`\n${event.message}\n`);
              break;
          }
        },
      })
        .then(() => {
          if (completedEvent?.success) {
            appToast.success(getProviderCliTitle({ issue, phase: "success" }), {
              id: runToastId,
            });
            void refetchProviderCliStatus();
            return;
          }

          const failureMessage =
            errorMessage ??
            (completedEvent
              ? exitDescription(completedEvent)
              : "Command finished without reporting success.");
          showProviderCliInstallFailureToast({
            issue,
            log: installLogChunks.join(""),
            message: failureMessage,
            onViewLog: setLogDialogState,
            toastId: runToastId,
          });
        })
        .catch((error) => {
          const message =
            error instanceof Error ? error.message : String(error);
          installLogChunks.push(`\n${message}\n`);
          showProviderCliInstallFailureToast({
            issue,
            log: installLogChunks.join(""),
            message,
            onViewLog: setLogDialogState,
            toastId: runToastId,
          });
        })
        .finally(() => {
          if (runningProviderRef.current === issue.provider) {
            runningProviderRef.current = null;
          }
        });
    },
    [daemonPort, refetchProviderCliStatus],
  );

  useEffect(() => {
    const data = providerCliStatus.data;
    if (!data) {
      return;
    }

    const currentIssues = providerCliEntries(data)
      .map(buildProviderCliIssue)
      .filter(isProviderCliToastIssue);
    const currentIssuesByFingerprint = new Map<string, ProviderCliToastIssue>();

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
        const dismissAction =
          issue.action.kind === "update"
            ? {
                label: "Dismiss",
                onClick: () => dismissIssue(issue),
              }
            : undefined;
        appToast.warning(issue.title, {
          id: issue.toastId,
          description: issue.description,
          duration: Infinity,
          action: {
            label: issue.action.label,
            onClick: () => startInstall(issue),
          },
          ...(dismissAction ? { cancel: dismissAction } : {}),
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

  return (
    <ProviderCliInstallLogDialog
      state={logDialogState}
      onClose={handleCloseProviderCliInstallLog}
    />
  );
}
