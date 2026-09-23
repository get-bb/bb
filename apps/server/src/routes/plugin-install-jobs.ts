import type { Hono } from "hono";
import type { PluginInstallJobs } from "../services/plugins/plugin-install-jobs.js";

export function registerPluginInstallJobRoutes(
  app: Hono,
  installJobs: PluginInstallJobs,
): void {
  app.get("/plugins/install-jobs/:jobId", (context) => {
    const job = installJobs.get(context.req.param("jobId"));
    if (job === undefined) {
      return context.json(
        {
          ok: false,
          error: "unknown install job; the server may have restarted",
        },
        404,
      );
    }
    return context.json({ ok: true, job });
  });
}
