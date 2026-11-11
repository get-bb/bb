import { publicApiRoutes } from "@bb/server-contract";
import { JsonBodyApiError } from "../errors.js";
import type { OperationRoutes } from "../kernel/http-door.js";
import type { PluginUpdateJobs } from "../services/plugins/plugin-update-jobs.js";

export function registerPluginUpdateJobRoutes(
  routes: OperationRoutes,
  jobs: PluginUpdateJobs,
): void {
  const contract = publicApiRoutes.plugins;
  routes.implement(contract.updateJobs, () => ({ jobs: jobs.list() }));
  routes.implement(contract.updateJob, ({ jobId }) => {
    const job = jobs.get(jobId);
    if (job === undefined) {
      throw new JsonBodyApiError(404, {
        error: "unknown update job; the server may have restarted",
      });
    }
    return { job };
  });
}
