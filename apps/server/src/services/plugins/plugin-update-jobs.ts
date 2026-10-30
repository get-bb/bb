import { randomUUID } from "node:crypto";
import type {
  PluginApplyUpdateResult,
  PluginRollbackResult,
  PluginUpdateJob,
} from "@bb/server-contract";
import { withPluginUpdateProgress } from "./plugin-update-progress.js";

type CompletedPluginUpdateJob = Extract<
  PluginUpdateJob,
  { state: "completed" }
>;

interface JobEntry {
  job: PluginUpdateJob;
  expectedVersion: string | null;
  complete: () => Promise<CompletedPluginUpdateJob>;
  finishedAt: number | null;
  settled: Promise<PluginUpdateJob>;
  settle: (job: PluginUpdateJob) => void;
}

type PluginUpdateJobStart = {
  pluginId: string;
  displayName: string;
  expectedVersion: string | null;
} & (
  | { kind: "update"; run: () => Promise<PluginApplyUpdateResult> }
  | { kind: "rollback"; run: () => Promise<PluginRollbackResult> }
);

export interface PluginUpdateJobs {
  start(args: PluginUpdateJobStart): PluginUpdateJob;
  settled(id: string): Promise<PluginUpdateJob> | undefined;
  get(id: string): PluginUpdateJob | undefined;
  list(): PluginUpdateJob[];
}

export function createPluginUpdateJobs(deps: {
  notifyChanged: () => void;
  now?: () => number;
}): PluginUpdateJobs {
  const now = deps.now ?? Date.now;
  const entries = new Map<string, JobEntry>();
  let running = false;

  function pruneFinished(): void {
    for (const [id, entry] of entries) {
      if (
        entry.finishedAt !== null &&
        entry.finishedAt <= now() - 10 * 60_000
      ) {
        entries.delete(id);
      }
    }
  }

  function update(entry: JobEntry, job: PluginUpdateJob): void {
    entry.job = job;
    if (job.state === "completed" || job.state === "failed") {
      entry.finishedAt = now();
      entry.settle(job);
    }
    deps.notifyChanged();
  }

  function pump(): void {
    if (running) return;
    const entry = [...entries.values()].find(
      (entry) => entry.job.state === "queued",
    );
    if (entry === undefined) return;
    running = true;
    const { id, pluginId, displayName, kind } = entry.job;
    const base = { id, pluginId, displayName, kind };
    update(entry, { ...base, state: "running", phase: "preparing" });
    void withPluginUpdateProgress(
      (phase) => update(entry, { ...base, state: "running", phase }),
      entry.complete,
    )
      .then(
        (completed) => update(entry, completed),
        (error: unknown) =>
          update(entry, {
            ...base,
            state: "failed",
            error: error instanceof Error ? error.message : String(error),
          }),
      )
      .finally(() => {
        running = false;
        pump();
      });
  }

  return {
    start(args) {
      const { pluginId, displayName, kind, expectedVersion } = args;
      pruneFinished();
      const duplicate = [...entries.values()].find(
        (entry) =>
          entry.job.pluginId === pluginId &&
          entry.job.kind === kind &&
          entry.expectedVersion === expectedVersion &&
          (entry.job.state === "queued" || entry.job.state === "running"),
      );
      if (duplicate !== undefined) return duplicate.job;
      let settle: (job: PluginUpdateJob) => void = () => {};
      const settled = new Promise<PluginUpdateJob>((resolve) => {
        settle = resolve;
      });
      const base = { id: randomUUID(), pluginId, displayName };
      const entry: JobEntry = {
        job: { ...base, kind, state: "queued" },
        expectedVersion,
        complete:
          args.kind === "update"
            ? async () => ({
                ...base,
                kind: "update",
                state: "completed",
                result: await args.run(),
              })
            : async () => ({
                ...base,
                kind: "rollback",
                state: "completed",
                result: await args.run(),
              }),
        finishedAt: null,
        settled,
        settle,
      };
      entries.set(entry.job.id, entry);
      deps.notifyChanged();
      pump();
      return entry.job;
    },
    settled: (id) => entries.get(id)?.settled,
    get(id) {
      pruneFinished();
      return entries.get(id)?.job;
    },
    list() {
      pruneFinished();
      return [...entries.values()].map((entry) => entry.job);
    },
  };
}
