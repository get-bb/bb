import { useCallback, useRef, useState } from "react";
import type {
  ProviderCliInstallAction,
  ProviderCliInstallActionKind,
  ProviderCliInstallEvent,
  ProviderCliKey,
  ProviderCliStatus,
  ProviderCliStatusResponse,
} from "@bb/host-daemon-contract";
import { ProviderCliInstallLogDialog } from "@/components/dialogs/ProviderCliInstallLogDialog";
import type { ProviderCliInstallLogDialogState } from "@/components/dialogs/ProviderCliInstallLogDialog";
import { appToast } from "@/components/ui/app-toast";
import { AppToastCommandDescription } from "@/components/ui/app-toast-descriptions";
import { sdk } from "@/lib/sdk";

type ProviderCliInstallCompletedEvent = Extract<
  ProviderCliInstallEvent,
  { type: "completed" }
>;

export interface ProviderCliStatusEntry {
  provider: ProviderCliKey;
  status: ProviderCliStatus;
}

export interface ProviderCliIssue {
  provider: ProviderCliKey;
  status: ProviderCliStatus;
  action: ProviderCliStatus["installAction"];
  title: string;
  description: string;
  fingerprint: string;
  toastId: string;
}

export interface ProviderCliActionableIssue extends ProviderCliIssue {
  action: ProviderCliInstallAction;
}

type ProviderCliTitlePhase =
  | "queued"
  | "progress"
  | "success"
  | "failure"
  | "log";
type ProviderCliTitleTemplate = (displayName: string) => string;

interface GetProviderCliTitleParams {
  issue: ProviderCliActionableIssue;
  phase: ProviderCliTitlePhase;
}

interface UseProviderCliInstallRunnerArgs {
  onStatusUpdated?: (hostId: string) => void;
}

interface ShowProviderCliInstallFailureToastParams {
  issue: ProviderCliActionableIssue;
  log: string;
  message: string;
  onViewLog: (state: ProviderCliInstallLogDialogState) => void;
  toastId: string;
}

export interface ProviderCliInstallJob {
  hostId: string;
  issue: ProviderCliActionableIssue;
}

/** Stable identity for a (machine, provider) install slot. */
export function providerCliJobKey(
  hostId: string,
  provider: ProviderCliKey,
): string {
  return `${hostId}:${provider}`;
}

const PROVIDER_CLI_TITLE_TEMPLATES = {
  queued: {
    install: (displayName) => `${displayName} install queued`,
    update: (displayName) => `${displayName} update queued`,
  },
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

const PROVIDER_CLI_MANAGED_PROVIDERS = [
  "codex",
  "claudeCode",
] as const satisfies readonly ProviderCliKey[];

export function providerCliEntries(
  status: ProviderCliStatusResponse,
): ProviderCliStatusEntry[] {
  return PROVIDER_CLI_MANAGED_PROVIDERS.map((provider) => ({
    provider,
    status: status[provider],
  }));
}

export function buildProviderCliIssue(
  entry: ProviderCliStatusEntry,
): ProviderCliIssue | null {
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

  if (status.versionUnsupported) {
    const currentVersion = status.currentVersion ?? "Installed version unknown";
    const minimumVersion = status.minimumSupportedVersion ?? "a newer version";
    const requiredDescription = status.minimumSupportedVersion
      ? `required ${status.minimumSupportedVersion}+`
      : "requires a newer version";
    return {
      provider,
      status,
      action: status.installAction,
      title: `${status.displayName} update needed`,
      description: `${currentVersion}; ${requiredDescription}`,
      fingerprint: [
        provider,
        "unsupported",
        status.installSource,
        status.currentVersion ?? "unknown",
        minimumVersion,
        status.executablePath ?? status.executableName,
      ].join(":"),
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

export function isProviderCliIssue(
  issue: ProviderCliIssue | null,
): issue is ProviderCliIssue {
  return issue !== null;
}

export function hasProviderCliAction(
  issue: ProviderCliIssue,
): issue is ProviderCliActionableIssue {
  return issue.action !== null;
}

function exitDescription(event: ProviderCliInstallCompletedEvent): string {
  if (event.exitCode !== null) {
    return `Command exited with code ${event.exitCode}`;
  }
  return `Command exited after signal ${event.signal ?? "unknown"}`;
}

function getProviderCliRunToastId(job: ProviderCliInstallJob): string {
  return `provider-cli-health-run:${providerCliJobKey(job.hostId, job.issue.provider)}`;
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

function showProviderCliInstallQueuedToast(job: ProviderCliInstallJob): void {
  appToast.message(getProviderCliTitle({ issue: job.issue, phase: "queued" }), {
    id: getProviderCliRunToastId(job),
    description: "Waiting for the current install or update to finish.",
    duration: Infinity,
  });
}

export function useProviderCliInstallRunner({
  onStatusUpdated,
}: UseProviderCliInstallRunnerArgs) {
  const queuedInstallsRef = useRef<ProviderCliInstallJob[]>([]);
  const processNextInstallRef = useRef<() => void>(() => {});
  const runningJobKeyRef = useRef<string | null>(null);
  const [queuedJobKeys, setQueuedJobKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [runningJobKey, setRunningJobKey] = useState<string | null>(null);
  const [logDialogState, setLogDialogState] =
    useState<ProviderCliInstallLogDialogState | null>(null);

  const handleCloseProviderCliInstallLog = useCallback(() => {
    setLogDialogState(null);
  }, []);

  const updateQueuedJob = useCallback((jobKey: string, queued: boolean) => {
    setQueuedJobKeys((previous) => {
      if (queued === previous.has(jobKey)) {
        return previous;
      }
      const next = new Set(previous);
      if (queued) {
        next.add(jobKey);
      } else {
        next.delete(jobKey);
      }
      return next;
    });
  }, []);

  const runInstall = useCallback(
    (job: ProviderCliInstallJob) => {
      const { hostId: installHostId, issue } = job;
      const { action } = issue;
      const provider = issue.provider;
      const jobKey = providerCliJobKey(installHostId, provider);

      runningJobKeyRef.current = jobKey;
      setRunningJobKey(jobKey);
      appToast.dismiss(issue.toastId);
      const runToastId = getProviderCliRunToastId(job);
      let installLogChunks = [`$ ${action.command}\n`];
      let completedEvent: ProviderCliInstallCompletedEvent | null = null;
      let errorMessage: string | null = null;

      appToast.loading(getProviderCliTitle({ issue, phase: "progress" }), {
        id: runToastId,
        description: <AppToastCommandDescription command={action.command} />,
      });

      void sdk.hosts
        .installProviderCli({
          hostId: installHostId,
          provider,
          actionKind: action.kind,
        })
        .then((events) => {
          for (const event of events) {
            if (event.provider !== provider) {
              continue;
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
          }

          if (completedEvent?.success) {
            appToast.success(getProviderCliTitle({ issue, phase: "success" }), {
              id: runToastId,
            });
            onStatusUpdated?.(installHostId);
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
          if (runningJobKeyRef.current === jobKey) {
            runningJobKeyRef.current = null;
            setRunningJobKey(null);
          }
          processNextInstallRef.current();
        });
    },
    [onStatusUpdated],
  );

  const processNextInstall = useCallback(() => {
    if (runningJobKeyRef.current !== null) {
      return;
    }
    const nextJob = queuedInstallsRef.current.shift();
    if (nextJob === undefined) {
      return;
    }
    updateQueuedJob(
      providerCliJobKey(nextJob.hostId, nextJob.issue.provider),
      false,
    );
    runInstall(nextJob);
  }, [runInstall, updateQueuedJob]);

  processNextInstallRef.current = processNextInstall;

  const startInstall = useCallback(
    (job: ProviderCliInstallJob) => {
      const jobKey = providerCliJobKey(job.hostId, job.issue.provider);
      appToast.dismiss(job.issue.toastId);
      if (runningJobKeyRef.current === jobKey) {
        return;
      }
      if (
        queuedInstallsRef.current.some(
          (queued) =>
            providerCliJobKey(queued.hostId, queued.issue.provider) === jobKey,
        )
      ) {
        showProviderCliInstallQueuedToast(job);
        return;
      }
      if (runningJobKeyRef.current !== null) {
        queuedInstallsRef.current.push(job);
        updateQueuedJob(jobKey, true);
        showProviderCliInstallQueuedToast(job);
        return;
      }

      runInstall(job);
    },
    [runInstall, updateQueuedJob],
  );

  return {
    installLogDialog: (
      <ProviderCliInstallLogDialog
        state={logDialogState}
        onClose={handleCloseProviderCliInstallLog}
      />
    ),
    queuedJobKeys,
    runningJobKey,
    startInstall,
  };
}
