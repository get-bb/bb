import type { Context, Hono } from "hono";
import type { PluginInstallJob } from "@bb/server-contract";
import type { PluginInstallJobs } from "../services/plugins/plugin-install-jobs.js";

export function prefersRespondAsync(context: Context): boolean {
  return (context.req.header("prefer") ?? "")
    .split(",")
    .some(
      (preference) =>
        preference.split(";")[0]?.trim().toLowerCase() === "respond-async",
    );
}

export async function respondWithInstallJob(
  context: Context,
  installJobs: PluginInstallJobs,
  job: PluginInstallJob,
  failure: (error: string) => Record<string, unknown>,
): Promise<Response> {
  if (prefersRespondAsync(context)) {
    return context.json({ ok: true as const, job }, 202);
  }
  const settled = (await installJobs.settled(job.id)) ?? job;
  if (settled.state === "succeeded") {
    return context.json({ ok: true as const, plugin: settled.plugin });
  }
  return context.json(
    failure(settled.state === "failed" ? settled.error : "install cancelled"),
    422,
  );
}

export function registerPluginInstallJobRoutes(
  app: Hono,
  installJobs: PluginInstallJobs,
): void {
  app.get("/plugins/install-jobs", (context) =>
    context.json({ jobs: installJobs.list() }),
  );

  app.get("/plugins/install-jobs/:jobId", (context) => {
    const job = installJobs.get(context.req.param("jobId"));
    if (job === undefined) {
      return context.json(
        { error: "unknown install job; the server may have restarted" },
        404,
      );
    }
    return context.json({ job });
  });

  app.post("/plugins/install-jobs/:jobId/cancel", (context) => {
    const job = installJobs.cancel(context.req.param("jobId"));
    if (job === undefined) {
      return context.json(
        { error: "unknown install job; the server may have restarted" },
        404,
      );
    }
    return context.json({ job });
  });
}
