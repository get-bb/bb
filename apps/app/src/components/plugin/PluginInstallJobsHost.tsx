import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  PluginInstallJob,
  PluginInstallJobState,
} from "@bb/server-contract";
import { appToast } from "@/components/ui/app-toast";
import { pluginNotificationDescription } from "@/components/plugin/PluginNotificationDescription";
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

function failureDescription(
  job: Extract<PluginInstallJob, { state: "failed" }>,
) {
  return job.target.kind === "catalog"
    ? pluginNotificationDescription(
        { id: job.target.entryId, name: job.displayName },
        "catalog",
        job.error,
      )
    : job.error;
}

function progressTitle(job: ActivePluginInstallJob): string {
  switch (job.state) {
    case "queued":
      return `${job.displayName} is waiting to install`;
    case "running":
      return `Installing ${job.displayName}`;
    case "cancelling":
      return `Cancelling ${job.displayName}`;
  }
}

export function PluginInstallJobsHost() {
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
          description:
            job.state === "queued"
              ? "It starts when the current install finishes."
              : undefined,
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
          description: pluginNotificationDescription(job.plugin, "installed"),
        });
      } else if (job.state === "failed") {
        appToast.error("Plugin installation failed", {
          id,
          description: failureDescription(job),
        });
      } else {
        appToast.message("Plugin install cancelled", {
          id,
          description: job.displayName,
        });
      }
    }
  }, [cancelJob, jobs, queryClient]);

  return null;
}
