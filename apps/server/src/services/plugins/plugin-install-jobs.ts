import { randomUUID } from "node:crypto";
import type { InstalledPlugin, PluginInstallJob } from "@bb/server-contract";

const FINISHED_JOB_RETENTION_MS = 10 * 60_000;

interface JobEntry {
  job: PluginInstallJob;
  finishedAt: number | null;
}

export interface PluginInstallJobs {
  start(run: () => Promise<InstalledPlugin>): PluginInstallJob;
  get(id: string): PluginInstallJob | undefined;
}

function finish(entry: JobEntry, job: PluginInstallJob): void {
  entry.job = job;
  entry.finishedAt = Date.now();
}

export function createPluginInstallJobs(): PluginInstallJobs {
  const entries = new Map<string, JobEntry>();

  function pruneFinished(): void {
    const cutoff = Date.now() - FINISHED_JOB_RETENTION_MS;
    for (const [id, entry] of entries) {
      if (entry.finishedAt !== null && entry.finishedAt <= cutoff) {
        entries.delete(id);
      }
    }
  }

  return {
    start(run) {
      pruneFinished();
      const id = randomUUID();
      const entry: JobEntry = {
        job: { id, state: "running" },
        finishedAt: null,
      };
      entries.set(id, entry);
      void run().then(
        (plugin) => finish(entry, { id, state: "succeeded", plugin }),
        (error: unknown) =>
          finish(entry, {
            id,
            state: "failed",
            error: error instanceof Error ? error.message : String(error),
          }),
      );
      return entry.job;
    },
    get(id) {
      return entries.get(id)?.job;
    },
  };
}
