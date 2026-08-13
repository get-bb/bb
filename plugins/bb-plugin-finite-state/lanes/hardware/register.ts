import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { BbPluginApi } from "@bb/plugin-sdk";
import type Database from "better-sqlite3";
import type { PluginContext } from "../../lib/context.js";
import { toStorageProjectVersionId } from "../../lib/store/index.js";
import { rpcContract } from "../../shared/contract.js";
import {
  assertRelativeProjectPath,
  discoverProjectsFromSource,
  resolveHardwareProjectSource,
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
import { hardwareSheetsNotImplemented } from "./parse/sheets.js";
import { hardwareSearchNotImplemented } from "./search.js";

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
): void {
  const pv = storageVersion(projectVersionId);
  const statement = db.prepare(
    `INSERT INTO hw_project (
       project_id, project_version_id, project_key, name, sch_path, pcb_path,
       sch_hash, pcb_hash, kicad_version, discovered_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, project_version_id, project_key) DO UPDATE SET
       name = excluded.name, sch_path = excluded.sch_path, pcb_path = excluded.pcb_path,
       sch_hash = excluded.sch_hash, pcb_hash = excluded.pcb_hash,
       kicad_version = excluded.kicad_version, discovered_at = excluded.discovered_at`,
  );
  db.transaction(() => {
    const discoveredKeys = new Set(projects.map((project) => project.projectKey));
    const existing = db.prepare<[string, string], { project_key: string }>(
      `SELECT project_key FROM hw_project WHERE project_id = ? AND project_version_id = ?`,
    ).all(projectId, pv);
    const remove = db.prepare(
      `DELETE FROM hw_project WHERE project_id = ? AND project_version_id = ? AND project_key = ?`,
    );
    for (const row of existing) {
      if (!discoveredKeys.has(row.project_key)) remove.run(projectId, pv, row.project_key);
    }
    for (const project of projects) statement.run(
      projectId, pv, project.projectKey, project.name, project.schPath, project.pcbPath,
      project.schSha256, project.pcbSha256, project.kicadVersion, project.discoveredAt,
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
    discoveredAt: row.discovered_at,
  };
}

function cursorOffset(cursor: string | null): number {
  if (cursor === null) return 0;
  const offset = Number(Buffer.from(cursor, "base64url").toString("utf8"));
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("HW_CURSOR_INVALID");
  return offset;
}

class HardwareExtractCoordinator {
  readonly #ctx: PluginContext;
  readonly #capability: Promise<KicadCapability>;
  readonly #jobs = new Map<string, HardwareExtractJob>();
  readonly #queue: Array<{ job: HardwareExtractJob; kinds: HwArtifactKind[]; force: boolean }> = [];
  #wake: (() => void) | null = null;

  constructor(ctx: PluginContext, capability: Promise<KicadCapability>) {
    this.#ctx = ctx;
    this.#capability = capability;
  }

  enqueue(input: {
    projectId: string;
    projectVersionId: string | null;
    projectKey: string;
    kinds?: HwArtifactKind[];
    force: boolean;
  }): HardwareExtractJob {
    assertRelativeProjectPath(input.projectKey);
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
      await new Promise<void>((resolve) => {
        const wake = () => {
          signal.removeEventListener("abort", wake);
          this.#wake = null;
          resolve();
        };
        this.#wake = wake;
        signal.addEventListener("abort", wake, { once: true });
      });
    }
  }

  async #run(job: HardwareExtractJob, kinds: HwArtifactKind[], force: boolean): Promise<void> {
    job.state = "running";
    job.startedAt = new Date().toISOString();
    try {
      const source = await resolveHardwareProjectSource(this.#ctx.bb, job.projectId);
      const projects = await discoverProjectsFromSource(this.#ctx.bb, source);
      upsertProjects(this.#ctx.db(), job.projectId, job.projectVersionId, projects);
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
      job.failures.push({
        kind: kinds[0] ?? "sheet_svg",
        exitCode: null,
        message: error instanceof Error ? error.message : String(error),
      });
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
      message: failure.stderr,
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
  const capability = ctx.service("hardware.kicad-capability", () => detectKicadCli());
  void capability.then((value) => {
    if (!value.installed) bb.status.needsConfiguration("Install KiCad 7+ to enable hardware artifact extraction.");
    else if (!value.supported) bb.status.needsConfiguration(`KiCad 7+ is required; detected ${value.version ?? "an unreadable version"}.`);
  });
  const coordinator = ctx.service("hardware.extract-coordinator", () => new HardwareExtractCoordinator(ctx, capability));
  ctx.service<HardwareExtractActionService>("hardware.extract.action", () => ({
    start: (input) => coordinator.enqueue(input),
    status: (jobId) => coordinator.status(jobId),
  }));
  ctx.service("hardware.command-services", () => createHardwareCommandHandlers(ctx));
  const watchers = ctx.service("hardware.source-watchers", () => new Map<string, HardwareSourceWatcher>());
  bb.onDispose(() => {
    for (const watcher of watchers.values()) watcher.stop();
    watchers.clear();
  });
  bb.background.service("hardware-extraction", {
    start: (signal) => coordinator.start(signal),
  });

  async function discover(input: { projectId: string; projectVersionId: string | null }): Promise<{ source: HardwareProjectSource; projects: KicadProjectRow[] }> {
    const source = await resolveHardwareProjectSource(bb, input.projectId);
    const projects = await discoverProjectsFromSource(bb, source);
    upsertProjects(db, input.projectId, input.projectVersionId, projects);
    const scopePrefix = `${input.projectId}\0${storageVersion(input.projectVersionId)}\0`;
    const activeKeys = new Set(projects.map((project) => `${scopePrefix}${project.projectKey}`));
    for (const [key, watcher] of watchers) {
      if (key.startsWith(scopePrefix) && !activeKeys.has(key)) {
        watcher.stop();
        watchers.delete(key);
      }
    }
    for (const project of projects) {
      const key = `${scopePrefix}${project.projectKey}`;
      watchers.get(key)?.stop();
      watchers.delete(key);
      const watcher = new HardwareSourceWatcher({
        db,
        scope: { projectId: input.projectId, projectVersionId: storageVersion(input.projectVersionId), projectKey: project.projectKey },
        schematicPath: resolve(source.path, project.schPath),
        boardPath: project.pcbPath ? resolve(source.path, project.pcbPath) : null,
        publish: () => bb.realtime.publish("hardware:changed", { projectKey: project.projectKey }),
      });
      try { watcher.start(); watchers.set(key, watcher); } catch { /* remote roots are polled on RPC reads */ }
    }
    return { source, projects };
  }

  bb.rpc.register(hardwareRpcContract, {
    async hardwareProjectsList(input) {
      await discover(input);
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
    hardwareSymbolsList() { return hardwareSearchNotImplemented(); },
    hardwareNetsList() { return hardwareSearchNotImplemented(); },
    hardwareViolationsList() { return hardwareViolationsNotImplemented(); },
    hardwareSheetsList() { return hardwareSheetsNotImplemented(); },
    hardwarePartGet() { return hardwareSearchNotImplemented(); },
    async hardwareArtifactsStatus(input) {
      const { projects } = await discover(input);
      const project = projects.find((candidate) => candidate.projectKey === assertRelativeProjectPath(input.projectKey));
      if (!project) throw new Error(`HW_PROJECT_NOT_FOUND: ${input.projectKey}`);
      const artifacts = listArtifactStatus(db, {
        projectId: input.projectId,
        projectVersionId: storageVersion(input.projectVersionId),
        projectKey: project.projectKey,
      }, { schematic: project.schSha256, board: project.pcbSha256 });
      return {
        projectId: input.projectId,
        projectVersionId: input.projectVersionId,
        projectKey: project.projectKey,
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
