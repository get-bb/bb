import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  normalizeForgeJobSnapshot,
  type ForgeJobCandidate,
  type ForgeJobSnapshot,
  type ForgeJobTerminalStatus,
  type Json,
} from "../../../lib/remote/types.js";

export interface MockForgeComputeClock {
  now(): string;
  elapsedSeconds(): number;
}

export interface MockForgeComputeController {
  readonly configured: boolean;
  prepare(input: { projectVersionId: string; rootPath: string; expectedDigest: string }):
    { prepared: false; reason: "UNSUPPORTED_UNVERIFIED_MAPPING" };
  create(tool: "verifyDynamic" | "penTestRun", input: unknown): { jobId: string };
  advance(jobId: string, next: ForgeJobTerminalStatus): void;
  get(jobId: string, tailLines: number): ForgeJobSnapshot;
  reset(): void;
}

const LOCAL_PATH_FIELDS = new Set([
  "bundle_path", "bundlepath", "firmware_path", "firmwarepath", "root_path", "rootpath",
  "evidence_root", "evidenceroot", "registry", "log_path", "logpath", "run_dir", "rundir",
  "vendor_vex_path", "vendorvexpath",
]);

function json(value: unknown): Json {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(json);
  if (typeof value === "object") {
    const output: Record<string, Json> = {};
    for (const [key, item] of Object.entries(value)) {
      if (!LOCAL_PATH_FIELDS.has(key.toLocaleLowerCase())) output[key] = json(item);
    }
    return output;
  }
  return null;
}

function seedJobs(fixtureRoot: string): ForgeJobSnapshot[] {
  return readFileSync(resolve(fixtureRoot, "forge-compute/jobs.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => normalizeForgeJobSnapshot(JSON.parse(line) as ForgeJobCandidate));
}

function clone<T>(value: T): T { return structuredClone(value); }

export class ForgeComputeController implements MockForgeComputeController {
  readonly configured: boolean;
  readonly #fixtureRoot: string;
  readonly #clock: MockForgeComputeClock;
  #jobs = new Map<string, ForgeJobSnapshot>();
  #nextId = 1;

  constructor(
    fixtureRoot: string,
    options: { configured: boolean; clock: MockForgeComputeClock },
  ) {
    this.#fixtureRoot = fixtureRoot;
    this.configured = options.configured;
    this.#clock = options.clock;
    this.reset();
  }

  prepare(_input: { projectVersionId: string; rootPath: string; expectedDigest: string }) {
    return { prepared: false, reason: "UNSUPPORTED_UNVERIFIED_MAPPING" } as const;
  }

  create(tool: "verifyDynamic" | "penTestRun", input: unknown): { jobId: string } {
    if (!this.configured) throw new Error("FORGE_COMPUTE_NOT_CONFIGURED");
    const jobId = `mock-forge-job-${this.#nextId++}`;
    const event = { sequence: 1, type: "RUNNING", at: this.#clock.now() };
    this.#jobs.set(jobId, {
      jobId,
      status: "RUNNING",
      tool: tool === "verifyDynamic" ? "verify_dynamic" : "pen_test_run",
      recipe: tool === "verifyDynamic" ? "qemu-eagle" : null,
      scope: json(input),
      environment: { image: "fixture/forge-compute:1" },
      runId: null,
      elapsedSeconds: this.#clock.elapsedSeconds(),
      logTail: [`${jobId} running`],
      events: [event],
      eventCount: 1,
      result: null,
      error: null,
    });
    return { jobId };
  }

  advance(jobId: string, next: ForgeJobTerminalStatus): void {
    const current = this.#jobs.get(jobId);
    if (current === undefined) throw new Error("FORGE_JOB_NOT_FOUND");
    if (current.status !== "RUNNING") throw new Error("FORGE_JOB_ALREADY_TERMINAL");
    const event = {
      sequence: current.eventCount + 1,
      type: next,
      at: this.#clock.now(),
    };
    const failed = next === "FAILED" || next === "TIMEOUT";
    const updated: ForgeJobSnapshot = {
      ...current,
      status: next,
      elapsedSeconds: this.#clock.elapsedSeconds(),
      logTail: [...current.logTail, `${jobId} ${next.toLowerCase()}`],
      events: [...current.events, event],
      eventCount: current.eventCount + 1,
      runId: `mock-run-${jobId}`,
      result: next === "COMPLETED" ? { verdict: "pass" } : null,
      error: failed ? {
        code: next === "TIMEOUT" ? "FORGE_JOB_TIMEOUT" : "FORGE_JOB_FAILED",
        message: `Mock job ${next.toLowerCase()}`,
      } : null,
    };
    this.#jobs.set(jobId, updated);
  }

  get(jobId: string, tailLines: number): ForgeJobSnapshot {
    if (!Number.isSafeInteger(tailLines) || tailLines < 0 || tailLines > 200) {
      throw new RangeError("FORGE_TAIL_LINES_INVALID");
    }
    const job = this.#jobs.get(jobId);
    if (job === undefined) throw new Error("FORGE_JOB_NOT_FOUND");
    return clone({
      ...job,
      logTail: tailLines === 0 ? [] : job.logTail.slice(-tailLines),
    });
  }

  list(): ForgeJobSnapshot[] {
    return [...this.#jobs.values()].map(clone);
  }

  reset(): void {
    const seeded = seedJobs(this.#fixtureRoot);
    this.#jobs = new Map(seeded.map((job) => [job.jobId, clone(job)]));
    this.#nextId = 1;
  }
}

export function createMockForgeComputeController(
  fixtureRoot: string,
  options: {
    configured?: boolean;
    clock?: MockForgeComputeClock;
  } = {},
): ForgeComputeController {
  return new ForgeComputeController(fixtureRoot, {
    configured: options.configured ?? true,
    clock: options.clock ?? {
      now: () => "2026-05-12T14:30:00.000Z",
      elapsedSeconds: () => 0,
    },
  });
}
