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
import type { PreparedFirmware } from "../../firmware/forge/handshake.js";
import type {
  FirmwareHandshakeDeps,
  ForgeProcessAdapter,
} from "../../firmware/forge/handshake.js";
import { storeEvidenceCheckpointWithResult } from "../store/results.js";
import { getAcceptedBenchGeneration } from "../store/runs.js";
import type { BenchEvidenceBundle, BenchRunRecord } from "../store/types.js";
import {
  BENCH_DISPATCH_AMBIGUOUS_CODE,
  BENCH_DISPATCH_RECONCILIATION_FAILED_CODE,
  BENCH_DISPATCH_RECONCILED_CODE,
} from "../ambiguity.js";
import { forgeEvidenceCheckpoint, type ForgeEvidenceDeps } from "./evidence.js";
import {
  ForgeJobPollLimitError,
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
  type Tier1DispatchIntent,
  type Tier1DispatchTool,
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

export interface PersistedBenchLog {
  version: 1;
  text: string;
  complete: false;
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
    "verifyDynamic" | "penTestRun" | "getJobStatus" | "listJobs"
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
  resolveTier1Targets(
    request: BenchRunRequest,
    signal: AbortSignal,
  ): Promise<Tier1Targets>;
  createRunId(): string;
  now(): Date;
  publish(
    channel: "bench:changed" | "bench:log",
    payload: Record<string, string>,
  ): void;
}

interface FirmwareDigestRow {
  artifact_hash: string | null;
  input_sha256: string | null;
}

interface CheckIdRow {
  check_id: string;
}

const SAFE_LOCATOR_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const MAX_PERSISTED_LOG_TEXT_BYTES = 240 * 1024;

function boundedUtf8Tail(text: string): string {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.byteLength <= MAX_PERSISTED_LOG_TEXT_BYTES) return text;
  let tail = bytes
    .subarray(bytes.byteLength - MAX_PERSISTED_LOG_TEXT_BYTES)
    .toString("utf8");
  while (Buffer.byteLength(tail, "utf8") > MAX_PERSISTED_LOG_TEXT_BYTES) {
    tail = tail.slice(1);
  }
  return tail;
}

export async function persistBenchLog(
  kv: Pick<BbPluginApi["storage"]["kv"], "set" | "delete">,
  runId: string,
  job: Pick<ForgeJobSnapshot, "jobId" | "logTail">,
  signal: AbortSignal,
): Promise<string | null> {
  if (
    !SAFE_LOCATOR_SEGMENT.test(runId) ||
    !SAFE_LOCATOR_SEGMENT.test(job.jobId)
  ) {
    return null;
  }
  const locator = `runs/${runId}/jobs/${job.jobId}.log`;
  const persisted: PersistedBenchLog = {
    version: 1,
    text: boundedUtf8Tail(
      job.logTail.length === 0 ? "" : `${job.logTail.join("\n")}\n`,
    ),
    complete: false,
  };
  signal.throwIfAborted();
  try {
    await kv.set(locator, persisted);
    signal.throwIfAborted();
    return locator;
  } catch (error) {
    await kv.delete(locator).catch(() => undefined);
    if (signal.aborted) throw signal.reason;
    return null;
  }
}

export async function readPersistedBenchLog(
  kv: Pick<BbPluginApi["storage"]["kv"], "get">,
  locator: string,
): Promise<PersistedBenchLog | null> {
  const value = await kv.get<unknown>(locator);
  if (
    typeof value !== "object" ||
    value === null ||
    !("version" in value) ||
    value.version !== 1 ||
    !("text" in value) ||
    typeof value.text !== "string" ||
    !("complete" in value) ||
    value.complete !== false
  ) {
    return null;
  }
  return { version: 1, text: value.text, complete: false };
}

async function projectWorkspacePath(
  bb: BbPluginApi,
  projectId: string,
  hostId: string,
  signal: AbortSignal,
): Promise<string> {
  const project = await bb.sdk.projects.get({ projectId, signal });
  const source = project.sources.find(
    (candidate) => candidate.hostId === hostId,
  );
  if (!source) {
    throw new BenchRunError(
      "HOST_PROJECT_SOURCE_MISSING",
      `Project ${projectId} has no workspace source on bench host ${hostId}`,
    );
  }
  return source.path;
}

function cancellableSleep(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
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
            ...(input.requirementId
              ? { requirementId: input.requirementId }
              : {}),
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
      async persistLog(runId, job, signal) {
        return await persistBenchLog(ctx.bb.storage.kv, runId, job, signal);
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
      const firmwareDigest =
        digest?.artifact_hash ?? digest?.input_sha256 ?? null;
      if (!firmwareDigest || !SHA256.test(firmwareDigest)) {
        throw new BenchRunError(
          "FIRMWARE_DIGEST_UNAVAILABLE",
          `Project version ${pvId} has no verified firmware digest`,
        );
      }
      return { workspacePath, firmwareDigest };
    },
    async prepareFirmware(projectId, pvId, hostId, signal) {
      const worktreeRoot = await projectWorkspacePath(
        ctx.bb,
        projectId,
        hostId,
        signal,
      );
      const firmwareHandshake = { worktreeRoot };
      const prepared = await prepareFirmwareForBench(
        firmwareHandshake,
        pvId,
        signal,
      );
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
      if (
        !target ||
        separator === undefined ||
        separator < 1 ||
        separator === target.length - 1
      ) {
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
  constructor(
    readonly code: string,
    message: string,
    readonly runId: string | null = null,
  ) {
    super(message);
    this.name = "BenchRunError";
  }
}

const SHA256 = /^[a-f0-9]{64}$/u;
const FAILURE_CODE = /^[A-Z][A-Z0-9_]{0,127}$/u;
const CONTROL = /[\u0000-\u001f\u007f]/u;

function failureCode(error: unknown): string {
  if (error instanceof BenchRunError) return error.code;
  if (typeof error === "object" && error !== null) {
    const code = Reflect.get(error, "code");
    if (typeof code === "string" && FAILURE_CODE.test(code)) return code;
  }
  return "BENCH_RUN_FAILED";
}

function requiredText(name: string, value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 512 || CONTROL.test(normalized)) {
    throw new BenchRunError(
      "INVALID_REQUEST",
      `${name} must be a non-empty bounded string`,
    );
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
    throw new BenchRunError(
      "TIER_NOT_IMPLEMENTED",
      `Bench tier ${tier} is not implemented`,
    );
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
  firmwareDigest: string | null,
  now: string,
): BenchRunRecord {
  if (firmwareDigest !== null && !SHA256.test(firmwareDigest)) {
    throw new BenchRunError(
      "INVALID_FIRMWARE_DIGEST",
      "Firmware digest must be lowercase sha256",
    );
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

function assertForgeProcessAvailable(adapter: ForgeProcessAdapter): void {
  if (adapter.kind === "remote") {
    throw new BenchRunError(
      "FIRMWARE_REGISTRATION_UNAVAILABLE",
      adapter.reason ??
        "Remote Forge cannot register the prepared firmware environment",
    );
  }
  if (adapter.kind === "persistent" && !adapter.restart) {
    throw new BenchRunError(
      "FIRMWARE_REGISTRATION_UNAVAILABLE",
      "Persistent Forge requires a verified restart seam for prepared firmware registration",
    );
  }
}

function checkpoint(
  deps: BenchExecutionDeps,
  bundle: BenchEvidenceBundle,
): void {
  const result = storeEvidenceCheckpointWithResult(
    deps.db,
    bundle,
    deps.now().toISOString(),
  );
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
        const message =
          error instanceof Error ? error.message : "Tier 1 polling failed";
        const failed: BenchEvidenceBundle = {
          run: {
            ...run,
            status: "failed",
            finishedAt: deps.now().toISOString(),
            raw: {
              firmwareDigest: run.firmwareDigest,
              jobIds,
              pollingError: message,
            },
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

interface DispatchedForgeJob {
  tool: Tier1DispatchTool;
  jobId: string;
}

function jsonObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

function scopeString(
  scope: Record<string, unknown>,
  ...names: readonly string[]
): string | null {
  for (const name of names) {
    const value = scope[name];
    if (typeof value === "string") return value;
  }
  return null;
}

function scopeStrings(
  scope: Record<string, unknown>,
  ...names: readonly string[]
): string[] | null {
  for (const name of names) {
    const value = scope[name];
    if (
      Array.isArray(value) &&
      value.every((candidate) => typeof candidate === "string")
    ) {
      return [...value];
    }
  }
  return null;
}

function matchesDispatchIntent(
  job: ForgeJobSnapshot,
  intent: Tier1DispatchIntent,
): boolean {
  if (job.tool !== intent.tool) return false;
  const scope = jsonObject(job.scope);
  if (!scope) return false;
  const projectVersionId = scopeString(
    scope,
    "projectVersionId",
    "project_version_id",
    "pv_id",
  );
  if (projectVersionId !== intent.scope.projectVersionId) return false;
  if (intent.tool === "verify_dynamic") {
    const verdictIds = scopeStrings(scope, "verdictIds", "verdict_ids");
    return (
      verdictIds !== null &&
      JSON.stringify([...verdictIds].sort()) ===
        JSON.stringify([...intent.scope.verdictIds].sort())
    );
  }
  return (
    scopeString(scope, "projectId", "project_id") === intent.scope.projectId &&
    scopeString(scope, "cveId", "cve_id") === intent.scope.cveId &&
    scopeString(scope, "componentId", "component_id") ===
      intent.scope.componentId
  );
}

function queueTier1AmbiguityReconciliation(
  deps: BenchExecutionDeps,
  client: NonNullable<BenchExecutionDeps["forgeCompute"]>,
  run: BenchRunRecord,
  intents: readonly Tier1DispatchIntent[],
  dispatchedJobs: readonly DispatchedForgeJob[],
  requirementId: string,
): void {
  const reconciliationPolicy =
    "baseline_diff_scope_match_without_evidence_promotion";
  const finishReconciliationFailure = (
    error: unknown,
    failureReason: string,
    candidateJobIds: readonly string[] = dispatchedJobs.map((job) => job.jobId),
  ): void => {
    const message =
      error instanceof Error
        ? error.message
        : "Forge dispatch reconciliation failed";
    const finishedAt = deps.now().toISOString();
    checkpoint(deps, {
      run: {
        ...run,
        status: "failed",
        finishedAt,
        jobId: candidateJobIds[0] ?? run.jobId,
        durationMs:
          run.startedAt === null
            ? null
            : Math.max(0, Date.parse(finishedAt) - Date.parse(run.startedAt)),
        raw: {
          ...(jsonObject(run.raw) ?? {}),
          dispatchAmbiguous: true,
          reconciliationState: "terminal",
          reconciliationError: message.slice(0, 20_000),
          reconciliationCandidateJobIds: [...candidateJobIds],
          reconciliationPolicy,
          failureCode: BENCH_DISPATCH_RECONCILIATION_FAILED_CODE,
          failureReason,
        },
      },
      results: [
        {
          requirementId,
          checkId: "forge-dispatch-reconciliation",
          outcome: "error",
          evidenceSummary:
            "Automatic Forge reconciliation failed without resolving the ambiguous dispatch.",
        },
      ],
      artifacts: [],
    });
  };
  const task = {
    async run(signal: AbortSignal): Promise<void> {
      const candidates = new Map(
        dispatchedJobs.map((job) => [job.jobId, job] as const),
      );
      const matchedIntents = new Set<number>();
      for (const [index, intent] of intents.entries()) {
        // dispatchTier1 currently issues at most one intent per tool. If it
        // ever adds a second pen_test_run target, this pre-seed must key on
        // full intent identity rather than treating tool identity as unique.
        if (dispatchedJobs.some((job) => job.tool === intent.tool)) {
          matchedIntents.add(index);
        }
      }
      for (let retryAttempt = 0; retryAttempt < 3; retryAttempt += 1) {
        try {
          for (
            let discoveryAttempt = 0;
            discoveryAttempt < 4;
            discoveryAttempt += 1
          ) {
            for (const [intentIndex, intent] of intents.entries()) {
              if (matchedIntents.has(intentIndex)) continue;
              const prior = new Set(intent.priorJobIds);
              for await (const page of client.listJobs(
                { tool: intent.tool },
                { signal },
              )) {
                for (const job of page.items) {
                  if (
                    !prior.has(job.jobId) &&
                    matchesDispatchIntent(job, intent)
                  ) {
                    candidates.set(job.jobId, {
                      tool: intent.tool,
                      jobId: job.jobId,
                    });
                    matchedIntents.add(intentIndex);
                  }
                }
              }
            }
            if (matchedIntents.size === intents.length) break;
            if (discoveryAttempt < 3) {
              await deps.scheduler.sleep(500 * 2 ** discoveryAttempt, signal);
            }
          }
          const jobIds = [...candidates.keys()];
          if (jobIds.length > 0) {
            // Forge exposes no client correlation id. Conservatively drain all
            // baseline-diff scope matches, including a theoretical concurrent
            // identical run, and never promote reconciliation output to evidence.
            await pollForgeJobs(client, jobIds, signal, {
              scheduler: deps.scheduler,
              publishHint(hint) {
                deps.publish("bench:log", {
                  runId: run.runId,
                  jobId: hint.jobId,
                  status: hint.status,
                });
              },
            });
          }
          const finishedAt = deps.now().toISOString();
          checkpoint(deps, {
            run: {
              ...run,
              status: "failed",
              finishedAt,
              durationMs:
                run.startedAt === null
                  ? null
                  : Math.max(
                      0,
                      Date.parse(finishedAt) - Date.parse(run.startedAt),
                    ),
              jobId: jobIds[0] ?? run.jobId,
              raw: {
                ...(jsonObject(run.raw) ?? {}),
                dispatchAmbiguous: false,
                reconciliationState: "terminal",
                reconciliationAttempts: retryAttempt + 1,
                reconciledJobIds: jobIds,
                reconciliationPolicy,
                failureCode: BENCH_DISPATCH_RECONCILED_CODE,
                failureReason:
                  jobIds.length > 0
                    ? "Forge reconciliation observed every candidate dispatch reach a terminal state. The incomplete bench attempt was not promoted to evidence."
                    : "Forge reconciliation repeatedly found no matching accepted job. The incomplete bench attempt was not promoted to evidence.",
              },
            },
            results: [
              {
                requirementId,
                checkId: "forge-dispatch-reconciliation",
                outcome: "error",
                evidenceSummary:
                  "Ambiguous Forge dispatch reconciled without producing complete Tier 1 evidence.",
              },
            ],
            artifacts: [],
          });
          return;
        } catch (error) {
          if (signal.aborted) return;
          if (error instanceof ForgeJobPollLimitError) {
            finishReconciliationFailure(
              error,
              "Automatic Forge reconciliation reached the job polling liveness ceiling. The dispatch outcome remains ambiguous; do not dispatch a duplicate.",
              [...candidates.keys()],
            );
            return;
          }
          if (retryAttempt === 2) {
            finishReconciliationFailure(
              error,
              "Automatic Forge reconciliation exhausted its retry budget. The dispatch outcome remains ambiguous; do not dispatch a duplicate.",
              [...candidates.keys()],
            );
            return;
          }
          const message =
            error instanceof Error
              ? error.message
              : "Forge dispatch reconciliation failed";
          checkpoint(deps, {
            run: {
              ...run,
              raw: {
                ...(jsonObject(run.raw) ?? {}),
                reconciliationState: "retry_required",
                reconciliationAttempts: retryAttempt + 1,
                reconciliationError: message.slice(0, 20_000),
              },
            },
            results: [],
            artifacts: [],
          });
          await deps.scheduler.sleep(500 * 2 ** retryAttempt, signal);
        }
      }
    },
  };
  try {
    deps.jobQueue.enqueue(task);
  } catch (error) {
    finishReconciliationFailure(
      error,
      "Automatic Forge reconciliation could not be queued. The dispatch outcome remains ambiguous; do not dispatch a duplicate.",
    );
  }
}

async function executeRunBench(
  deps: BenchExecutionDeps,
  request: BenchRunRequest,
  signal: AbortSignal,
): Promise<BenchRunStarted> {
  signal.throwIfAborted();
  const validated = validateRequest(request);
  // A verification_run is generation-owned. Reject an invalid evidence scope
  // before minting an attempt id; after this boundary every minted attempt can
  // be checkpointed durably, including all later preflight failures.
  getAcceptedBenchGeneration(deps.db, validated.projectId, validated.pvId);
  const runId = requiredText("runId", deps.createRunId());
  const startedAt = deps.now().toISOString();
  let currentRun: BenchRunRecord = {
    ...baseRun(validated, request.tier, runId, null, startedAt),
    kind: "bench",
    trigger: "manual",
    raw: { stage: "preflight", jobIds: [] },
  };
  let attemptRecorded = false;
  let failureContext: {
    firmwareDigest?: string;
    dispatchError?: string;
    jobIds?: string[];
    dispatchIntents?: Tier1DispatchIntent[];
    dispatchedJobs?: DispatchedForgeJob[];
  } = {};

  try {
    checkpoint(deps, { run: currentRun, results: [], artifacts: [] });
    attemptRecorded = true;
    const version = await deps.assertProjectVersion(
      validated.projectId,
      validated.pvId,
      signal,
    );
    const tier1 = request.tier === "tier1";
    const deploymentContext = tier1
      ? validateDeploymentContext(request.deploymentContext)
      : undefined;
    const required: readonly BenchHostPrerequisite[] = tier1
      ? ["forgeCompute", "allowPentest", "docker", "cveEvidenceVerifier"]
      : [];
    await selectBenchHost(
      deps.bb,
      deps.hostProbe,
      validated.hostId,
      required,
      signal,
    );

    const preparedExecution = tier1
      ? await deps.prepareFirmware(
          validated.projectId,
          validated.pvId,
          validated.hostId,
          signal,
        )
      : null;
    const client = tier1 ? deps.forgeCompute : null;
    if (tier1 && (!client || !preparedExecution || !deploymentContext)) {
      throw new BenchRunError(
        "FORGE_COMPUTE_UNAVAILABLE",
        "Tier 1 requires Forge Compute",
      );
    }
    if (preparedExecution)
      assertForgeProcessAvailable(preparedExecution.forgeProcess);
    const targets = tier1
      ? await deps.resolveTier1Targets(request, signal)
      : null;
    const prepared = preparedExecution?.prepared ?? null;
    const firmwareDigest = prepared?.artifactHash ?? version.firmwareDigest;
    failureContext = { firmwareDigest };
    const queued: BenchRunRecord = {
      ...baseRun(validated, request.tier, runId, firmwareDigest, startedAt),
      ...(deploymentContext ? { config: deploymentContext } : {}),
    };
    currentRun = queued;
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
    currentRun = linked;
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

    if (!client || !preparedExecution || !deploymentContext || !targets) {
      throw new BenchRunError(
        "FORGE_COMPUTE_UNAVAILABLE",
        "Tier 1 requires Forge Compute",
      );
    }
    let jobIds: string[];
    const dispatchIntents: Tier1DispatchIntent[] = [];
    const dispatchedJobs: DispatchedForgeJob[] = [];
    try {
      jobIds = await dispatchTier1(
        {
          forgeCompute: client,
          firmwareHandshake: preparedExecution.firmwareHandshake,
          forgeProcess: preparedExecution.forgeProcess,
          onDispatchIssued(intent) {
            dispatchIntents.push(intent);
            const jobIds = dispatchedJobs.map((job) => job.jobId);
            const dispatching: BenchRunRecord = {
              ...linked,
              status: "running",
              jobId: jobIds[0] ?? null,
              raw: {
                firmwareDigest,
                jobIds,
                dispatchIntents: [...dispatchIntents],
                dispatchedJobs: [...dispatchedJobs],
                dispatching: true,
              },
            };
            currentRun = dispatching;
            failureContext = {
              firmwareDigest,
              jobIds,
              dispatchIntents: [...dispatchIntents],
              dispatchedJobs: [...dispatchedJobs],
            };
            checkpoint(deps, {
              run: dispatching,
              results: [],
              artifacts: [],
            });
          },
          onJobDispatched(tool, jobId) {
            dispatchedJobs.push({ tool, jobId });
          },
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
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Tier 1 dispatch failed";
      failureContext = {
        firmwareDigest,
        jobIds: dispatchedJobs.map((job) => job.jobId),
        dispatchIntents: [...dispatchIntents],
        dispatchedJobs: [...dispatchedJobs],
        dispatchError: message,
      };
      throw new BenchRunError("FORGE_DISPATCH_FAILED", message);
    }
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
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Bench run preflight failed";
    const aborted = signal.aborted;
    const dispatchAmbiguous = (failureContext.dispatchIntents?.length ?? 0) > 0;
    const code = dispatchAmbiguous
      ? BENCH_DISPATCH_AMBIGUOUS_CODE
      : aborted
        ? "BENCH_RUN_ABORTED"
        : failureCode(error);
    if (!attemptRecorded) throw new BenchRunError(code, message);
    const finishedAt = deps.now().toISOString();
    const persistedRun: BenchRunRecord = {
      ...currentRun,
      status: dispatchAmbiguous ? "running" : aborted ? "timeout" : "failed",
      ...(dispatchAmbiguous
        ? { finishedAt: null, durationMs: null }
        : {
            finishedAt,
            durationMs: Math.max(
              0,
              Date.parse(finishedAt) - Date.parse(startedAt),
            ),
          }),
      jobId: failureContext.jobIds?.[0] ?? currentRun.jobId,
      raw: {
        ...failureContext,
        stage: currentRun.threadId ? "execution" : "preflight",
        dispatchAmbiguous,
        failureCode: code,
        failureReason: message.slice(0, 20_000),
        jobIds: failureContext.jobIds ?? [],
      },
    };
    checkpoint(deps, {
      run: persistedRun,
      results: [
        {
          requirementId: validated.requirementId ?? "unmapped:bench-run",
          checkId:
            code === "FORGE_DISPATCH_FAILED"
              ? "forge-dispatch"
              : currentRun.threadId
                ? "bench-execution"
                : "bench-preflight",
          outcome: "error",
          evidenceSummary: message.slice(0, 20_000),
        },
      ],
      artifacts: [],
    });
    if (dispatchAmbiguous && deps.forgeCompute) {
      queueTier1AmbiguityReconciliation(
        deps,
        deps.forgeCompute,
        persistedRun,
        failureContext.dispatchIntents ?? [],
        failureContext.dispatchedJobs ?? [],
        validated.requirementId ?? "unmapped:tier1",
      );
    }
    throw new BenchRunError(code, message, runId);
  }
}

export function runBench(
  deps: BenchExecutionDeps,
  request: BenchRunRequest,
  signal: AbortSignal,
): Promise<BenchRunStarted> {
  return executeRunBench(deps, request, signal);
}

export type { ForgeJobSnapshot };
