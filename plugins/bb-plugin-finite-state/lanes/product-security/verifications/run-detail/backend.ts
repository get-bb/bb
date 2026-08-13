import type { BbPluginApi } from "@bb/plugin-sdk";
import type Database from "better-sqlite3";
import type { PluginContext } from "../../../../lib/context.js";
import type { RemoteServices } from "../../../../lib/remote/types.js";
import { toStorageProjectVersionId } from "../../../../lib/store/index.js";
import { RemoteLimiter, systemScheduler } from "../../../../lib/remote/rate-limit.js";
import { registeredPusher } from "../../../sync/engine/adapter.js";
import { createAssuranceStudioPusher, registerTypedPusher } from "../../../sync/push/pushers.js";
import { rpcContract } from "../../../../shared/contract.js";
import { isVerificationTier } from "../matrix/status.js";
import { manualAttestationUnavailable, runVerification } from "./actions.js";
import { SAFE_ARTIFACT_NAME, SAFE_SURFACE_ID, parseByteRange, verificationRunDetailRpcContract } from "./logs.js";
import { queryResultHistory, queryRunDetail } from "./query.js";
import { withProductSecurityHeadFence } from "../../sync/pusher.js";

const frozenContract = {
  verificationsRunGet: rpcContract.verificationsRunGet,
  verificationsRunStart: rpcContract.verificationsRunStart,
  verificationsManualAttestationRecord: rpcContract.verificationsManualAttestationRecord,
} as const;

function detailIdentity(runId: string): { requirementId: string; tier: "static" | "emulation" | "hil" | "manual" | "hardware" } {
  const parts = runId.split(":");
  const tier = parts.at(-1);
  if (parts.length >= 2 && tier && isVerificationTier(tier)) {
    return { requirementId: parts.slice(0, -1).join(":"), tier };
  }
  throw new Error("VERIFICATION_DETAIL_ID_INVALID");
}

function jsonError(message: string, status: number): Response {
  return Response.json({ error: { code: "VERIFICATION_STREAM_UNAVAILABLE", message } }, { status, headers: { "Cache-Control": "private, no-store" } });
}

interface LogRow { raw: string; log_locator: string | null }
interface JobStateRow { status: string }

export function observedJobState(
  db: Database.Database,
  input: { projectId: string; projectVersionId: string; jobId: string; invokedAt: string },
): "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "TIMEOUT" | null {
  const row = db.prepare<[string, string, string, string, string, string], JobStateRow>(
    `SELECT r.status
       FROM verification_runs r
       JOIN sync_state s
         ON s.project_id=r.project_id AND s.project_version_id=r.project_version_id
        AND s.entity_kind='verificationRun' AND s.accepted_generation_id=r.generation_id
      WHERE r.project_id=? AND r.project_version_id=?
        AND (r.job_id=? OR r.run_id=?)
        AND r.synced_at >= ? AND COALESCE(r.started_at, r.synced_at) >= ?
      ORDER BY r.synced_at DESC LIMIT 1`,
  ).get(input.projectId, toStorageProjectVersionId(input.projectVersionId), input.jobId, input.jobId, input.invokedAt, input.invokedAt);
  const state = row?.status.toUpperCase();
  return state === "QUEUED" || state === "RUNNING" || state === "COMPLETED" || state === "FAILED" || state === "TIMEOUT" ? state : null;
}

function cachedLog(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return "";
    const jobs = Reflect.get(parsed, "jobs");
    if (!Array.isArray(jobs)) return "";
    const lines: string[] = [];
    for (const job of jobs) {
      if (typeof job !== "object" || job === null || Array.isArray(job)) continue;
      const tail = Reflect.get(job, "logTail");
      if (Array.isArray(tail)) for (const line of tail) if (typeof line === "string") lines.push(line.slice(0, 20_000));
    }
    return lines.length ? `${lines.join("\n")}\n` : "";
  } catch { return ""; }
}

export function registerVerificationRunDetailBackend(
  bb: BbPluginApi,
  ctx: PluginContext,
): void {
  const db = ctx.db();
  const remote = () => ctx.service<RemoteServices>("remote-services", () => { throw new Error("REMOTE_SERVICES_NOT_REGISTERED"); });
  const lazyAssuranceStudio = {
    listEntities: (...args: Parameters<RemoteServices["assuranceStudio"]["listEntities"]>) => remote().assuranceStudio.listEntities(...args),
    getEntity: (...args: Parameters<RemoteServices["assuranceStudio"]["getEntity"]>) => remote().assuranceStudio.getEntity(...args),
    createEntity: (...args: Parameters<RemoteServices["assuranceStudio"]["createEntity"]>) => remote().assuranceStudio.createEntity(...args),
    updateEntity: (...args: Parameters<RemoteServices["assuranceStudio"]["updateEntity"]>) => remote().assuranceStudio.updateEntity(...args),
    deleteEntity: (...args: Parameters<RemoteServices["assuranceStudio"]["deleteEntity"]>) => remote().assuranceStudio.deleteEntity(...args),
  };
  const limiter = ctx.service("product-security.push-limiter", () => new RemoteLimiter({
    concurrency: 1, maxAttempts: 6, maxBackoffMs: 64_000, scheduler: systemScheduler, random: Math.random,
  }));
  bb.onDispose(() => limiter.close());
  for (const kind of ["asset", "component", "dataflow", "requirement", "threat", "zone"] as const) {
    if (registeredPusher(kind) === undefined) {
      registerTypedPusher(withProductSecurityHeadFence(db, createAssuranceStudioPusher({ db, client: lazyAssuranceStudio, limiter, kind, maxConcurrency: 1 })));
    }
  }
  bb.rpc.register({ ...frozenContract, ...verificationRunDetailRpcContract }, {
    verificationsRunGet(input) {
      const identity = detailIdentity(input.runId);
      return queryRunDetail(db, { projectId: input.projectId, projectVersionId: input.projectVersionId, ...identity });
    },
    async verificationsRunStart(input) {
      if (input.projectVersionId === null) throw new Error("VERIFICATION_PROJECT_VERSION_REQUIRED");
      const projectVersionId = input.projectVersionId;
      let last: { jobId: string; state: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "TIMEOUT"; progress?: number } | null = null;
      for await (const job of runVerification({
        projectId: input.projectId,
        client: remote().assuranceStudio,
        publish(job) { bb.realtime.publish("verifications:changed", { projectId: input.projectId, jobId: job.jobId, state: job.state }); },
        async readJob(jobId, invokedAt) {
          return observedJobState(db, { projectId: input.projectId, projectVersionId, jobId, invokedAt });
        },
        maxPolls: 20,
        pollIntervalMs: 250,
      }, { requirementId: input.requirementId, ...(input.tier ? { tier: input.tier } : {}), ...(input.checkId ? { checkId: input.checkId } : {}) })) last = job;
      if (!last) throw new Error("VERIFICATION_JOB_NOT_STARTED");
      return { projectId: input.projectId, projectVersionId: input.projectVersionId, id: last.jobId, state: last.state, progress: last.progress ?? null, message: "Five-second cache observation window finished; the detail now rereads accepted evidence without claiming backend cancellation." };
    },
    verificationsManualAttestationRecord() { return manualAttestationUnavailable(); },
    verificationResultHistoryList(input) { return queryResultHistory(db, input); },
  });

  bb.http.route("GET", "/product-security/verifications/log", (http) => {
    const projectId = http.req.query("projectId");
    const projectVersionId = http.req.query("projectVersionId");
    const runId = http.req.query("runId");
    if (!projectId || !projectVersionId || !runId || !SAFE_SURFACE_ID.test(projectId) || !SAFE_SURFACE_ID.test(projectVersionId) || !SAFE_SURFACE_ID.test(runId)) return jsonError("Valid projectId, projectVersionId, and runId are required.", 400);
    const rows = db.prepare<[string, string, string], LogRow>(`SELECT r.raw, r.log_locator FROM verification_runs r JOIN sync_state s ON s.project_id=r.project_id AND s.project_version_id=r.project_version_id AND s.entity_kind='requirement' AND s.accepted_generation_id=r.generation_id WHERE r.project_id=? AND r.project_version_id=? AND r.run_id=? LIMIT 2`).all(projectId, toStorageProjectVersionId(projectVersionId), runId);
    if (rows.length !== 1) return jsonError("Run log is unknown or ambiguous.", 404);
    const body = cachedLog(rows[0]!.raw);
    if (!body) return jsonError(rows[0]!.log_locator ? "The complete logical log has no approved byte adapter." : "No cached log is recorded.", 410);
    const bytes = new TextEncoder().encode(body);
    let range: { start: number; end: number } | null;
    try { range = parseByteRange(http.req.header("range"), bytes.byteLength); } catch { return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${bytes.byteLength}` } }); }
    const selected = range ? bytes.slice(range.start, range.end + 1) : bytes;
    const headers = new Headers({ "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename="${runId}.cached.log"`, "Accept-Ranges": "bytes", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
    if (range) headers.set("Content-Range", `bytes ${range.start}-${range.end}/${bytes.byteLength}`);
    return new Response(selected, { status: range ? 206 : 200, headers });
  }, { auth: "local" });

  bb.http.route("GET", "/product-security/verifications/artifact", (http) => {
    const projectId = http.req.query("projectId"); const projectVersionId = http.req.query("projectVersionId"); const runId = http.req.query("runId"); const artifactName = http.req.query("artifactName");
    if (!projectId || !projectVersionId || !runId || !artifactName || !SAFE_SURFACE_ID.test(projectId) || !SAFE_SURFACE_ID.test(projectVersionId) || !SAFE_SURFACE_ID.test(runId) || !SAFE_ARTIFACT_NAME.test(artifactName)) return jsonError("Valid confined artifact coordinates are required.", 400);
    const rows = db.prepare<[string, string, string, string], { name: string; locator: string }>(`SELECT a.name, a.locator FROM verification_artifacts a JOIN sync_state s ON s.project_id=a.project_id AND s.project_version_id=a.project_version_id AND s.entity_kind='requirement' AND s.accepted_generation_id=a.generation_id WHERE a.project_id=? AND a.project_version_id=? AND a.run_id=? AND a.name=? LIMIT 2`).all(projectId, toStorageProjectVersionId(projectVersionId), runId, artifactName);
    if (rows.length !== 1) return jsonError("Artifact metadata is unknown or ambiguous in this project version.", 404);
    return jsonError(`Artifact ${rows[0]!.name} has a confined logical locator, but no approved byte adapter is available.`, 410);
  }, { auth: "local" });
}
