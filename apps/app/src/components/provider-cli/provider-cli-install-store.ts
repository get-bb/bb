import type { QueryClient } from "@tanstack/react-query";
import type {
  ProviderCliInstallActionKind,
  ProviderCliInstallEvent,
  ProviderCliKey,
} from "@bb/host-daemon-contract";
import type { ProviderCliInstallLogDialogState } from "@/components/dialogs/ProviderCliInstallLogDialog";
import type { ProviderCliActionableIssue } from "@/components/provider-cli/provider-cli-install";
import { appToast } from "@/components/ui/app-toast";
import { invalidateHostProviderCliStatus } from "@/hooks/cache-owners/provider-cli-status-cache-owner";
import { sdk } from "@/lib/sdk";

type ProviderCliInstallCompletedEvent = Extract<
  ProviderCliInstallEvent,
  { type: "completed" }
>;

type ProviderCliTitlePhase = "failure" | "log";
type ProviderCliTitleTemplate = (displayName: string) => string;

export interface ProviderCliInstallJob {
  hostId: string;
  issue: ProviderCliActionableIssue;
}

export interface ProviderCliInstallSnapshot {
  /** The job currently executing on a host, or null when nothing is running. */
  runningJobKey: string | null;
  /** Jobs waiting behind the running one. */
  queuedJobKeys: ReadonlySet<string>;
  /** The failure log a user opened from a toast, or null when closed. */
  logDialogState: ProviderCliInstallLogDialogState | null;
}

const PROVIDER_CLI_TITLE_TEMPLATES = {
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

const EMPTY_QUEUED_JOB_KEYS: ReadonlySet<string> = new Set();

const INITIAL_SNAPSHOT: ProviderCliInstallSnapshot = {
  runningJobKey: null,
  queuedJobKeys: EMPTY_QUEUED_JOB_KEYS,
  logDialogState: null,
};

// Module-level, not component state: a provider CLI install keeps running (and
// its queue keeps draining) after the user navigates away from Settings →
// Updates. Components subscribe to mirror progress; they never own it.
let snapshot: ProviderCliInstallSnapshot = INITIAL_SNAPSHOT;
let queuedJobs: ProviderCliInstallJob[] = [];
let queryClient: QueryClient | null = null;
const listeners = new Set<() => void>();

function setSnapshot(patch: Partial<ProviderCliInstallSnapshot>): void {
  snapshot = { ...snapshot, ...patch };
  for (const listener of listeners) {
    listener();
  }
}

/** Stable identity for a (machine, provider) install slot. */
export function providerCliJobKey(
  hostId: string,
  provider: ProviderCliKey,
): string {
  return `${hostId}:${provider}`;
}

export function subscribeProviderCliInstalls(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getProviderCliInstallSnapshot(): ProviderCliInstallSnapshot {
  return snapshot;
}

/**
 * The store outlives every component, so it cannot read the query client from
 * React context when an install finishes. Mounted consumers hand it over; the
 * app's client is process-stable, so the last registration stays correct even
 * after they all unmount.
 */
export function registerProviderCliInstallQueryClient(
  client: QueryClient,
): void {
  queryClient = client;
}

export function openProviderCliInstallLog(
  logDialogState: ProviderCliInstallLogDialogState,
): void {
  setSnapshot({ logDialogState });
}

export function closeProviderCliInstallLog(): void {
  setSnapshot({ logDialogState: null });
}

function setQueuedJobKey(jobKey: string, queued: boolean): void {
  if (queued === snapshot.queuedJobKeys.has(jobKey)) {
    return;
  }
  const next = new Set(snapshot.queuedJobKeys);
  if (queued) {
    next.add(jobKey);
  } else {
    next.delete(jobKey);
  }
  setSnapshot({ queuedJobKeys: next });
}

function exitDescription(event: ProviderCliInstallCompletedEvent): string {
  if (event.exitCode !== null) {
    return `Command exited with code ${event.exitCode}`;
  }
  return `Command exited after signal ${event.signal ?? "unknown"}`;
}

function getProviderCliTitle(args: {
  issue: ProviderCliActionableIssue;
  phase: ProviderCliTitlePhase;
}): string {
  return PROVIDER_CLI_TITLE_TEMPLATES[args.phase][args.issue.action.kind](
    args.issue.status.displayName,
  );
}

function showProviderCliInstallFailureToast(args: {
  issue: ProviderCliActionableIssue;
  log: string;
  message: string;
  toastId: string;
}): void {
  const logDialogState: ProviderCliInstallLogDialogState = {
    displayName: args.issue.status.displayName,
    log: args.log,
    message: args.message,
    title: getProviderCliTitle({ issue: args.issue, phase: "log" }),
  };

  appToast.error(getProviderCliTitle({ issue: args.issue, phase: "failure" }), {
    id: args.toastId,
    description: args.message,
    action: {
      label: "View log",
      onClick: () => openProviderCliInstallLog(logDialogState),
    },
  });
}

function runInstall(job: ProviderCliInstallJob): void {
  const { hostId, issue } = job;
  const { action, provider } = issue;
  const jobKey = providerCliJobKey(hostId, provider);

  setSnapshot({ runningJobKey: jobKey });
  const failureToastId = `provider-cli-install-failure:${jobKey}`;
  let installLogChunks = [`$ ${action.command}\n`];
  let completedEvent: ProviderCliInstallCompletedEvent | null = null;
  let errorMessage: string | null = null;

  void sdk.hosts
    .installProviderCli({ hostId, provider, actionKind: action.kind })
    .then((events) => {
      for (const event of events) {
        if (event.provider !== provider) {
          continue;
        }
        switch (event.type) {
          case "started":
            installLogChunks = [`$ ${event.command}\n`];
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
        if (queryClient !== null) {
          void invalidateHostProviderCliStatus({ queryClient, hostId });
        }
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
        toastId: failureToastId,
      });
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      installLogChunks.push(`\n${message}\n`);
      showProviderCliInstallFailureToast({
        issue,
        log: installLogChunks.join(""),
        message,
        toastId: failureToastId,
      });
    })
    .finally(() => {
      if (snapshot.runningJobKey === jobKey) {
        setSnapshot({ runningJobKey: null });
      }
      processNextInstall();
    });
}

function processNextInstall(): void {
  if (snapshot.runningJobKey !== null) {
    return;
  }
  const nextJob = queuedJobs.shift();
  if (nextJob === undefined) {
    return;
  }
  setQueuedJobKey(
    providerCliJobKey(nextJob.hostId, nextJob.issue.provider),
    false,
  );
  runInstall(nextJob);
}

export function startProviderCliInstall(job: ProviderCliInstallJob): void {
  const jobKey = providerCliJobKey(job.hostId, job.issue.provider);
  if (snapshot.runningJobKey === jobKey) {
    return;
  }
  if (
    queuedJobs.some(
      (queued) =>
        providerCliJobKey(queued.hostId, queued.issue.provider) === jobKey,
    )
  ) {
    return;
  }
  if (snapshot.runningJobKey !== null) {
    queuedJobs.push(job);
    setQueuedJobKey(jobKey, true);
    return;
  }

  runInstall(job);
}

/** Drop all cross-test state from this module-level store. */
export function resetProviderCliInstallStoreForTests(): void {
  snapshot = INITIAL_SNAPSHOT;
  queuedJobs = [];
  queryClient = null;
  listeners.clear();
}
