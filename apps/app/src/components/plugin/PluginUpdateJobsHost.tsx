import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePluginUpdateJobs } from "@/hooks/queries/plugin-update-job-queries";
import {
  invalidatePluginList,
  invalidatePluginCatalogSearch,
} from "@/hooks/cache-owners/plugin-cache-owner";
import {
  isWatchedPluginUpdate,
  trackPluginUpdate,
} from "@/lib/plugin-update-tracking";
import { appToast } from "@/components/ui/app-toast";
import { pluginNotificationDescription } from "./PluginNotificationDescription";

const PHASE_LABELS = {
  preparing: "Preparing the update…",
  activating: "Starting the new version…",
  checking: "Watching for startup errors. This takes about 30 seconds.",
  "rolling-back": "Restoring the previous version and its data…",
};

export function PluginUpdateJobsHost() {
  const queryClient = useQueryClient();
  const { data: jobs } = usePluginUpdateJobs();
  const seen = useRef(new Map<string, string>());
  useEffect(() => {
    for (const job of jobs ?? []) {
      const state = job.state === "running" ? job.phase : job.state;
      const previous = seen.current.get(job.id);
      if (previous === state) continue;
      seen.current.set(job.id, state);
      const id = `plugin-update:${job.id}`;
      const plugin = { id: job.pluginId, name: job.displayName };
      if (job.state === "queued" || job.state === "running") {
        trackPluginUpdate(job.id, true);
        appToast.loading(`Updating ${job.displayName}`, {
          id,
          description: pluginNotificationDescription(
            plugin,
            "installed",
            job.state === "queued"
              ? "Waiting for the current update to finish."
              : PHASE_LABELS[job.phase],
          ),
        });
        continue;
      }
      if (previous === undefined && !isWatchedPluginUpdate(job.id)) continue;
      trackPluginUpdate(job.id, false);
      void invalidatePluginList({ queryClient });
      invalidatePluginCatalogSearch({ queryClient });
      if (job.state === "failed") {
        appToast.error("Plugin update failed", {
          id,
          description: pluginNotificationDescription(
            plugin,
            "installed",
            job.error,
          ),
        });
      } else if (job.result.outcome === "rolled-back") {
        appToast.error("Plugin update rolled back", {
          id,
          description: pluginNotificationDescription(
            plugin,
            "installed",
            job.result.detail ??
              "The previous version and its data were restored.",
          ),
        });
      } else {
        appToast.success(
          job.result.applied ? "Plugin updated" : "Plugin is up to date",
          {
            id,
            description: pluginNotificationDescription(plugin, "installed"),
          },
        );
      }
    }
  }, [jobs, queryClient]);
  return null;
}
