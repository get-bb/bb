import { jsonBody, type OperationBody } from "@bb/operations";
import {
  publicApiRoutes,
  type InstalledPlugin,
  type PluginInstallJob,
} from "@bb/server-contract";
import { JsonBodyApiError } from "../errors.js";
import type { OperationRoutes } from "../kernel/http-door.js";
import type { PluginInstallJobs } from "../services/plugins/plugin-install-jobs.js";

export function prefersRespondAsync(request: Request | null): boolean {
  return (request?.headers.get("prefer") ?? "")
    .split(",")
    .some(
      (preference) =>
        preference.split(";")[0]?.trim().toLowerCase() === "respond-async",
    );
}

export async function respondWithInstallJob(
  request: Request | null,
  installJobs: PluginInstallJobs,
  job: PluginInstallJob,
  failure: (error: string) => Record<string, unknown>,
): Promise<OperationBody | { ok: true; plugin: InstalledPlugin }> {
  if (prefersRespondAsync(request)) {
    return jsonBody({ ok: true as const, job }, { status: 202 });
  }
  const settled = (await installJobs.settled(job.id)) ?? job;
  if (settled.state === "succeeded") {
    return { ok: true as const, plugin: settled.plugin };
  }
  throw new JsonBodyApiError(
    422,
    failure(settled.state === "failed" ? settled.error : "install cancelled"),
  );
}

export function registerPluginInstallJobRoutes(
  routes: OperationRoutes,
  installJobs: PluginInstallJobs,
): void {
  const contract = publicApiRoutes.plugins;
  const unknownJob = () =>
    new JsonBodyApiError(404, {
      error: "unknown install job; the server may have restarted",
    });

  routes.implement(contract.installJobs, () => ({ jobs: installJobs.list() }));

  routes.implement(contract.installJob, ({ jobId }) => {
    const job = installJobs.get(jobId);
    if (job === undefined) throw unknownJob();
    return { job };
  });

  routes.implement(contract.cancelInstallJob, ({ jobId }) => {
    const job = installJobs.cancel(jobId);
    if (job === undefined) throw unknownJob();
    return { job };
  });
}
