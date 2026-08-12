import { IndeterminateRemoteWriteError, unsupportedError } from "../errors.js";
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

function json(value: unknown): Json {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(json);
  if (typeof value === "object") {
    const output: Record<string, Json> = {};
    for (const [key, item] of Object.entries(value)) {
      if (/(?:^|_)(?:path|root|dir|directory)(?:$|_)/iu.test(key)) continue;
      output[key] = json(item);
    }
    return output;
  }
  return null;
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
    return await this.#limiter.run(operation, ctx?.signal);
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
    if (this.#remoteTransport) throw unsupportedError("forge-compute", "penTestRun.remoteFirmwareRoot");
    const value = await this.#limiter.run(async () => {
      try {
        return await this.#transport.penTestRun({
          cve_id: input.cveId, component_id: input.componentId, project_id: input.projectId,
          version_id: input.projectVersionId,
          ...(input.findingId !== undefined ? { finding_id: input.findingId } : {}),
          ...(input.profileHint !== undefined ? { profile_hint: input.profileHint } : {}),
          ...(input.tenantId !== undefined ? { tenant_id: input.tenantId } : {}),
          ...(input.deploymentContext !== undefined ? { deployment_context: input.deploymentContext } : {}),
          ...(input.budget !== undefined ? { budget: input.budget } : {}),
          ...(input.replaySeed !== undefined ? { replay_seed: input.replaySeed } : {}),
          ...(input.authoringEnabled !== undefined ? { authoring_enabled: input.authoringEnabled } : {}),
          ...(input.blind !== undefined ? { blind: input.blind } : {}),
          ...(input.confidenceFloor !== undefined ? { confidence_floor: input.confidenceFloor } : {}),
          ...(input.llmProvider !== undefined ? { llm_provider: input.llmProvider } : {}),
          ...(input.llmModel !== undefined ? { llm_model: input.llmModel } : {}),
        }, ctx?.signal);
      } catch (error: unknown) {
        if (error instanceof RemoteError && !error.retryable) throw error;
        throw new IndeterminateRemoteWriteError("forge-compute", "pen_test_run");
      }
    }, ctx?.signal);
    if (value.success !== true) throw new RemoteError("Forge pen test preflight failed", {
      service: "forge-compute", code: "FORGE_PEN_TEST_PREFLIGHT", status: null,
      retryable: false, retryAfterMs: null, details: null,
    });
    return { jobId: string(value.job_id, "job_id") ?? "" };
  }

  async getJobStatus(jobId: string, tailLines = 50, ctx?: RemoteCallContext): Promise<ForgeJobSnapshot> {
    return snapshot(await this.#read(() => this.#transport.getJobStatus({ job_id: jobId, tail_lines: tailLines }, ctx?.signal), ctx));
  }

  listJobs(input: { status?: ForgeJobStatus; tool?: string; page?: { continuation?: string; pageSize?: number } } = {}, ctx?: RemoteCallContext) {
    return iterateRemotePages(input.page, ctx, { service: "forge-compute", defaultPageSize: 50, maxPageSize: 200 }, async request => {
      const value = await this.#read(() => this.#transport.listJobs({
        ...(input.status ? { status: input.status } : {}), ...(input.tool ? { tool: input.tool } : {}),
      }, ctx?.signal), ctx);
      const jobs = Array.isArray(value.jobs) ? value.jobs.map(snapshot) : [];
      const total = typeof value.count === "number" && Number.isSafeInteger(value.count) ? value.count : jobs.length;
      const items = jobs.slice(request.index, request.index + request.pageSize);
      return { items, total, hasMore: request.index + items.length < total };
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
