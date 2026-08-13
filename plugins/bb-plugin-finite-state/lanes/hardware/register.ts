import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { defineRpcContract, type BbPluginApi } from "@bb/plugin-sdk";
import type Database from "better-sqlite3";
import { z } from "zod";
import type { PluginContext } from "../../lib/context.js";
import { toStorageProjectVersionId } from "../../lib/store/index.js";
import { rpcContract } from "../../shared/contract.js";
import {
  assertRelativeProjectPath,
  resolveHardwareProjectSource,
  scanProjectsFromSource,
  worktreeIncludeHint,
  type HardwareProjectSource,
  type KicadProjectRow,
} from "./discovery.js";
import {
  ALL_HW_ARTIFACT_KINDS,
  runExtractCached,
  type ExtractResult,
} from "./extract/cache.js";
import { detectKicadCli, type HwArtifactKind, type KicadCapability } from "./extract/driver.js";
import { listArtifactStatus } from "./extract/provenance.js";
import { HardwareSourceWatcher } from "./extract/watch.js";
import { hardwareViolationsNotImplemented } from "./fab/violations.js";
import {
  hardwareConnectivityGapsRpcContract,
  ingestProject,
  listConnectivityGaps,
  semanticIngestRequired,
} from "./parse/ingest.js";
import { listHardwareSheets, parseProjectGeneration } from "./parse/sheets.js";
import { getHardwarePart, listHardwareNets, listHardwareSymbols } from "./search.js";

const hardwareRpcContract = {
  hardwareProjectsList: rpcContract.hardwareProjectsList,
  hardwareSymbolsList: rpcContract.hardwareSymbolsList,
  hardwareNetsList: rpcContract.hardwareNetsList,
  hardwareViolationsList: rpcContract.hardwareViolationsList,
  hardwareSheetsList: rpcContract.hardwareSheetsList,
  hardwarePartGet: rpcContract.hardwarePartGet,
  hardwareArtifactsStatus: rpcContract.hardwareArtifactsStatus,
  hardwareExtractStart: rpcContract.hardwareExtractStart,
  hardwareExtractStatus: rpcContract.hardwareExtractStatus,
} as const;

const projectScopeSchema = {
  projectId: z.string().trim().min(1).max(512),
  projectVersionId: z.string().trim().min(1).max(512).nullable(),
};
const discoveryStatusSchema = z.object({
  ...projectScopeSchema,
  state: z.enum(["idle", "queued", "refreshing", "ready", "degraded"]),
  message: z.string().max(500).nullable(),
  worktreeincludeHint: z.string().max(500).nullable(),
  truncated: z.boolean(),
}).strict();

export const hardwareDiscoveryRpcContract = defineRpcContract({
  hardwareDiscoveryRefresh: {
    input: z.object(projectScopeSchema).strict(),
    output: discoveryStatusSchema,
  },
  hardwareDiscoveryStatus: {
    input: z.object(projectScopeSchema).strict(),
    output: discoveryStatusSchema,
  },
});

type DiscoveryStatus = z.infer<typeof discoveryStatusSchema>;

interface HardwareProjectDbRow {
  project_id: string;
  project_version_id: string;
  project_key: string;
  name: string;
  sch_path: string;
  pcb_path: string | null;
  sch_hash: string;
  pcb_hash: string | null;
  kicad_version: string | null;
  supported: number;
  discovered_at: string;
}

interface HardwareExtractJob {
  projectId: string;
  projectVersionId: string | null;
  jobId: string;
  projectKey: string;
  state: "queued" | "running" | "completed" | "failed" | "cancelled";
  produced: Array<{
    projectKey: string;
    kind: HwArtifactKind;
    sheetPath: string | null;
    path: string;
    sourceSha256: string;
    cliVersion: string | null;
    generatedAt: string;
    fresh: boolean;
  }>;
  failures: Array<{ kind: HwArtifactKind; exitCode: number | null; message: string }>;
  startedAt: string | null;
  finishedAt: string | null;
}

function storageVersion(projectVersionId: string | null): string {
  return toStorageProjectVersionId(projectVersionId);
}

function upsertProjects(
  db: Database.Database,
  projectId: string,
  projectVersionId: string | null,
  projects: KicadProjectRow[],
  complete = true,
): void {
  const pv = storageVersion(projectVersionId);
  const statement = db.prepare(
    `INSERT INTO hw_project (
       project_id, project_version_id, project_key, name, sch_path, pcb_path,
       sch_hash, pcb_hash, kicad_version, supported, discovered_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, project_version_id, project_key) DO UPDATE SET
       name = excluded.name, sch_path = excluded.sch_path, pcb_path = excluded.pcb_path,
       sch_hash = excluded.sch_hash, pcb_hash = excluded.pcb_hash,
       kicad_version = excluded.kicad_version, supported = excluded.supported,
       discovered_at = excluded.discovered_at`,
  );
  db.transaction(() => {
    const discoveredKeys = new Set(projects.map((project) => project.projectKey));
    const existing = db.prepare<[string, string], { project_key: string }>(
      `SELECT project_key FROM hw_project WHERE project_id = ? AND project_version_id = ?`,
    ).all(projectId, pv);
    const remove = db.prepare(
      `DELETE FROM hw_project WHERE project_id = ? AND project_version_id = ? AND project_key = ?`,
    );
    if (complete) {
      for (const row of existing) {
        if (!discoveredKeys.has(row.project_key)) remove.run(projectId, pv, row.project_key);
      }
    }
    for (const project of projects) statement.run(
      projectId, pv, project.projectKey, project.name, project.schPath, project.pcbPath,
      project.schSha256, project.pcbSha256, project.kicadVersion,
      project.supported ? 1 : 0, project.discoveredAt,
    );
  })();
}

function projectOutput(row: HardwareProjectDbRow) {
  return {
    projectId: row.project_id,
    projectVersionId: row.project_version_id === "@project" ? null : row.project_version_id,
    projectKey: row.project_key,
    name: row.name,
    schPath: row.sch_path,
    pcbPath: row.pcb_path,
    schSha256: row.sch_hash,
    pcbSha256: row.pcb_hash,
    kicadVersion: row.kicad_version,
    supported: row.supported === 1,
    discoveredAt: row.discovered_at,
  };
}

function cursorOffset(cursor: string | null): number {
  if (cursor === null) return 0;
  const offset = Number(Buffer.from(cursor, "base64url").toString("utf8"));
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("HW_CURSOR_INVALID");
  return offset;
}

const SAFE_DETAIL_MAX_LENGTH = 500;
const TRUNCATION_MARKER = "\n[diagnostic truncated; tail shown]";

export function safeHardwareDetail(value: string): string {
  const scrubbed = value
    .replace(/\bauthorization\b[^\r\n]*/giu, "[credential redacted]")
    .replace(/bearer\s+\S+/giu, "[credential redacted]")
    .replace(/api[_-]?key\s*[:=]\s*\S+/giu, "[credential redacted]")
    .replace(/token\s*=\s*[^\s&]+/giu, "[credential redacted]")
    .replace(/https?:\/\/\S+/giu, (url) => url.includes("?") || url.includes("@") ? "[credentialed URL redacted]" : url);
  if (scrubbed.length <= SAFE_DETAIL_MAX_LENGTH) return scrubbed;
  return `${scrubbed.slice(-(SAFE_DETAIL_MAX_LENGTH - TRUNCATION_MARKER.length))}${TRUNCATION_MARKER}`;
}

function errorDetail(error: unknown): string {
  return safeHardwareDetail(error instanceof Error ? error.message : String(error));
}

async function waitForWake(
  signal: AbortSignal,
  setWake: (wake: (() => void) | null) => void,
): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    let settled = false;
    const wake = () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", wake);
      setWake(null);
      resolve();
    };
    setWake(wake);
    signal.addEventListener("abort", wake, { once: true });
    if (signal.aborted) wake();
  });
}

interface DiscoveryScope {
  projectId: string;
  projectVersionId: string | null;
}

interface RefreshedDiscovery {
  source: HardwareProjectSource;
  projects: KicadProjectRow[];
}

class HardwareDiscoveryCoordinator {
  readonly #ctx: PluginContext;
  readonly #watchers: Map<string, HardwareSourceWatcher>;
  readonly #queue: DiscoveryScope[] = [];
  readonly #queued = new Set<string>();
  readonly #statuses = new Map<string, DiscoveryStatus>();
  #wake: (() => void) | null = null;

  constructor(ctx: PluginContext, watchers: Map<string, HardwareSourceWatcher>) {
    this.#ctx = ctx;
    this.#watchers = watchers;
  }

  #key(scope: DiscoveryScope): string {
    return `${scope.projectId}\0${storageVersion(scope.projectVersionId)}`;
  }

  status(scope: DiscoveryScope): DiscoveryStatus {
    return structuredClone(this.#statuses.get(this.#key(scope)) ?? {
      ...scope,
      state: "idle",
      message: null,
      worktreeincludeHint: null,
      truncated: false,
    });
  }

  enqueue(scope: DiscoveryScope): DiscoveryStatus {
    const key = this.#key(scope);
    if (!this.#queued.has(key) && this.#statuses.get(key)?.state !== "refreshing") {
      this.#queued.add(key);
      this.#queue.push(scope);
      this.#statuses.set(key, {
        ...scope,
        state: "queued",
        message: null,
        worktreeincludeHint: this.#statuses.get(key)?.worktreeincludeHint ?? null,
        truncated: this.#statuses.get(key)?.truncated ?? false,
      });
      this.#wake?.();
    }
    return this.status(scope);
  }

  async refreshNow(scope: DiscoveryScope): Promise<RefreshedDiscovery> {
    return this.#refresh(scope);
  }

  async start(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      const scope = this.#queue.shift();
      if (scope) {
        this.#queued.delete(this.#key(scope));
        try { await this.#refresh(scope); } catch { /* status records the degraded result */ }
        continue;
      }
      await waitForWake(signal, (wake) => { this.#wake = wake; });
    }
  }

  async #refresh(scope: DiscoveryScope): Promise<RefreshedDiscovery> {
    const key = this.#key(scope);
    this.#statuses.set(key, {
      ...scope,
      state: "refreshing",
      message: null,
      worktreeincludeHint: this.#statuses.get(key)?.worktreeincludeHint ?? null,
      truncated: false,
    });
    try {
      const source = await resolveHardwareProjectSource(this.#ctx.bb, scope.projectId);
      const scan = await scanProjectsFromSource(this.#ctx.bb, source);
      upsertProjects(this.#ctx.db(), scope.projectId, scope.projectVersionId, scan.projects, !scan.truncated);
      const semanticFailures: string[] = [];
      for (const project of scan.projects) {
        if (!project.supported) continue;
        try {
          const semanticScope = {
            projectId: scope.projectId,
            projectVersionId: scope.projectVersionId,
            projectKey: project.projectKey,
          };
          const generation = await parseProjectGeneration(source.path, project.projectKey);
          if (!semanticIngestRequired(this.#ctx.db(), semanticScope, generation.sourceHash)) continue;
          ingestProject(this.#ctx.db(), semanticScope, generation.sourceHash, generation.parsed);
        } catch (error) {
          const detail = `${project.projectKey}: ${errorDetail(error)}`;
          semanticFailures.push(detail);
          this.#ctx.bb.log.warn(`hardware semantic ingest degraded: ${detail}`);
        }
      }
      const hint = await worktreeIncludeHint(source.path, scan.projects);
      this.#replaceWatchers(scope, source, scan.projects);
      const semanticMessage = semanticFailures.length > 0
        ? safeHardwareDetail(
          `HW_SEMANTIC_INGEST_FAILED: ${semanticFailures[0]}` +
          (semanticFailures.length > 1 ? ` (${semanticFailures.length - 1} more project failures)` : ""),
        )
        : null;
      this.#statuses.set(key, {
        ...scope,
        state: scan.truncated || semanticMessage !== null ? "degraded" : "ready",
        message: scan.truncated
          ? "HW_DISCOVERY_PARTIAL: the workspace path limit was reached; cached projects are a truthful partial result"
          : semanticMessage,
        worktreeincludeHint: hint,
        truncated: scan.truncated,
      });
      this.#ctx.bb.realtime.publish("hardware:changed", { projectId: scope.projectId });
      return { source, projects: scan.projects };
    } catch (error) {
      this.#statuses.set(key, {
        ...scope,
        state: "degraded",
        message: errorDetail(error),
        worktreeincludeHint: null,
        truncated: false,
      });
      this.#ctx.bb.realtime.publish("hardware:changed", { projectId: scope.projectId });
      throw error;
    }
  }

  #replaceWatchers(
    scope: DiscoveryScope,
    source: HardwareProjectSource,
    projects: KicadProjectRow[],
  ): void {
    const scopePrefix = `${this.#key(scope)}\0`;
    for (const [watcherKey, watcher] of this.#watchers) {
      if (watcherKey.startsWith(scopePrefix)) {
        watcher.stop();
        this.#watchers.delete(watcherKey);
      }
    }
    for (const project of projects) {
      const watcherKey = `${scopePrefix}${project.projectKey}`;
      const watcher = new HardwareSourceWatcher({
        schematicPath: resolve(source.path, project.schPath),
        boardPath: project.pcbPath ? resolve(source.path, project.pcbPath) : null,
        onChange: () => { this.enqueue(scope); },
        onError: (error) => {
          this.#ctx.bb.log.warn(`hardware source watch degraded: ${safeHardwareDetail(error.message)}`);
          this.enqueue(scope);
        },
      });
      try {
        watcher.start();
        this.#watchers.set(watcherKey, watcher);
      } catch {
        // Remote sources remain refreshable through the explicit refresh action.
      }
    }
  }
}

class HardwareExtractCoordinator {
  readonly #ctx: PluginContext;
  readonly #capability: Promise<KicadCapability>;
  readonly #discovery: HardwareDiscoveryCoordinator;
  readonly #jobs = new Map<string, HardwareExtractJob>();
  readonly #queue: Array<{ job: HardwareExtractJob; kinds: HwArtifactKind[]; force: boolean }> = [];
  #wake: (() => void) | null = null;
  static readonly MAX_RETAINED_JOBS = 128;

  constructor(
    ctx: PluginContext,
    capability: Promise<KicadCapability>,
    discovery: HardwareDiscoveryCoordinator,
  ) {
    this.#ctx = ctx;
    this.#capability = capability;
    this.#discovery = discovery;
  }

  enqueue(input: {
    projectId: string;
    projectVersionId: string | null;
    projectKey: string;
    kinds?: HwArtifactKind[];
    force: boolean;
  }): HardwareExtractJob {
    assertRelativeProjectPath(input.projectKey);
    if (this.#jobs.size >= HardwareExtractCoordinator.MAX_RETAINED_JOBS) {
      const evictable = [...this.#jobs].find(([, candidate]) =>
        candidate.state === "completed" || candidate.state === "failed" || candidate.state === "cancelled");
      if (!evictable) throw new Error("HW_EXTRACT_QUEUE_FULL: too many active extraction jobs");
      this.#jobs.delete(evictable[0]);
    }
    const job: HardwareExtractJob = {
      projectId: input.projectId,
      projectVersionId: input.projectVersionId,
      jobId: randomUUID(),
      projectKey: input.projectKey,
      state: "queued",
      produced: [], failures: [], startedAt: null, finishedAt: null,
    };
    this.#jobs.set(job.jobId, job);
    this.#queue.push({ job, kinds: input.kinds ?? [...ALL_HW_ARTIFACT_KINDS], force: input.force });
    this.#wake?.();
    return structuredClone(job);
  }

  status(jobId: string, scope?: { projectId: string; projectVersionId: string | null }): HardwareExtractJob {
    const job = this.#jobs.get(jobId);
    if (
      !job ||
      (scope !== undefined &&
        (job.projectId !== scope.projectId || job.projectVersionId !== scope.projectVersionId))
    ) {
      throw new Error(`HW_EXTRACT_JOB_NOT_FOUND: ${jobId}`);
    }
    return structuredClone(job);
  }

  async start(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      const next = this.#queue.shift();
      if (next) {
        if (next.job.state === "queued") await this.#run(next.job, next.kinds, next.force);
        continue;
      }
      await waitForWake(signal, (wake) => { this.#wake = wake; });
    }
  }

  async #run(job: HardwareExtractJob, kinds: HwArtifactKind[], force: boolean): Promise<void> {
    job.state = "running";
    job.startedAt = new Date().toISOString();
    try {
      const { source } = await this.#discovery.refreshNow({
        projectId: job.projectId,
        projectVersionId: job.projectVersionId,
      });
      const result = await runExtractCached(source.path, job.projectKey, kinds, {
        db: this.#ctx.db(),
        scope: {
          projectId: job.projectId,
          projectVersionId: storageVersion(job.projectVersionId),
          projectKey: job.projectKey,
        },
        capability: await this.#capability,
      }, { force });
      this.#applyResult(job, result);
      job.state = "completed";
    } catch (error) {
      job.state = "failed";
      const affectedKinds = kinds.length > 0 ? [...new Set(kinds)] : [...ALL_HW_ARTIFACT_KINDS];
      job.failures.push(...affectedKinds.map((kind) => ({
        kind,
        exitCode: null,
        message: errorDetail(error),
      })));
    } finally {
      job.finishedAt = new Date().toISOString();
      this.#ctx.bb.realtime.publish("hardware:changed", { projectKey: job.projectKey });
    }
  }

  #applyResult(job: HardwareExtractJob, result: ExtractResult): void {
    job.produced = result.produced.map((artifact) => ({
      projectKey: artifact.projectKey,
      kind: artifact.kind,
      sheetPath: artifact.sheetPath,
      path: artifact.path,
      sourceSha256: artifact.sourceHash,
      cliVersion: artifact.cliVersion,
      generatedAt: artifact.generatedAt,
      fresh: artifact.fresh,
    }));
    job.failures = result.failures.map((failure) => ({
      kind: failure.kind,
      exitCode: failure.exitCode,
      message: safeHardwareDetail(failure.stderr),
    }));
  }
}

export interface HardwareExtractActionService {
  start(input: Parameters<HardwareExtractCoordinator["enqueue"]>[0]): HardwareExtractJob;
  status(jobId: string): HardwareExtractJob;
}

export function createHardwareCommandHandlers(ctx: PluginContext): HardwareExtractActionService {
  return ctx.service("hardware.extract.action", () => {
    throw new Error("Hardware extraction services are not registered");
  });
}

export function registerHardware(bb: BbPluginApi, ctx: PluginContext): void {
  const db = ctx.db();
  let disposed = false;
  const capability = ctx.service("hardware.kicad-capability", () => detectKicadCli());
  void capability
    .then((value) => {
      if (disposed) return;
      if (!value.installed) {
        ctx.log.warn(
          "Hardware extraction advisory: KiCad 7+ is unavailable on this host. Hardware extraction is disabled; other plugin lanes remain available.",
        );
      } else if (!value.supported) {
        ctx.log.warn(
          `Hardware extraction advisory: KiCad 7+ is required; detected ${value.version ?? "an unreadable version"}. Hardware extraction is disabled; other plugin lanes remain available.`,
        );
      }
    })
    .catch((error: unknown) => {
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : "unknown error";
      if (error instanceof Error && error.name === "PluginContextStaleError") {
        ctx.log.warn(`Ignored stale KiCad capability status callback: ${detail}`);
        return;
      }
      ctx.log.error(`KiCad capability detection failed: ${detail}`);
    });
  const watchers = ctx.service("hardware.source-watchers", () => new Map<string, HardwareSourceWatcher>());
  const discovery = ctx.service("hardware.discovery-coordinator", () =>
    new HardwareDiscoveryCoordinator(ctx, watchers));
  const coordinator = ctx.service("hardware.extract-coordinator", () =>
    new HardwareExtractCoordinator(ctx, capability, discovery));
  ctx.service<HardwareExtractActionService>("hardware.extract.action", () => ({
    start: (input) => coordinator.enqueue(input),
    status: (jobId) => coordinator.status(jobId),
  }));
  ctx.service("hardware.command-services", () => createHardwareCommandHandlers(ctx));
  bb.onDispose(() => {
    disposed = true;
    for (const watcher of watchers.values()) watcher.stop();
    watchers.clear();
  });
  bb.background.service("hardware-extraction", {
    start: (signal) => coordinator.start(signal),
  });
  bb.background.service("hardware-discovery", {
    start: (signal) => discovery.start(signal),
  });

  bb.rpc.register(hardwareDiscoveryRpcContract, {
    hardwareDiscoveryRefresh(input) { return discovery.enqueue(input); },
    hardwareDiscoveryStatus(input) { return discovery.status(input); },
  });

  bb.rpc.register(hardwareConnectivityGapsRpcContract, {
    hardwareConnectivityGapsList(input) { return listConnectivityGaps(db, input); },
  });

  bb.rpc.register(hardwareRpcContract, {
    hardwareProjectsList(input) {
      const pv = storageVersion(input.projectVersionId);
      // The frozen cursorPagedScopedInput helper validates `query` at runtime but
      // loses additive shape keys in its TypeScript return type. Narrow once at
      // this RPC boundary until the next contract-version amendment.
      const requestedQuery = (input as typeof input & { query?: string }).query;
      const query = requestedQuery ? `%${requestedQuery.replace(/[\\%_]/gu, "\\$&")}%` : "%";
      const total = db.prepare<[string, string, string, string], { count: number }>(
        `SELECT COUNT(*) AS count FROM hw_project
          WHERE project_id = ? AND project_version_id = ? AND (name LIKE ? ESCAPE '\\' OR project_key LIKE ? ESCAPE '\\')`,
      ).get(input.projectId, pv, query, query)?.count ?? 0;
      const offset = cursorOffset(input.cursor);
      const rows = db.prepare<[string, string, string, string, number, number], HardwareProjectDbRow>(
        `SELECT * FROM hw_project
          WHERE project_id = ? AND project_version_id = ? AND (name LIKE ? ESCAPE '\\' OR project_key LIKE ? ESCAPE '\\')
          ORDER BY project_key LIMIT ? OFFSET ?`,
      ).all(input.projectId, pv, query, query, input.pageSize, offset);
      const nextOffset = offset + rows.length;
      return { items: rows.map(projectOutput), total, cursor: nextOffset < total ? Buffer.from(String(nextOffset)).toString("base64url") : null };
    },
    hardwareSymbolsList(input) { return listHardwareSymbols(db, input); },
    hardwareNetsList(input) { return listHardwareNets(db, input); },
    hardwareViolationsList() { return hardwareViolationsNotImplemented(); },
    hardwareSheetsList(input) { return listHardwareSheets(db, input); },
    hardwarePartGet(input) { return getHardwarePart(db, input); },
    async hardwareArtifactsStatus(input) {
      const projectKey = assertRelativeProjectPath(input.projectKey);
      const project = db.prepare<[string, string, string], HardwareProjectDbRow>(
        `SELECT * FROM hw_project
          WHERE project_id = ? AND project_version_id = ? AND project_key = ?`,
      ).get(input.projectId, storageVersion(input.projectVersionId), projectKey);
      if (!project) throw new Error(`HW_PROJECT_NOT_FOUND: ${input.projectKey}`);
      const source = await resolveHardwareProjectSource(bb, input.projectId);
      const artifacts = await listArtifactStatus(db, {
        projectId: input.projectId,
        projectVersionId: storageVersion(input.projectVersionId),
        projectKey: project.project_key,
      }, { schematic: project.sch_hash, board: project.pcb_hash }, source.path);
      return {
        projectId: input.projectId,
        projectVersionId: input.projectVersionId,
        projectKey: project.project_key,
        capability: await capability,
        artifacts: artifacts.map((artifact) => ({
          projectKey: artifact.projectKey,
          kind: artifact.kind,
          sheetPath: artifact.sheetPath,
          path: artifact.path,
          sourceSha256: artifact.sourceHash,
          cliVersion: artifact.cliVersion,
          generatedAt: artifact.generatedAt,
          fresh: artifact.fresh,
        })),
      };
    },
    hardwareExtractStart(input) { return coordinator.enqueue(input); },
    hardwareExtractStatus(input) {
      return coordinator.status(input.jobId, {
        projectId: input.projectId,
        projectVersionId: input.projectVersionId,
      });
    },
  });
}
