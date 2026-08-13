import type { BbPluginApi } from "@bb/plugin-sdk";
import type Database from "better-sqlite3";
import type { PluginContext } from "../../lib/context.js";
import type { RemoteServices } from "../../lib/remote/types.js";
import {
  PROJECT_LEVEL_VERSION_ID,
  toStorageProjectVersionId,
} from "../../lib/store/index.js";
import { rpcContract } from "../../shared/contract.js";
import {
  createBenchHostJoinCode,
  createSdkBenchHostProbe,
  listBenchHosts,
  probeBenchHostCapabilities,
} from "./execute/hosts.js";
import { InMemoryBenchJobQueue, runBenchJobService } from "./execute/jobs.js";
import {
  createDefaultBenchExecutionDeps,
  readPersistedBenchLog,
  runBench,
} from "./execute/run.js";
import { listBenchArtifacts } from "./store/artifacts.js";
import { listBenchAttestations } from "./store/attestations.js";
import { listBenchResults, storeEvidenceCheckpointWithResult } from "./store/results.js";
import { getBenchRun, listBenchRuns } from "./store/runs.js";
import type { BenchEvidenceBundle } from "./store/types.js";
import { getOtaVerdict } from "./verdict/query.js";

const benchRpcContract = {
  benchRunsList: rpcContract.benchRunsList,
  benchRunGet: rpcContract.benchRunGet,
  benchLogsList: rpcContract.benchLogsList,
  benchVerdictGet: rpcContract.benchVerdictGet,
  benchRunStart: rpcContract.benchRunStart,
  benchHostsList: rpcContract.benchHostsList,
  benchHostsJoinCode: rpcContract.benchHostsJoinCode,
} as const;

function streamUnavailable(message: string, status = 410): Response {
  return new Response(
    JSON.stringify({ error: { code: "BENCH_STREAM_UNAVAILABLE", message } }),
    { headers: { "Content-Type": "application/json; charset=utf-8" }, status },
  );
}

function queryRunId(value: string | undefined): string | null {
  return value !== undefined && SAFE_ID.test(value) ? value : null;
}

function queryArtifactName(value: string | undefined): string | null {
  return value !== undefined && SAFE_ARTIFACT_NAME.test(value) ? value : null;
}

interface RunSurfaceRow {
  run_id: string;
  project_id: string;
  project_version_id: string;
  kind: string;
  trigger: string | null;
  host_id: string | null;
  thread_id: string | null;
  config: string | null;
  duration_ms: number | null;
  log_locator: string | null;
  log_cursor: string | null;
  raw: string;
  started_at: string | null;
  finished_at: string | null;
  synced_at: string;
}

interface ArtifactStreamRow {
  name: string;
  kind: string;
  sha256: string | null;
  bytes: number | null;
}

interface AttestationStreamRow {
  format: string;
  payload: string;
}

interface CachedLogLine {
  sequence: number;
  at: string;
  level: "stdout";
  text: string;
}

interface ProjectVersionRow {
  project_version_id: string;
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/u;
const SAFE_ARTIFACT_NAME = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,199}$/u;

function acceptedBenchProjectVersionId(
  db: Database.Database,
  projectId: string,
): string | null {
  return db
    .prepare<[string, string], ProjectVersionRow>(
      `SELECT s.project_version_id
         FROM sync_state s
         JOIN pull_generation g
           ON g.project_id = s.project_id
          AND g.project_version_id = s.project_version_id
          AND g.generation_id = s.accepted_generation_id
          AND g.status = 'accepted'
        WHERE s.project_id = ? AND s.entity_kind = 'verificationRun'
          AND s.project_version_id <> ?
          AND s.accepted_generation_id IS NOT NULL
        ORDER BY s.last_pull DESC, s.project_version_id DESC
        LIMIT 1`,
    )
    .get(projectId, PROJECT_LEVEL_VERSION_ID)?.project_version_id ?? null;
}

function runProjectVersionId(
  db: Database.Database,
  projectId: string,
  requestedProjectVersionId: string | null,
  runId: string,
): string | null {
  if (requestedProjectVersionId !== null) return requestedProjectVersionId;
  const rows = db
    .prepare<[string, string], ProjectVersionRow>(
      `SELECT r.project_version_id
         FROM verification_runs r
         JOIN sync_state s
           ON s.project_id = r.project_id
          AND s.project_version_id = r.project_version_id
          AND s.entity_kind = 'verificationRun'
          AND s.accepted_generation_id = r.generation_id
         JOIN pull_generation g
           ON g.project_id = s.project_id
          AND g.project_version_id = s.project_version_id
          AND g.generation_id = s.accepted_generation_id
          AND g.status = 'accepted'
        WHERE r.project_id = ? AND r.run_id = ?
        ORDER BY s.last_pull DESC, r.project_version_id DESC
        LIMIT 2`,
    )
    .all(projectId, runId);
  return rows.length === 1 ? rows[0]!.project_version_id : null;
}

function frozenBenchLogRunId(input: object): string {
  // pagedScopedInput currently erases additive keys from its inferred output
  // type. Runtime validation still uses the frozen schema by reference.
  const runId = Reflect.get(input, "runId");
  if (typeof runId !== "string") throw new Error("INVALID_BENCH_RUN_ID");
  return runId;
}

function parseJson(value: string | null): unknown | null {
  if (value === null) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

function runSurfaceRows(
  db: Database.Database,
  projectId: string,
  projectVersionId: string | null,
  runIds: readonly string[],
): Map<string, RunSurfaceRow> {
  if (runIds.length === 0) return new Map();
  const placeholders = runIds.map(() => "?").join(",");
  const rows = db
    .prepare<string[], RunSurfaceRow>(
      `SELECT r.run_id, r.project_id, r.project_version_id, r.kind, r.trigger,
              r.host_id, r.thread_id, r.config, r.duration_ms, r.log_locator,
              r.log_cursor, r.raw, r.started_at, r.finished_at, r.synced_at
       FROM verification_runs r
       JOIN sync_state s
         ON s.project_id = r.project_id
        AND s.project_version_id = r.project_version_id
        AND s.entity_kind = 'verificationRun'
        AND s.accepted_generation_id = r.generation_id
       WHERE r.project_id = ? AND r.project_version_id = ?
         AND r.run_id IN (${placeholders})`,
    )
    .all(
      projectId,
      toStorageProjectVersionId(projectVersionId),
      ...runIds,
    );
  return new Map(rows.map((row) => [row.run_id, row]));
}

function runSurfaceRow(
  db: Database.Database,
  projectId: string,
  projectVersionId: string | null,
  runId: string,
): RunSurfaceRow | null {
  return runSurfaceRows(db, projectId, projectVersionId, [runId]).get(runId) ?? null;
}

function cachedLogLines(row: RunSurfaceRow): CachedLogLine[] {
  const raw = object(parseJson(row.raw));
  const jobs = Array.isArray(raw?.jobs) ? raw.jobs : [];
  const at = row.finished_at ?? row.started_at ?? row.synced_at;
  const lines: CachedLogLine[] = [];
  for (const candidate of jobs) {
    const job = object(candidate);
    if (!job || !Array.isArray(job.logTail)) continue;
    for (const value of job.logTail) {
      if (typeof value !== "string") continue;
      lines.push({
        sequence: lines.length,
        at,
        level: "stdout",
        text: value.slice(0, 20_000),
      });
    }
  }
  return lines;
}

function decodeLogCursor(value: string | null, runId: string): number {
  if (value === null) return 0;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new Error("INVALID_BENCH_LOG_CONTINUATION");
  }
  const cursor = object(parsed);
  if (cursor?.runId !== runId || !Number.isSafeInteger(cursor.after) || Number(cursor.after) < 0) {
    throw new Error("INVALID_BENCH_LOG_CONTINUATION");
  }
  return Number(cursor.after);
}

function encodeLogCursor(runId: string, after: number): string {
  return Buffer.from(JSON.stringify({ runId, after }), "utf8").toString("base64url");
}

function uniqueRunRowById(db: Database.Database, runId: string): RunSurfaceRow | null {
  if (!SAFE_ID.test(runId)) return null;
  const rows = db
    .prepare<[string], RunSurfaceRow>(
      `SELECT r.run_id, r.project_id, r.project_version_id, r.kind, r.trigger,
              r.host_id, r.thread_id, r.config, r.duration_ms, r.log_locator,
              r.log_cursor, r.raw, r.started_at, r.finished_at, r.synced_at
       FROM verification_runs r
       JOIN sync_state s
         ON s.project_id = r.project_id
        AND s.project_version_id = r.project_version_id
        AND s.entity_kind = 'verificationRun'
        AND s.accepted_generation_id = r.generation_id
       WHERE r.run_id = ?
       LIMIT 2`,
    )
    .all(runId);
  return rows.length === 1 ? rows[0]! : null;
}

function downloadHeaders(filename: string, mediaType: string): Headers {
  return new Headers({
    "Content-Type": mediaType,
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
}

export interface BenchCommandServices {
  storeEvidenceCheckpoint(bundle: BenchEvidenceBundle): void;
  runBench: typeof runBench;
}

export function createBenchCommandServices(
  bb: BbPluginApi,
  db: Database.Database,
): BenchCommandServices {
  return {
    storeEvidenceCheckpoint(bundle) {
      const change = storeEvidenceCheckpointWithResult(db, bundle);
      if (change.changed) {
        bb.realtime.publish("bench:changed", {
          runId: change.runId,
          status: change.status,
        });
      }
    },
    runBench,
  };
}

export function registerBench(bb: BbPluginApi, ctx: PluginContext): void {
  const db = ctx.db();
  const jobQueue = ctx.service("bench.job-queue", () => new InMemoryBenchJobQueue());
  ctx.service("bench.command-services", () => createBenchCommandServices(bb, db));

  bb.rpc.register(benchRpcContract, {
    benchRunsList(input) {
      const projectVersionId = input.projectVersionId ??
        acceptedBenchProjectVersionId(db, input.projectId);
      if (projectVersionId === null) {
        return {
          items: [],
          total: 0,
          next: null,
          cache: {
            state: "empty" as const,
            asOf: null,
            message: null,
            acceptedGenerationId: null,
            baseRevision: 0,
          },
        };
      }
      const page = listBenchRuns(db, {
        projectId: input.projectId,
        pvId: projectVersionId,
        pageSize: input.pageSize,
        continuation: input.continuation,
      });
      const surface = runSurfaceRows(
        db,
        input.projectId,
        projectVersionId,
        page.items.map((run) => run.runId),
      );
      return {
        items: page.items.map((run) => {
          const stored = surface.get(run.runId) ?? null;
          return {
            projectId: run.projectId,
            projectVersionId: run.pvId,
            kind: "verificationRun",
            key: run.runId,
            label: `${run.tier} ${run.status}`,
            fields: {
              tier: run.tier,
              matrixTier: run.matrixTier,
              status: run.status,
              target: run.target,
              firmwareDigest: run.firmwareDigest,
              jobId: run.jobId,
              startedAt: run.startedAt,
              finishedAt: run.finishedAt,
              syncedAt: run.syncedAt,
              kind: stored?.kind ?? "bench",
              trigger: stored?.trigger ?? null,
              hostId: stored?.host_id ?? null,
              threadId: stored?.thread_id ?? null,
              config: parseJson(stored?.config ?? null),
              durationMs: stored?.duration_ms ?? null,
              logAvailable:
                stored !== null &&
                (stored.log_locator !== null || cachedLogLines(stored).length > 0),
              logCursor: stored?.log_cursor ?? null,
            },
          };
        }),
        total: page.total,
        next: page.next,
        cache: page.cache,
      };
    },
    benchRunGet(input) {
      const projectVersionId = runProjectVersionId(
        db,
        input.projectId,
        input.projectVersionId,
        input.runId,
      );
      if (projectVersionId === null) throw new Error(`BENCH_RUN_NOT_FOUND: ${input.runId}`);
      const detail = getBenchRun(db, {
        projectId: input.projectId,
        pvId: projectVersionId,
        runId: input.runId,
      });
      if (!detail) throw new Error(`BENCH_RUN_NOT_FOUND: ${input.runId}`);
      const pageQuery = {
        projectId: input.projectId,
        pvId: projectVersionId,
        runId: input.runId,
        pageSize: 50,
        continuation: null,
      } as const;
      const results = listBenchResults(db, pageQuery);
      const artifacts = listBenchArtifacts(db, pageQuery);
      const attestations = listBenchAttestations(db, pageQuery);
      const stored = runSurfaceRow(
        db,
        input.projectId,
        projectVersionId,
        input.runId,
      );
      return {
        projectId: detail.run.projectId,
        projectVersionId: detail.run.pvId,
        kind: "verificationRun",
        key: detail.run.runId,
        label: `${detail.run.tier} ${detail.run.status}`,
        fields: {
          tier: detail.run.tier,
          matrixTier: detail.run.matrixTier,
          status: detail.run.status,
          target: detail.run.target,
          firmwareDigest: detail.run.firmwareDigest,
          jobId: detail.run.jobId,
          startedAt: detail.run.startedAt,
          finishedAt: detail.run.finishedAt,
          kind: stored?.kind ?? "bench",
          trigger: stored?.trigger ?? null,
          hostId: stored?.host_id ?? null,
          threadId: stored?.thread_id ?? null,
          config: parseJson(stored?.config ?? null),
          durationMs: stored?.duration_ms ?? null,
          logAvailable:
            stored !== null &&
            (stored.log_locator !== null || cachedLogLines(stored).length > 0),
          logCursor: stored?.log_cursor ?? null,
          results: results.items,
          resultsTotal: results.total,
          resultsNext: results.next,
          artifacts: artifacts.items.map((artifact) => ({
            name: artifact.name,
            kind: artifact.kind,
            sha256: artifact.sha256,
            bytes: artifact.bytes,
            // The generic WP-52 logical-locator byte adapter is follow-up gated.
            // Keep its locator server-side and render honest recovery meanwhile.
            downloadAvailable: false,
          })),
          artifactsTotal: artifacts.total,
          artifactsNext: artifacts.next,
          attestations: attestations.items,
          attestationsTotal: attestations.total,
          attestationsNext: attestations.next,
        },
        links: [],
        cache: detail.cache,
      };
    },
    benchLogsList(input) {
      const runId = frozenBenchLogRunId(input);
      const projectVersionId = runProjectVersionId(
        db,
        input.projectId,
        input.projectVersionId,
        runId,
      );
      if (projectVersionId === null) throw new Error(`BENCH_RUN_NOT_FOUND: ${runId}`);
      const row = runSurfaceRow(
        db,
        input.projectId,
        projectVersionId,
        runId,
      );
      if (!row) throw new Error(`BENCH_RUN_NOT_FOUND: ${runId}`);
      const lines = cachedLogLines(row);
      const offset = decodeLogCursor(input.continuation, runId);
      const items = lines.slice(offset, offset + input.pageSize);
      const after = offset + items.length;
      const detail = getBenchRun(db, {
        projectId: input.projectId,
        pvId: projectVersionId,
        runId,
      });
      if (!detail) throw new Error(`BENCH_RUN_NOT_FOUND: ${runId}`);
      return {
        items: items.map((line) => ({
          projectId: input.projectId,
          projectVersionId,
          ...line,
        })),
        total: lines.length,
        next: after < lines.length ? encodeLogCursor(runId, after) : null,
        cache: {
          ...detail.cache,
          message:
            lines.length === 0 && row.log_locator !== null
              ? "The complete log has a logical locator, but no approved byte adapter is available. Open the native run thread."
              : detail.cache.message,
        },
      };
    },
    benchVerdictGet() {
      return getOtaVerdict();
    },
    async benchRunStart(input) {
      if (input.projectVersionId === null) {
        throw new Error("BENCH_PROJECT_VERSION_REQUIRED");
      }
      const request = {
        projectId: input.projectId,
        pvId: input.projectVersionId,
        tier: input.tier,
        hostId: input.hostId,
        ...(input.requirementId ? { requirementId: input.requirementId } : {}),
        ...(input.target ? { target: input.target } : {}),
        ...(input.deploymentContext ? { deploymentContext: input.deploymentContext } : {}),
      };
      const remote = ctx.service<RemoteServices>("remote-services", () => {
        throw new Error("REMOTE_SERVICES_NOT_REGISTERED");
      });
      const started = await runBench(
        createDefaultBenchExecutionDeps(ctx, request, remote, jobQueue),
        request,
        new AbortController().signal,
      );
      return {
        projectId: input.projectId,
        projectVersionId: input.projectVersionId,
        runId: started.runId,
        threadId: started.threadId,
        jobIds: started.jobIds,
        firmwareSha256: started.firmwareDigest,
        status: started.status,
      };
    },
    async benchHostsList(input) {
      const hosts = await listBenchHosts(bb);
      const offset = input.continuation === null
        ? 0
        : Number.parseInt(Buffer.from(input.continuation, "base64url").toString("utf8"), 10);
      if (!Number.isSafeInteger(offset) || offset < 0) {
        throw new Error("INVALID_BENCH_HOST_CONTINUATION");
      }
      const remote = ctx.service<RemoteServices>("remote-services", () => {
        throw new Error("REMOTE_SERVICES_NOT_REGISTERED");
      });
      const items = await probeBenchHostCapabilities(
        hosts.slice(offset, offset + input.pageSize),
        createSdkBenchHostProbe(bb, {
          workspacePath: null,
          forgeCompute: remote.forgeCompute !== null,
        }),
        new AbortController().signal,
      );
      const nextOffset = offset + items.length;
      return {
        items: items.map((host) => ({
          id: host.id,
          name: host.name,
          status: host.connected ? "connected" : "disconnected",
          capabilities: host.capabilities,
          lastSeenAt: host.lastSeenAt,
        })),
        total: hosts.length,
        next:
          nextOffset < hosts.length
            ? Buffer.from(String(nextOffset), "utf8").toString("base64url")
            : null,
        cache: {
          state: "fresh" as const,
          asOf: new Date().toISOString(),
          message: null,
          acceptedGenerationId: null,
          baseRevision: 0,
        },
      };
    },
    benchHostsJoinCode() {
      return createBenchHostJoinCode(bb);
    },
  });

  bb.http.route("GET", "/bench/runs/log", async (http) => {
    const runId = queryRunId(http.req.query("runId"));
    if (runId === null) return streamUnavailable("A valid runId query parameter is required.", 400);
    const row = uniqueRunRowById(db, runId);
    if (!row) return streamUnavailable("Run log is unknown or ambiguous.", 404);
    if (row.log_locator !== null) {
      const persisted = await readPersistedBenchLog(bb.storage.kv, row.log_locator);
      if (persisted) {
        const headers = downloadHeaders(`${runId}.cached.log`, "text/plain; charset=utf-8");
        headers.set("X-BB-Log-Completeness", "cached-tail");
        return new Response(persisted.text, { status: 206, headers });
      }
    }
    const lines = cachedLogLines(row);
    if (lines.length === 0) {
      return streamUnavailable(
        row.log_locator === null
          ? "No cached log or complete logical log locator is recorded. Open the native run thread."
          : "The complete logical log locator has no approved byte adapter. Open the native run thread.",
      );
    }
    const body = `${lines.map((line) => line.text).join("\n")}\n`;
    const headers = downloadHeaders(`${runId}.cached.log`, "text/plain; charset=utf-8");
    headers.set("X-BB-Log-Completeness", "cached-tail");
    return new Response(body, { status: 206, headers });
  }, { auth: "local" });
  bb.http.route("GET", "/bench/runs/artifact", async (http) => {
    const runId = queryRunId(http.req.query("runId"));
    const artifactName = queryArtifactName(http.req.query("artifactName"));
    if (runId === null || artifactName === null) {
      return streamUnavailable("Valid runId and artifactName query parameters are required.", 400);
    }
    const row = uniqueRunRowById(db, runId);
    if (!row) {
      return streamUnavailable("Artifact is unknown or has an unsafe logical name.", 404);
    }
    const artifact = db
      .prepare<[string, string, string, string], ArtifactStreamRow>(
        `SELECT a.name, a.kind, a.sha256, a.bytes
         FROM verification_artifacts a
         JOIN sync_state s
           ON s.project_id = a.project_id
          AND s.project_version_id = a.project_version_id
          AND s.entity_kind = 'verificationRun'
          AND s.accepted_generation_id = a.generation_id
         WHERE a.project_id = ? AND a.project_version_id = ?
           AND a.run_id = ? AND a.name = ?
         LIMIT 1`,
      )
      .get(row.project_id, row.project_version_id, runId, artifactName);
    if (!artifact) return streamUnavailable("Artifact metadata is no longer available.", 404);
    return streamUnavailable(
      `Artifact ${artifact.name} (${artifact.kind}) has verified metadata but its logical locator has no approved byte adapter. Refresh evidence to recover it.`,
    );
  }, { auth: "local" });
  bb.http.route("GET", "/bench/runs/attestation", async (http) => {
    const runId = queryRunId(http.req.query("runId"));
    if (runId === null) return streamUnavailable("A valid runId query parameter is required.", 400);
    const row = uniqueRunRowById(db, runId);
    if (!row) return streamUnavailable("Attestation is unknown or ambiguous.", 404);
    const attestation = db
      .prepare<[string, string, string], AttestationStreamRow>(
        `SELECT a.format, a.payload
         FROM attestations a
         JOIN sync_state s
           ON s.project_id = a.project_id
          AND s.project_version_id = a.project_version_id
          AND s.entity_kind = 'verificationRun'
          AND s.accepted_generation_id = a.generation_id
         WHERE a.project_id = ? AND a.project_version_id = ? AND a.run_id = ?
         ORDER BY a.pulled_at DESC LIMIT 1`,
      )
      .get(row.project_id, row.project_version_id, runId);
    if (!attestation) return streamUnavailable("No attestation envelope is recorded.", 404);
    return new Response(attestation.payload, {
      headers: downloadHeaders(
        `${runId}.${attestation.format}.json`,
        "application/json; charset=utf-8",
      ),
    });
  }, { auth: "local" });
  bb.background.service("bench-jobs", {
    start: (signal) => runBenchJobService(jobQueue, signal),
  });
}
