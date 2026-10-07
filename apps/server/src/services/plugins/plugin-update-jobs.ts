import { randomUUID } from "node:crypto";
import type {
  PluginApplyUpdateResult,
  PluginUpdateJob,
} from "@bb/server-contract";
import { withPluginUpdateProgress } from "./plugin-update-progress.js";

interface JobEntry {
  job: PluginUpdateJob;
  run: () => Promise<PluginApplyUpdateResult>;
  finishedAt: number | null;
  settled: Promise<PluginUpdateJob>;
  settle: (job: PluginUpdateJob) => void;
}

export interface PluginUpdateJobs {
  start(args: {
    pluginId: string;
    displayName: string;
    run: () => Promise<PluginApplyUpdateResult>;
  }): PluginUpdateJob;
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
    const { id, pluginId, displayName } = entry.job;
    const base = { id, pluginId, displayName };
    update(entry, { ...base, state: "running", phase: "preparing" });
    void withPluginUpdateProgress(
      (phase) => update(entry, { ...base, state: "running", phase }),
      async () => entry.run(),
    )
      .then(
        (result) => update(entry, { ...base, state: "completed", result }),
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
    start({ pluginId, displayName, run }) {
      pruneFinished();
      const duplicate = [...entries.values()].find(
        (entry) =>
          entry.job.pluginId === pluginId &&
          (entry.job.state === "queued" || entry.job.state === "running"),
      );
      if (duplicate !== undefined) return duplicate.job;
      let settle: (job: PluginUpdateJob) => void = () => {};
      const settled = new Promise<PluginUpdateJob>((resolve) => {
        settle = resolve;
      });
      const entry: JobEntry = {
        job: { id: randomUUID(), pluginId, displayName, state: "queued" },
        run,
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
