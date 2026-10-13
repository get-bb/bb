import type { Hono } from "hono";
import type { PluginUpdateJobs } from "../services/plugins/plugin-update-jobs.js";

export function registerPluginUpdateJobRoutes(
  app: Hono,
  jobs: PluginUpdateJobs,
): void {
  app.get("/plugins/update-jobs", (context) =>
    context.json({ jobs: jobs.list() }),
  );
  app.get("/plugins/update-jobs/:jobId", (context) => {
    const job = jobs.get(context.req.param("jobId"));
    if (job === undefined) {
      return context.json(
        { error: "unknown update job; the server may have restarted" },
        404,
      );
    }
    return context.json({ job });
  });
}
