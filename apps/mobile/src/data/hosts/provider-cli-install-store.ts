import type {
  ProviderCliInstallActionKind,
  ProviderCliKey,
} from "@bb/host-daemon-contract/local";
import type {
  ProviderCliActionableIssue,
  ProviderCliInstallOutcome,
} from "./provider-cli-install";

/**
 * Queue + results of provider CLI installs (mirror of
 * apps/app/src/components/provider-cli/provider-cli-install-store.ts). The
 * store — not a screen — owns the running job, so an install started from
 * Settings → Updates keeps going after the user navigates away, and its log
 * stays readable from the row ("View log") afterwards. Pure: the runner is
 * injected (the app binds it to the profile's SDK; tests use a fake).
 */

export interface ProviderCliInstallJob {
  /** Installs are per server; the key includes the profile so two servers never share a slot. */
  profileId: string;
  hostId: string;
  issue: ProviderCliActionableIssue;
}

export type ProviderCliInstallJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed";

export interface ProviderCliInstallRecord {
  jobKey: string;
  profileId: string;
  hostId: string;
  provider: ProviderCliKey;
  displayName: string;
  actionKind: ProviderCliInstallActionKind;
  /** The problem this run was started for; a later status change retires the record. */
  issueFingerprint: string;
  status: ProviderCliInstallJobStatus;
  log: string;
  /** Failure summary (null while running or after success). */
  message: string | null;
  startedAt: number | null;
  finishedAt: number | null;
}

/**
 * A request to show one record's log. `seq` grows on every `openLog` so the
 * same log can be asked for twice in a row (the host presents its sheet on
 * each new request; dismissing the sheet needs no store write).
 */
export interface ProviderCliInstallLogRequest {
  jobKey: string;
  seq: number;
}

export interface ProviderCliInstallSnapshot {
  /** Every job seen this session, newest last; bounded (see MAX_RECORDS). */
  records: ReadonlyMap<string, ProviderCliInstallRecord>;
  runningJobKey: string | null;
  /** The latest "View log" request, or null before the first. */
  logRequest: ProviderCliInstallLogRequest | null;
}

export interface ProviderCliInstallRunner {
  (job: ProviderCliInstallJob): Promise<ProviderCliInstallOutcome>;
}

export interface ProviderCliInstallStoreOptions {
  run: ProviderCliInstallRunner;
  /** Called once per finished job (toasts, query invalidation). */
  onFinished?: (
    record: ProviderCliInstallRecord,
    job: ProviderCliInstallJob,
  ) => void;
  now?: () => number;
}

export interface ProviderCliInstallStore {
  getSnapshot(): ProviderCliInstallSnapshot;
  subscribe(listener: () => void): () => void;
  start(job: ProviderCliInstallJob): void;
  /** Ask the mounted log host to show `jobKey`'s log. */
  openLog(jobKey: string): void;
  /** The last run for a (profile, host, provider) slot, if any. */
  recordFor(
    profileId: string,
    hostId: string,
    provider: ProviderCliKey,
  ): ProviderCliInstallRecord | null;
}

const PROVIDER_CLI_INSTALL_MAX_RECORDS = 32;

export function providerCliInstallJobKey(
  profileId: string,
  hostId: string,
  provider: ProviderCliKey,
): string {
  return `${profileId}:${hostId}:${provider}`;
}

export function createProviderCliInstallStore(
  options: ProviderCliInstallStoreOptions,
): ProviderCliInstallStore {
  const now = options.now ?? (() => Date.now());
  const listeners = new Set<() => void>();
  const queue: ProviderCliInstallJob[] = [];
  let snapshot: ProviderCliInstallSnapshot = {
    records: new Map(),
    runningJobKey: null,
    logRequest: null,
  };

  function emit(next: Partial<ProviderCliInstallSnapshot>): void {
    snapshot = { ...snapshot, ...next };
    for (const listener of listeners) listener();
  }

  function putRecord(record: ProviderCliInstallRecord): void {
    const records = new Map(snapshot.records);
    // Re-insert so eviction stays least-recent.
    records.delete(record.jobKey);
    records.set(record.jobKey, record);
    while (records.size > PROVIDER_CLI_INSTALL_MAX_RECORDS) {
      const oldest = records.keys().next();
      if (oldest.done) break;
      // Never evict the running job or a queued one.
      const candidate = records.get(oldest.value);
      if (
        candidate &&
        (candidate.status === "running" || candidate.status === "queued")
      ) {
        break;
      }
      records.delete(oldest.value);
    }
    emit({ records });
  }

  function jobKeyOf(job: ProviderCliInstallJob): string {
    return providerCliInstallJobKey(
      job.profileId,
      job.hostId,
      job.issue.provider,
    );
  }

  function baseRecord(
    job: ProviderCliInstallJob,
    status: ProviderCliInstallJobStatus,
  ): ProviderCliInstallRecord {
    return {
      jobKey: jobKeyOf(job),
      profileId: job.profileId,
      hostId: job.hostId,
      provider: job.issue.provider,
      displayName: job.issue.status.displayName,
      actionKind: job.issue.action.kind,
      issueFingerprint: job.issue.fingerprint,
      status,
      log: "",
      message: null,
      startedAt: null,
      finishedAt: null,
    };
  }

  function runJob(job: ProviderCliInstallJob): void {
    const jobKey = jobKeyOf(job);
    putRecord({ ...baseRecord(job, "running"), startedAt: now() });
    emit({ runningJobKey: jobKey });
    options
      .run(job)
      .then(
        (outcome): ProviderCliInstallRecord => ({
          ...baseRecord(job, outcome.success ? "succeeded" : "failed"),
          log: outcome.log,
          message: outcome.failureMessage,
          startedAt: snapshot.records.get(jobKey)?.startedAt ?? null,
          finishedAt: now(),
        }),
        (error: unknown): ProviderCliInstallRecord => {
          const message =
            error instanceof Error ? error.message : String(error);
          return {
            ...baseRecord(job, "failed"),
            log: `${snapshot.records.get(jobKey)?.log ?? ""}\n${message}\n`,
            message,
            startedAt: snapshot.records.get(jobKey)?.startedAt ?? null,
            finishedAt: now(),
          };
        },
      )
      .then((record) => {
        putRecord(record);
        if (snapshot.runningJobKey === jobKey) emit({ runningJobKey: null });
        options.onFinished?.(record, job);
        processNext();
      });
  }

  function processNext(): void {
    if (snapshot.runningJobKey !== null) return;
    const next = queue.shift();
    if (next === undefined) return;
    runJob(next);
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start(job) {
      const jobKey = jobKeyOf(job);
      const existing = snapshot.records.get(jobKey);
      if (
        existing &&
        (existing.status === "running" || existing.status === "queued")
      ) {
        return;
      }
      if (snapshot.runningJobKey !== null) {
        queue.push(job);
        putRecord(baseRecord(job, "queued"));
        return;
      }
      runJob(job);
    },
    openLog(jobKey) {
      emit({
        logRequest: { jobKey, seq: (snapshot.logRequest?.seq ?? 0) + 1 },
      });
    },
    recordFor(profileId, hostId, provider) {
      return (
        snapshot.records.get(
          providerCliInstallJobKey(profileId, hostId, provider),
        ) ?? null
      );
    },
  };
}
