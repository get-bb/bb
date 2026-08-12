import { unsupportedError } from "../errors.js";
import { RemoteLimiter, systemScheduler, type Scheduler } from "../rate-limit.js";
import {
  RemoteError,
  iterateRemotePages,
  normalizeForgeJobSnapshot,
  type ForgeComputeClient as ForgeComputeClientContract,
  type ForgeComputeInvocation,
  type ForgeJobCandidate,
  type ForgeJobSnapshot,
  type ForgeJobStatus,
  type ForgePenTestInput,
  type Json,
  type RemoteCallContext,
  type RemoteHealth,
} from "../types.js";
import type { ForgeComputeTransport } from "./mcp-transport.js";

export interface ForgeComputeClientOptions {
  transport: ForgeComputeTransport;
  concurrency?: number;
  limiter?: RemoteLimiter;
  scheduler?: Scheduler;
  remoteTransport: boolean;
  publishHint?(hint: { jobId: string; status: ForgeJobStatus; eventCount: number }): void;
}

const FORGE_LOCAL_PATH_FIELDS = new Set([
  "bundle_path",
  "firmware_path",
  "evidence_root",
  "registry",
  "log_path",
  "run_dir",
  "vendor_vex_path",
]);

function json(value: unknown): Json {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(json);
  if (typeof value === "object") {
    const output: Record<string, Json> = {};
    for (const [key, item] of Object.entries(value)) {
      if (FORGE_LOCAL_PATH_FIELDS.has(key.toLowerCase())) continue;
      output[key] = json(item);
    }
    return output;
  }
  throw new RemoteError("Forge returned a non-JSON value", {
    service: "forge-compute", code: "FORGE_INVALID_RESPONSE", status: null,
    retryable: false, retryAfterMs: null, details: null,
  });
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new RemoteError("Forge returned an invalid object", {
      service: "forge-compute", code: "FORGE_INVALID_RESPONSE", status: null,
      retryable: false, retryAfterMs: null, details: null,
    });
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, field: string, nullable = false): string | null {
  if (typeof value === "string") return value;
  if (nullable && value === null) return null;
  throw new RemoteError("Forge response field was invalid", {
    service: "forge-compute", code: "FORGE_INVALID_RESPONSE", status: null,
    retryable: false, retryAfterMs: null, details: { field },
  });
}

function integer(value: unknown, field: string): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  throw new RemoteError("Forge response field was invalid", {
    service: "forge-compute", code: "FORGE_INVALID_RESPONSE", status: null,
    retryable: false, retryAfterMs: null, details: { field },
  });
}

function status(value: unknown): ForgeJobCandidate["status"] {
  if (value === "RUNNING" || value === "COMPLETED" || value === "FAILED" || value === "TIMEOUT" || value === "CANCELLED") return value;
  throw new RemoteError("Forge returned an unknown job status", {
    service: "forge-compute", code: "FORGE_INVALID_JOB_STATUS", status: null,
    retryable: false, retryAfterMs: null, details: null,
  });
}

function snapshot(value: unknown): ForgeJobSnapshot {
  const item = object(value);
  if (item.success === false) throw new RemoteError("Forge job was not found", {
    service: "forge-compute", code: "FORGE_JOB_NOT_FOUND", status: 404,
    retryable: false, retryAfterMs: null, details: null,
  });
  const events = Array.isArray(item.events) ? item.events.map(json) : [];
  const candidate: ForgeJobCandidate = {
    jobId: string(item.job_id, "job_id") ?? "",
    status: status(item.status),
    tool: string(item.tool, "tool") ?? "",
    recipe: string(item.recipe, "recipe", true),
    scope: json(item.scope), environment: json(item.environment),
    runId: string(item.run_id, "run_id", true),
    elapsedSeconds: integer(item.elapsed_seconds, "elapsed_seconds"),
    logTail: typeof item.log_tail === "string" ? item.log_tail.split(/\r?\n/u).slice(-200) : [],
    events: events.slice(-500), eventCount: integer(item.event_count, "event_count"),
    result: item.result === undefined ? null : json(item.result),
    error: item.error && typeof item.error === "object" ? {
      code: typeof object(item.error).code === "string" ? object(item.error).code as string : "FORGE_JOB_FAILED",
      message: typeof object(item.error).message === "string" ? object(item.error).message as string : null,
    } : null,
  };
  return normalizeForgeJobSnapshot(candidate);
}

function listSnapshot(value: unknown): ForgeJobSnapshot {
  const item = object(value);
  return normalizeForgeJobSnapshot({
    jobId: string(item.job_id, "job_id") ?? "",
    status: status(item.status),
    tool: string(item.tool, "tool") ?? "",
    recipe: string(item.recipe, "recipe", true),
    scope: json(item.scope),
    environment: json(item.environment),
    runId: null,
    elapsedSeconds: integer(item.elapsed_seconds, "elapsed_seconds"),
    logTail: [],
    events: [],
    eventCount: 0,
    result: null,
    error: null,
  });
}

export class ForgeComputeClient implements ForgeComputeClientContract {
  readonly #transport: ForgeComputeTransport;
  readonly #limiter: RemoteLimiter;
  readonly #scheduler: Scheduler;
  readonly #remoteTransport: boolean;
  readonly #publishHint: NonNullable<ForgeComputeClientOptions["publishHint"]>;

  constructor(options: ForgeComputeClientOptions) {
    this.#transport = options.transport;
    this.#scheduler = options.scheduler ?? systemScheduler;
    this.#remoteTransport = options.remoteTransport;
    this.#publishHint = options.publishHint ?? (() => undefined);
    this.#limiter = options.limiter ?? new RemoteLimiter({
      concurrency: options.concurrency ?? 4, maxAttempts: 6, maxBackoffMs: 64_000,
      scheduler: this.#scheduler, random: Math.random,
    });
  }

  async close(): Promise<void> { this.#limiter.close(); await this.#transport.close(); }

  async #read<T>(operation: () => Promise<T>, ctx?: RemoteCallContext): Promise<T> {
    return await this.#limiter.run(operation, ctx?.signal, "forge-compute");
  }

  async health(ctx?: RemoteCallContext): Promise<RemoteHealth> {
    await this.#read(() => this.#transport.health(ctx?.signal), ctx);
    return { configured: true, reachable: true, detail: null };
  }

  async verifyDynamic(input: { projectVersionId: string; verdictIds: string[]; budgetSecPerVerdict?: number }, ctx?: RemoteCallContext): Promise<Json> {
    const value = await this.#read(() => this.#transport.verifyDynamic({
      pv_id: input.projectVersionId, verdict_ids: input.verdictIds,
      ...(input.budgetSecPerVerdict === undefined ? {} : { budget_sec_per_verdict: input.budgetSecPerVerdict }),
    }, ctx?.signal), ctx);
    return json(value);
  }

  async penTestRun(input: ForgePenTestInput, ctx?: RemoteCallContext): Promise<{ jobId: string }> {
    void input;
    void ctx;
    throw unsupportedError(
      "forge-compute",
      this.#remoteTransport
        ? "penTestRun.remoteFirmwareRoot"
        : "penTestRun.firmwarePathRequiredByManifest",
    );
  }

  async getJobStatus(jobId: string, tailLines = 50, ctx?: RemoteCallContext): Promise<ForgeJobSnapshot> {
    return snapshot(await this.#read(() => this.#transport.getJobStatus({ job_id: jobId, tail_lines: tailLines }, ctx?.signal), ctx));
  }

  listJobs(input: { status?: ForgeJobStatus; tool?: string; page?: { continuation?: string; pageSize?: number } } = {}, ctx?: RemoteCallContext) {
    let allJobs: Promise<ForgeJobSnapshot[]> | null = null;
    return iterateRemotePages(input.page, ctx, { service: "forge-compute", defaultPageSize: 50, maxPageSize: 200 }, async request => {
      allJobs ??= this.#read(() => this.#transport.listJobs({
        ...(input.status ? { status: input.status } : {}),
        ...(input.tool ? { tool: input.tool } : {}),
      }, ctx?.signal), ctx).then(value => {
        if (value.success !== true) throw new RemoteError("Forge list_jobs returned an error envelope", {
          service: "forge-compute", code: "FORGE_LIST_JOBS_FAILED", status: null,
          retryable: false, retryAfterMs: null, details: null,
        });
        if (!Array.isArray(value.jobs)) throw new RemoteError("Forge list_jobs returned an invalid jobs collection", {
          service: "forge-compute", code: "FORGE_INVALID_RESPONSE", status: null,
          retryable: false, retryAfterMs: null, details: null,
        });
        const count = integer(value.count, "count");
        const jobs = value.jobs.map(listSnapshot);
        if (count !== jobs.length) throw new RemoteError("Forge list_jobs returned a partial paged envelope", {
          service: "forge-compute", code: "FORGE_LIST_JOBS_PARTIAL_ENVELOPE", status: null,
          retryable: false, retryAfterMs: null, details: { count, jobs: jobs.length },
        });
        return jobs;
      });
      const jobs = await allJobs;
      const items = jobs.slice(request.index, request.index + request.pageSize);
      return { items, total: jobs.length, hasMore: request.index + items.length < jobs.length };
    });
  }

  async *watchJob(jobId: string, ctx?: RemoteCallContext): AsyncIterable<ForgeJobSnapshot> {
    while (true) {
      const next = await this.getJobStatus(jobId, 50, ctx);
      this.#publishHint({ jobId: next.jobId, status: next.status, eventCount: next.eventCount });
      yield next;
      if (next.status === "COMPLETED" || next.status === "FAILED" || next.status === "TIMEOUT") return;
      await this.#scheduler.sleep(1_000, ctx?.signal);
    }
  }
}

export const FORGE_COMPUTE_TOOL_MAP = {
  verifyDynamic: "verify_dynamic", penTestRun: "pen_test_run",
  getJobStatus: "get_job_status", listJobs: "list_jobs",
} as const satisfies Record<Exclude<keyof ForgeComputeClientContract, "health" | "watchJob">, ForgeComputeInvocation>;
