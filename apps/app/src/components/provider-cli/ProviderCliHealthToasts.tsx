import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type {
  ProviderCliInstallEvent,
  ProviderCliKey,
  ProviderCliStatus,
  ProviderCliStatusResponse,
} from "@bb/host-daemon-contract";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon, type IconName } from "@/components/ui/icon";
import { CopyButton } from "@/components/ui/copy-button";
import { installProviderCli } from "@/lib/api-host-daemon";
import {
  useLocalProviderCliStatus,
  useSystemConfig,
} from "@/hooks/queries/system-queries";

type ProviderCliActionLabel = "Install" | "Update";
type ProviderCliInstallStatus = "running" | "succeeded" | "failed";
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

interface ProviderCliInstallState {
  provider: ProviderCliKey;
  displayName: string;
  actionLabel: ProviderCliActionLabel;
  command: string;
  status: ProviderCliInstallStatus;
  log: string;
  errorMessage: string | null;
}

interface ProviderCliInstallDialogProps {
  state: ProviderCliInstallState | null;
  onClose: () => void;
}

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

function providerCliEntries(
  status: ProviderCliStatusResponse,
): ProviderCliStatusEntry[] {
  return [
    { provider: "codex", status: status.codex },
    { provider: "claudeCode", status: status.claudeCode },
  ];
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
      title: `${status.displayName} is not installed`,
      description: `Install the latest ${status.displayName} CLI with npm so bb can start ${status.executableName} sessions.`,
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

function appendInstallLog(log: string, text: string): string {
  if (text.length === 0) {
    return log;
  }
  return `${log}${text}`;
}

function exitDescription(event: ProviderCliInstallCompletedEvent): string {
  if (event.exitCode !== null) {
    return `Command exited with code ${event.exitCode}`;
  }
  return `Command exited after signal ${event.signal ?? "unknown"}`;
}

function applyInstallEvent(
  state: ProviderCliInstallState,
  event: ProviderCliInstallEvent,
): ProviderCliInstallState {
  if (state.provider !== event.provider) {
    return state;
  }

  switch (event.type) {
    case "started":
      return {
        ...state,
        command: event.command,
        log: `$ ${event.command}\n`,
      };
    case "output":
      return {
        ...state,
        log: appendInstallLog(state.log, event.text),
      };
    case "completed":
      return {
        ...state,
        status: event.success ? "succeeded" : "failed",
        errorMessage: event.success ? null : exitDescription(event),
      };
    case "error":
      return {
        ...state,
        status: "failed",
        errorMessage: event.message,
        log: appendInstallLog(state.log, `\n${event.message}\n`),
      };
  }
}

function installDialogDescription(
  state: ProviderCliInstallState | null,
): string {
  if (state === null) {
    return "Provider CLI setup";
  }
  if (state.status === "running") {
    return `Running ${state.command}. Keep bb open until the command finishes.`;
  }
  if (state.status === "succeeded") {
    return `${state.command} completed successfully.`;
  }
  return `${state.command} failed. Review or copy the log below.`;
}

function ProviderCliInstallDialog({
  state,
  onClose,
}: ProviderCliInstallDialogProps) {
  const open = state !== null;
  const isRunning = state?.status === "running";
  const statusLabel =
    state?.status === "running"
      ? "Running"
      : state?.status === "succeeded"
        ? "Complete"
        : "Failed";
  const statusIcon: IconName =
    state?.status === "succeeded"
      ? "Check"
      : state?.status === "failed"
        ? "AlertCircle"
        : "Spinner";

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen || isRunning) {
          return;
        }
        onClose();
      }}
    >
      <DialogContent className="gap-4 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {state ? `${state.actionLabel} ${state.displayName}` : "CLI setup"}
          </DialogTitle>
          <DialogDescription>
            {installDialogDescription(state)}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm">
          <div className="flex min-w-0 items-center gap-2">
            <Icon
              name={statusIcon}
              className={
                state?.status === "running" ? "size-4 animate-spin" : "size-4"
              }
            />
            <span className="font-medium">{statusLabel}</span>
          </div>
          {state?.log ? (
            <CopyButton
              text={state.log}
              label="Copy install log"
              successMessage="Install log copied"
              className="size-8 rounded-md border bg-background"
              iconClassName="size-4"
            />
          ) : null}
        </div>

        <pre className="max-h-80 min-h-32 overflow-auto rounded-md border bg-background p-3 text-xs whitespace-pre-wrap break-words text-foreground">
          {state?.log || "Waiting for install output..."}
        </pre>

        {state?.errorMessage ? (
          <div className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <Icon name="AlertCircle" className="mt-0.5 size-4 shrink-0" />
            <p className="min-w-0 break-words">{state.errorMessage}</p>
          </div>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isRunning}
          >
            <Icon name="X" />
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ProviderCliHealthToasts() {
  const systemConfig = useSystemConfig();
  const daemonPort = systemConfig.data?.hostDaemonPort ?? null;
  const providerCliStatus = useLocalProviderCliStatus({
    daemonPort,
    enabled: daemonPort !== null,
  });
  const dismissedFingerprintsRef = useRef<Set<string>>(new Set());
  const shownFingerprintsRef = useRef<Set<string>>(new Set());
  const activeIssuesRef = useRef<Map<string, ProviderCliToastIssue>>(
    new Map(),
  );
  const runningProviderRef = useRef<ProviderCliKey | null>(null);
  const [installState, setInstallState] =
    useState<ProviderCliInstallState | null>(null);

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
      toast.dismiss(issue.toastId);
    },
    [markIssueDismissed],
  );

  const startInstall = useCallback(
    (issue: ProviderCliToastIssue) => {
      if (issue.action === null) {
        return;
      }
      if (daemonPort === null) {
        toast.error("Host daemon unavailable", {
          description: "Start bb again and retry the provider CLI setup.",
        });
        return;
      }
      if (runningProviderRef.current !== null) {
        toast.error("Provider CLI setup already running", {
          description: "Wait for the current install or update to finish.",
        });
        return;
      }

      runningProviderRef.current = issue.provider;
      toast.dismiss(issue.toastId);
      setInstallState({
        provider: issue.provider,
        displayName: issue.status.displayName,
        actionLabel: issue.action.label,
        command: issue.action.command,
        status: "running",
        log: `$ ${issue.action.command}\n`,
        errorMessage: null,
      });

      let installSucceeded = false;
      void installProviderCli({
        port: daemonPort,
        request: {
          provider: issue.provider,
          actionKind: issue.action.kind,
        },
        onEvent: (event) => {
          if (event.type === "completed") {
            installSucceeded = event.success;
          }
          setInstallState((current) =>
            current ? applyInstallEvent(current, event) : current,
          );
        },
      })
        .then(() => {
          if (!installSucceeded) {
            return;
          }
          toast.success(`${issue.status.displayName} is up to date`);
          void providerCliStatus.refetch();
        })
        .catch((error) => {
          const message =
            error instanceof Error ? error.message : String(error);
          setInstallState((current) =>
            current
              ? {
                  ...current,
                  status: "failed",
                  errorMessage: message,
                  log: appendInstallLog(current.log, `\n${message}\n`),
                }
              : current,
          );
        })
        .finally(() => {
          if (runningProviderRef.current === issue.provider) {
            runningProviderRef.current = null;
          }
        });
    },
    [daemonPort, providerCliStatus],
  );

  useEffect(() => {
    const data = providerCliStatus.data;
    if (!data) {
      return;
    }

    const currentIssues = providerCliEntries(data)
      .map(buildProviderCliIssue)
      .filter(isProviderCliToastIssue);
    const currentIssuesByFingerprint = new Map<
      string,
      ProviderCliToastIssue
    >();

    for (const issue of currentIssues) {
      currentIssuesByFingerprint.set(issue.fingerprint, issue);
    }

    for (const previousIssue of activeIssuesRef.current.values()) {
      if (!currentIssuesByFingerprint.has(previousIssue.fingerprint)) {
        toast.dismiss(previousIssue.toastId);
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
      if (issue.action !== null) {
        toast.warning(issue.title, {
          id: issue.toastId,
          description: issue.description,
          duration: Infinity,
          closeButton: true,
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
        toast.warning(issue.title, {
          id: issue.toastId,
          description: issue.description,
          duration: Infinity,
          closeButton: true,
          cancel: {
            label: "Dismiss",
            onClick: () => dismissIssue(issue),
          },
        });
      }
    }
  }, [clearIssueDismissal, dismissIssue, providerCliStatus.data, startInstall]);

  return (
    <ProviderCliInstallDialog
      state={installState}
      onClose={() => setInstallState(null)}
    />
  );
}
