import { randomUUID } from "node:crypto";
import type {
  InstalledPlugin,
  PluginInstallJob,
  PluginInstallJobTarget,
} from "@bb/server-contract";
import { runCancellableInstall } from "./install-cancellation.js";

const FINISHED_JOB_RETENTION_MS = 10 * 60_000;

type ActiveState = "queued" | "running" | "cancelling";

interface JobEntry {
  job: PluginInstallJob;
  key: string;
  run: () => Promise<InstalledPlugin>;
  controller: AbortController;
  finishedAt: number | null;
  settled: Promise<PluginInstallJob>;
  settle: (job: PluginInstallJob) => void;
}

export interface PluginInstallJobs {
  start(args: {
    target: PluginInstallJobTarget;
    displayName: string;
    run: () => Promise<InstalledPlugin>;
  }): PluginInstallJob;
  settled(id: string): Promise<PluginInstallJob> | undefined;
  get(id: string): PluginInstallJob | undefined;
  list(): PluginInstallJob[];
  cancel(id: string): PluginInstallJob | undefined;
}

function targetKey(target: PluginInstallJobTarget): string {
  return target.kind === "catalog"
    ? `catalog:${target.marketplace}/${target.entryId}`
    : `source:${target.source}:${JSON.stringify(target.selection)}`;
}

function isActive(
  job: PluginInstallJob,
): job is Extract<PluginInstallJob, { state: ActiveState }> {
  return (
    job.state === "queued" ||
    job.state === "running" ||
    job.state === "cancelling"
  );
}

export function createPluginInstallJobs(deps: {
  notifyChanged: () => void;
  now?: () => number;
}): PluginInstallJobs {
  const now = deps.now ?? Date.now;
  const entries = new Map<string, JobEntry>();
  let current: JobEntry | null = null;

  function pruneFinished(): void {
    const cutoff = now() - FINISHED_JOB_RETENTION_MS;
    for (const [id, entry] of entries) {
      if (entry.finishedAt !== null && entry.finishedAt <= cutoff) {
        entries.delete(id);
      }
    }
  }

  function update(entry: JobEntry, job: PluginInstallJob): void {
    entry.job = job;
    if (!isActive(job)) {
      entry.finishedAt = now();
      entry.settle(job);
    }
    deps.notifyChanged();
  }

  function pump(): void {
    if (current !== null) return;
    const next = [...entries.values()].find(
      (entry) => entry.job.state === "queued",
    );
    if (next === undefined) return;
    current = next;
    const base = {
      id: next.job.id,
      target: next.job.target,
      displayName: next.job.displayName,
    };
    update(next, { ...base, state: "running" });
    void runCancellableInstall(next.controller.signal, next.run)
      .then(
        (plugin) => update(next, { ...base, state: "succeeded", plugin }),
        (error: unknown) =>
          update(
            next,
            next.controller.signal.aborted
              ? { ...base, state: "cancelled" }
              : {
                  ...base,
                  state: "failed",
                  error: error instanceof Error ? error.message : String(error),
                },
          ),
      )
      .finally(() => {
        current = null;
        pump();
      });
  }

  return {
    start({ target, displayName, run }) {
      pruneFinished();
      const key = targetKey(target);
      const duplicate = [...entries.values()].find(
        (entry) => entry.key === key && isActive(entry.job),
      );
      if (duplicate !== undefined) return duplicate.job;
      let settle: (job: PluginInstallJob) => void = () => {};
      const settled = new Promise<PluginInstallJob>((resolve) => {
        settle = resolve;
      });
      const entry: JobEntry = {
        job: { id: randomUUID(), target, displayName, state: "queued" },
        key,
        run,
        controller: new AbortController(),
        finishedAt: null,
        settled,
        settle,
      };
      entries.set(entry.job.id, entry);
      deps.notifyChanged();
      pump();
      return entry.job;
    },
    settled(id) {
      return entries.get(id)?.settled;
    },
    get(id) {
      pruneFinished();
      return entries.get(id)?.job;
    },
    list() {
      pruneFinished();
      return [...entries.values()].map((entry) => entry.job);
    },
    cancel(id) {
      const entry = entries.get(id);
      if (entry === undefined) return undefined;
      const { job } = entry;
      if (job.state === "queued") {
        entry.controller.abort();
        update(entry, {
          id: job.id,
          target: job.target,
          displayName: job.displayName,
          state: "cancelled",
        });
      } else if (job.state === "running") {
        entry.controller.abort();
        update(entry, { ...job, state: "cancelling" });
      }
      return entry.job;
    },
  };
}
