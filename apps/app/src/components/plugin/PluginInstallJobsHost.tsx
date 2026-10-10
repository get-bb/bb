import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  PluginInstallJob,
  PluginInstallJobState,
} from "@bb/server-contract";
import { appToast } from "@/components/ui/app-toast";
import { usePluginNotificationAction } from "@/components/plugin/PluginNotificationDescription";
import {
  applyInstalledPlugin,
  invalidatePluginCatalogSearch,
  invalidatePluginList,
} from "@/hooks/cache-owners/plugin-cache-owner";
import {
  isActivePluginInstallJob,
  useCancelPluginInstallJob,
  usePluginInstallJobs,
  type ActivePluginInstallJob,
} from "@/hooks/queries/plugin-install-job-queries";

function toastId(job: PluginInstallJob): string {
  return `plugin-install:${job.id}`;
}

function progressTitle(job: ActivePluginInstallJob): string {
  switch (job.state) {
    case "queued":
      return "Plugin installation queued";
    case "running":
      return "Installing plugin…";
    case "cancelling":
      return "Cancelling installation…";
  }
}

export function PluginInstallJobsHost() {
  const action = usePluginNotificationAction();
  const queryClient = useQueryClient();
  const { data: jobs } = usePluginInstallJobs();
  const { mutate: cancelJob } = useCancelPluginInstallJob();
  const seenStates = useRef(new Map<string, PluginInstallJobState>());

  useEffect(() => {
    if (jobs === undefined) return;
    for (const job of jobs) {
      const previous = seenStates.current.get(job.id);
      seenStates.current.set(job.id, job.state);
      if (previous === job.state) continue;
      const id = toastId(job);
      if (isActivePluginInstallJob(job)) {
        appToast.loading(progressTitle(job), {
          id,
          description: job.displayName,
          ...(job.state === "cancelling"
            ? {}
            : {
                action: {
                  label: "Cancel",
                  onClick: (event) => {
                    event.preventDefault();
                    cancelJob(job.id);
                  },
                },
              }),
        });
        continue;
      }
      if (previous === undefined) continue;
      if (job.state === "succeeded") {
        applyInstalledPlugin({ queryClient, plugin: job.plugin });
        void invalidatePluginList({ queryClient });
        invalidatePluginCatalogSearch({ queryClient });
        appToast.success("Plugin installed", {
          id,
          description: job.plugin.name ?? job.plugin.id,
          action: action(job.plugin.id, "app"),
        });
      } else if (job.state === "failed") {
        appToast.error("Plugin installation failed", {
          id,
          description: `${job.displayName} — ${job.error}`,
          ...(job.target.kind === "catalog"
            ? { action: action(job.target.entryId, "catalog") }
            : {}),
        });
      } else {
        appToast.message("Plugin install cancelled", {
          id,
          description: job.displayName,
        });
      }
    }
  }, [cancelJob, jobs, queryClient, action]);

  return null;
}
