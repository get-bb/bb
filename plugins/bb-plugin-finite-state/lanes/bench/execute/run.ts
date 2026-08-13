import { randomUUID } from "node:crypto";
import type { BbPluginApi } from "@bb/plugin-sdk";
import type Database from "better-sqlite3";
import type { PluginContext } from "../../../lib/context.js";
import type {
  ForgeComputeClient,
  ForgeDeploymentContext,
  ForgeJobSnapshot,
  RemoteServices,
} from "../../../lib/remote/types.js";
import { prepareFirmwareForBench } from "../../firmware/forge/handshake.js";
import type {
  PreparedFirmware,
} from "../../firmware/forge/handshake.js";
import type {
  FirmwareHandshakeDeps,
  ForgeProcessAdapter,
} from "../../firmware/forge/handshake.js";
import { storeEvidenceCheckpointWithResult } from "../store/results.js";
import type { BenchEvidenceBundle, BenchRunRecord } from "../store/types.js";
import { forgeEvidenceCheckpoint, type ForgeEvidenceDeps } from "./evidence.js";
import {
  pollForgeJobs,
  type BenchJobQueue,
  type BenchJobScheduler,
} from "./jobs.js";
import {
  createSdkBenchHostProbe,
  selectBenchHost,
  startBenchThread,
  type BenchHostProbe,
  type BenchHostPrerequisite,
} from "./hosts.js";
import { runTier0, type Tier0Analyzer } from "./tier0.js";
import {
  dispatchTier1,
  validateDeploymentContext,
  type Tier1Targets,
} from "./tier1.js";

export interface BenchRunRequest {
  projectId: string;
  pvId: string;
  tier: "tier0" | "tier1";
  hostId: string;
  requirementId?: string;
  target?: string;
  deploymentContext?: ForgeDeploymentContext;
}

export interface BenchRunStarted {
  runId: string;
  threadId: string;
  jobIds: string[];
  firmwareDigest: string;
  status: "queued" | "running";
}

export interface BenchProjectVersion {
  workspacePath: string;
  firmwareDigest: string;
}

export interface Tier1PreparedExecution {
  prepared: PreparedFirmware;
  firmwareHandshake: FirmwareHandshakeDeps;
  forgeProcess: ForgeProcessAdapter;
}

export interface BenchExecutionDeps {
  bb: BbPluginApi;
  db: Database.Database;
  hostProbe: BenchHostProbe;
  tier0Analyzers: readonly Tier0Analyzer[];
  forgeCompute: Pick<
    ForgeComputeClient,
    "verifyDynamic" | "penTestRun" | "getJobStatus"
  > | null;
  scheduler: BenchJobScheduler;
  jobQueue: Pick<BenchJobQueue, "take"> & {
    enqueue(task: { run(signal: AbortSignal): Promise<void> }): void;
  };
  evidence: ForgeEvidenceDeps;
  assertProjectVersion(
    projectId: string,
    pvId: string,
    signal: AbortSignal,
  ): Promise<BenchProjectVersion>;
  prepareFirmware(
    projectId: string,
    pvId: string,
    hostId: string,
    signal: AbortSignal,
  ): Promise<Tier1PreparedExecution>;
  resolveTier1Targets(request: BenchRunRequest, signal: AbortSignal): Promise<Tier1Targets>;
  createRunId(): string;
  now(): Date;
  publish(channel: "bench:changed" | "bench:log", payload: Record<string, string>): void;
}

interface FirmwareDigestRow {
  artifact_hash: string | null;
  input_sha256: string | null;
}

interface CheckIdRow {
  check_id: string;
}

async function projectWorkspacePath(
  bb: BbPluginApi,
  projectId: string,
  hostId: string,
  signal: AbortSignal,
): Promise<string> {
  const project = await bb.sdk.projects.get({ projectId, signal });
  const source = project.sources.find((candidate) => candidate.hostId === hostId);
  if (!source) {
    throw new BenchRunError(
      "HOST_PROJECT_SOURCE_MISSING",
      `Project ${projectId} has no workspace source on bench host ${hostId}`,
    );
  }
  return source.path;
}

function cancellableSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

export function createDefaultBenchExecutionDeps(
  ctx: PluginContext,
  request: BenchRunRequest,
  remote: RemoteServices,
  jobQueue: BenchExecutionDeps["jobQueue"],
): BenchExecutionDeps {
  const db = ctx.db();
  return {
    bb: ctx.bb,
    db,
    hostProbe: {
      async inspect(hostId, signal) {
        const workspacePath = await projectWorkspacePath(
          ctx.bb,
          request.projectId,
          hostId,
          signal,
        );
        return await createSdkBenchHostProbe(ctx.bb, {
          workspacePath,
          forgeCompute: remote.forgeCompute !== null,
        }).inspect(hostId, signal);
      },
    },
    tier0Analyzers: [
      {
        id: "firmware-digest-integrity",
        async run(input) {
          const mapped = db
            .prepare<[string, string], CheckIdRow>(
              `SELECT check_id FROM verification_checks
               WHERE project_id = ? AND project_version_id = ?
                 AND code = 'FIRMWARE_DIGEST_INTEGRITY'
               ORDER BY pulled_at DESC LIMIT 1`,
            )
            .get(input.projectId, input.pvId);
          return {
            checkId: mapped?.check_id ?? "firmware-digest-integrity",
            ...(input.requirementId ? { requirementId: input.requirementId } : {}),
            outcome: SHA256.test(input.firmwareDigest) ? "pass" : "error",
            summary: `Static firmware digest ${input.firmwareDigest} was bound before execution.`,
          };
        },
      },
    ],
    forgeCompute: remote.forgeCompute,
    scheduler: { sleep: cancellableSleep },
    jobQueue,
    evidence: {
      async persistLog(runId, job) {
        return `runs/${runId}/jobs/${job.jobId}.log`;
      },
    },
    async assertProjectVersion(projectId, pvId, signal) {
      const workspacePath = await projectWorkspacePath(
        ctx.bb,
        projectId,
        request.hostId,
        signal,
      );
      const digest = db
        .prepare<[string, string], FirmwareDigestRow>(
          `SELECT artifact_hash, input_sha256 FROM firmware_mounts
           WHERE project_id = ? AND project_version_id = ?
           ORDER BY pulled_at DESC LIMIT 1`,
        )
        .get(projectId, pvId);
      const firmwareDigest = digest?.artifact_hash ?? digest?.input_sha256 ?? null;
      if (!firmwareDigest || !SHA256.test(firmwareDigest)) {
        throw new BenchRunError(
          "FIRMWARE_DIGEST_UNAVAILABLE",
          `Project version ${pvId} has no verified firmware digest`,
        );
      }
      return { workspacePath, firmwareDigest };
    },
    async prepareFirmware(projectId, pvId, hostId, signal) {
      const worktreeRoot = await projectWorkspacePath(ctx.bb, projectId, hostId, signal);
      const firmwareHandshake = { worktreeRoot };
      const prepared = await prepareFirmwareForBench(firmwareHandshake, pvId, signal);
      return {
        prepared,
        firmwareHandshake,
        forgeProcess: {
          kind: "remote",
          reason:
            "Configured Forge does not expose a verified process restart seam for prepared firmware environment registration.",
        },
      };
    },
    async resolveTier1Targets(input) {
      const target = input.target;
      const separator = target?.indexOf("@");
      if (!target || separator === undefined || separator < 1 || separator === target.length - 1) {
        throw new BenchRunError(
          "TIER1_TARGET_INVALID",
          "Tier 1 target must be <CVE-ID>@<component-id>",
        );
      }
      if (!input.requirementId) {
        throw new BenchRunError(
          "TIER1_VERDICT_TARGET_REQUIRED",
          "Tier 1 requires a mapped requirement/verdict id",
        );
      }
      return {
        verdictIds: [input.requirementId],
        cveId: target.slice(0, separator),
        componentId: target.slice(separator + 1),
        findingId: null,
      };
    },
    createRunId: () => `bench-${randomUUID()}`,
    now: () => new Date(),
    publish(channel, payload) {
      ctx.bb.realtime.publish(channel, payload);
    },
  };
}

export class BenchRunError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "BenchRunError";
  }
}

const SHA256 = /^[a-f0-9]{64}$/u;
const CONTROL = /[\u0000-\u001f\u007f]/u;

function requiredText(name: string, value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 512 || CONTROL.test(normalized)) {
    throw new BenchRunError("INVALID_REQUEST", `${name} must be a non-empty bounded string`);
  }
  return normalized;
}

function optionalText(name: string, value: string | undefined): string | null {
  return value === undefined ? null : requiredText(name, value);
}

function validateRequest(request: BenchRunRequest): {
  projectId: string;
  pvId: string;
  hostId: string;
  requirementId: string | null;
  target: string | null;
} {
  const tier: string = request.tier;
  if (tier !== "tier0" && tier !== "tier1") {
    throw new BenchRunError("TIER_NOT_IMPLEMENTED", `Bench tier ${tier} is not implemented`);
  }
  return {
    projectId: requiredText("projectId", request.projectId),
    pvId: requiredText("pvId", request.pvId),
    hostId: requiredText("hostId", request.hostId),
    requirementId: optionalText("requirementId", request.requirementId),
    target: optionalText("target", request.target),
  };
}

function baseRun(
  input: ReturnType<typeof validateRequest>,
  tier: BenchRunRequest["tier"],
  runId: string,
  firmwareDigest: string,
  now: string,
): BenchRunRecord {
  if (!SHA256.test(firmwareDigest)) {
    throw new BenchRunError("INVALID_FIRMWARE_DIGEST", "Firmware digest must be lowercase sha256");
  }
  return {
    runId,
    projectId: input.projectId,
    pvId: input.pvId,
    tier,
    matrixTier: tier === "tier0" ? "static" : "emulation",
    target: input.target,
    status: "queued",
    firmwareDigest,
    jobId: null,
    startedAt: now,
    finishedAt: null,
    hostId: input.hostId,
    threadId: null,
    raw: { firmwareDigest, jobIds: [] },
  };
}

function checkpoint(deps: BenchExecutionDeps, bundle: BenchEvidenceBundle): void {
  const result = storeEvidenceCheckpointWithResult(deps.db, bundle, deps.now().toISOString());
  if (result.changed) {
    deps.publish("bench:changed", {
      projectId: bundle.run.projectId,
      runId: bundle.run.runId,
      status: result.status,
    });
  }
}

function queueTier1Polling(
  deps: BenchExecutionDeps,
  client: NonNullable<BenchExecutionDeps["forgeCompute"]>,
  run: BenchRunRecord,
  jobIds: readonly string[],
  requirementId: string,
): void {
  deps.jobQueue.enqueue({
    async run(signal) {
      try {
        const jobs = await pollForgeJobs(client, jobIds, signal, {
          scheduler: deps.scheduler,
          publishHint(hint) {
            deps.publish("bench:log", {
              runId: run.runId,
              jobId: hint.jobId,
              status: hint.status,
            });
          },
        });
        const evidence = await forgeEvidenceCheckpoint(
          deps.evidence,
          { run, jobs, requirementId },
          signal,
        );
        checkpoint(deps, evidence);
      } catch (error) {
        if (signal.aborted) return;
        const message = error instanceof Error ? error.message : "Tier 1 polling failed";
        const failed: BenchEvidenceBundle = {
          run: {
            ...run,
            status: "failed",
            finishedAt: deps.now().toISOString(),
            raw: { firmwareDigest: run.firmwareDigest, jobIds, pollingError: message },
          },
          results: [
            {
              requirementId,
              checkId: "forge-job-polling",
              outcome: "error",
              evidenceSummary: message,
            },
          ],
          artifacts: [],
        };
        checkpoint(deps, failed);
      }
    },
  });
}

async function executeRunBench(
  deps: BenchExecutionDeps,
  request: BenchRunRequest,
  signal: AbortSignal,
): Promise<BenchRunStarted> {
  signal.throwIfAborted();
  const validated = validateRequest(request);
  const version = await deps.assertProjectVersion(validated.projectId, validated.pvId, signal);
  const tier1 = request.tier === "tier1";
  const deploymentContext = tier1
    ? validateDeploymentContext(request.deploymentContext)
    : undefined;
  const required: readonly BenchHostPrerequisite[] = tier1
    ? ["forgeCompute", "allowPentest", "docker", "cveEvidenceVerifier"]
    : [];
  await selectBenchHost(deps.bb, deps.hostProbe, validated.hostId, required, signal);

  const preparedExecution = tier1
    ? await deps.prepareFirmware(
        validated.projectId,
        validated.pvId,
        validated.hostId,
        signal,
      )
    : null;
  const prepared = preparedExecution?.prepared ?? null;
  const firmwareDigest = prepared?.artifactHash ?? version.firmwareDigest;
  const runId = requiredText("runId", deps.createRunId());
  const queued = baseRun(
    validated,
    request.tier,
    runId,
    firmwareDigest,
    deps.now().toISOString(),
  );
  checkpoint(deps, { run: queued, results: [], artifacts: [] });

  const workspacePath = prepared?.rootfsPath ?? version.workspacePath;
  const threadId = await startBenchThread(deps.bb, {
    projectId: validated.projectId,
    pvId: validated.pvId,
    tier: request.tier,
    hostId: validated.hostId,
    workspacePath,
    firmwareDigest,
  });
  const linked: BenchRunRecord = { ...queued, threadId };
  checkpoint(deps, { run: linked, results: [], artifacts: [] });

  if (!tier1) {
    const evidence = await runTier0(
      deps.tier0Analyzers,
      {
        projectId: validated.projectId,
        pvId: validated.pvId,
        firmwareDigest,
        hostId: validated.hostId,
        target: validated.target,
        requirementId: validated.requirementId,
      },
      signal,
    );
    checkpoint(deps, {
      run: {
        ...linked,
        status: "completed",
        finishedAt: deps.now().toISOString(),
        raw: { firmwareDigest, analyzerCount: deps.tier0Analyzers.length },
      },
      ...evidence,
    });
    return { runId, threadId, jobIds: [], firmwareDigest, status: "running" };
  }

  const client = deps.forgeCompute;
  if (!client || !preparedExecution || !deploymentContext) {
    throw new BenchRunError("FORGE_COMPUTE_UNAVAILABLE", "Tier 1 requires Forge Compute");
  }
  const targets = await deps.resolveTier1Targets(request, signal);
  const jobIds = await dispatchTier1(
    {
      forgeCompute: client,
      firmwareHandshake: preparedExecution.firmwareHandshake,
      forgeProcess: preparedExecution.forgeProcess,
    },
    {
      projectId: validated.projectId,
      pvId: validated.pvId,
      prepared: preparedExecution.prepared,
      targets,
      deploymentContext,
    },
    signal,
  );
  const running: BenchRunRecord = {
    ...linked,
    status: "running",
    jobId: jobIds[0] ?? null,
    raw: { firmwareDigest, jobIds },
  };
  checkpoint(deps, { run: running, results: [], artifacts: [] });
  queueTier1Polling(
    deps,
    client,
    running,
    jobIds,
    validated.requirementId ?? "unmapped:tier1",
  );
  return { runId, threadId, jobIds, firmwareDigest, status: "running" };
}

export function runBench(
  deps: BenchExecutionDeps,
  request: BenchRunRequest,
  signal: AbortSignal,
): Promise<BenchRunStarted> {
  return executeRunBench(deps, request, signal);
}

export type { ForgeJobSnapshot };
