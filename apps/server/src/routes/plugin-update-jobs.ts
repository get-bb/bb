import type { Context, Hono } from "hono";
import type { PluginUpdateJob } from "@bb/server-contract";
import type { PluginUpdateJobs } from "../services/plugins/plugin-update-jobs.js";
import { prefersRespondAsync } from "./plugin-install-jobs.js";

export async function respondWithUpdateJob(
  context: Context,
  jobs: PluginUpdateJobs,
  job: PluginUpdateJob,
): Promise<Response> {
  if (prefersRespondAsync(context)) return context.json({ job }, 202);
  const settled = (await jobs.settled(job.id)) ?? job;
  return settled.state === "completed"
    ? context.json(settled.result)
    : context.json(
        {
          error:
            settled.state === "failed"
              ? settled.error
              : `${job.kind} did not complete`,
        },
        422,
      );
}

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
