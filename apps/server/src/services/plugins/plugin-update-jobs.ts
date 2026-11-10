import type {
  PluginApplyUpdateResult,
  PluginUpdateJob,
} from "@bb/server-contract";
import { createJobRegistry } from "../lib/job-registry.js";
import { withPluginUpdateProgress } from "./plugin-update-progress.js";

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
  const jobs = createJobRegistry<PluginUpdateJob>({
    isActive: (job) => job.state === "queued" || job.state === "running",
    fail: ({ id, pluginId, displayName }, error) => ({
      id,
      pluginId,
      displayName,
      state: "failed",
      error: error instanceof Error ? error.message : String(error),
    }),
    notifyChanged: deps.notifyChanged,
    now: deps.now,
  });
  return {
    start: ({ pluginId, displayName, run }) =>
      jobs.start({
        key: pluginId,
        lane: "plugin-update",
        create: (id) => ({ id, pluginId, displayName, state: "queued" }),
        run: async ({ job, set }) => {
          const base = { id: job.id, pluginId, displayName };
          set({ ...base, state: "running", phase: "preparing" });
          const result = await withPluginUpdateProgress(
            (phase) => set({ ...base, state: "running", phase }),
            run,
          );
          return { ...base, state: "completed", result };
        },
      }),
    settled: (id) => jobs.settled(id)?.then((outcome) => outcome.job),
    get: (id) => jobs.get(id),
    list: () => jobs.list(),
  };
}
