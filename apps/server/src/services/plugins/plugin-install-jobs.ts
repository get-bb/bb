import type {
  InstalledPlugin,
  PluginInstallJob,
  PluginInstallJobTarget,
} from "@bb/server-contract";
import { createJobRegistry } from "../lib/job-registry.js";
import { runCancellableInstall } from "./install-cancellation.js";

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

function jobBase({ id, target, displayName }: PluginInstallJob) {
  return { id, target, displayName };
}

export function createPluginInstallJobs(deps: {
  notifyChanged: () => void;
  now?: () => number;
}): PluginInstallJobs {
  const jobs = createJobRegistry<PluginInstallJob>({
    isActive: (job) =>
      job.state === "queued" ||
      job.state === "running" ||
      job.state === "cancelling",
    fail: (job, error, signal) =>
      signal.aborted
        ? { ...jobBase(job), state: "cancelled" }
        : {
            ...jobBase(job),
            state: "failed",
            error: error instanceof Error ? error.message : String(error),
          },
    notifyChanged: deps.notifyChanged,
    now: deps.now,
  });
  return {
    start: ({ target, displayName, run }) =>
      jobs.start({
        key: targetKey(target),
        lane: "plugin-install",
        create: (id) => ({ id, target, displayName, state: "queued" }),
        run: async ({ job, set, signal }) => {
          set({ ...jobBase(job), state: "running" });
          const plugin = await runCancellableInstall(signal, run);
          return { ...jobBase(job), state: "succeeded", plugin };
        },
      }),
    settled: (id) => jobs.settled(id)?.then((outcome) => outcome.job),
    get: (id) => jobs.get(id),
    list: () => jobs.list(),
    cancel: (id) =>
      jobs.cancel(id, {
        queued: (job) => ({ ...jobBase(job), state: "cancelled" }),
        running: (job) =>
          job.state === "running" ? { ...job, state: "cancelling" } : job,
      }),
  };
}
