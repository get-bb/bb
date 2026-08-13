import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type Database from "better-sqlite3";
import {
  createBuildRun,
  getBuildRun,
  transitionBuildRun,
  type BuildRunChangedHint,
  type BuildRunRecord,
  type BuildRunScope,
  type BuildRunStore,
} from "./runs-store.js";
import {
  detectToolchains,
  resolveExecutable,
  type ToolchainContext,
  type ToolchainReport,
} from "./toolchain.js";
import { buildLogPath } from "./logs.js";
import { toStorageProjectVersionId } from "../../../lib/store/index.js";

declare const destructiveConfirmation: unique symbol;
export interface DestructiveConfirmation {
  readonly [destructiveConfirmation]: true;
}

export interface BuildPlan {
  command: readonly [string, ...string[]];
  toolchain: string;
  primaryArtifact: string;
  timeoutMs: number;
  env: Readonly<Record<string, string>>;
}

export interface FlashPlan {
  command: readonly [string, ...string[]];
  toolchain: string;
  timeoutMs: number;
  env: Readonly<Record<string, string>>;
}

export interface AuthoringContext extends ToolchainContext {
  db: Database.Database;
  projectId: string;
  /** Domain form at the boundary; null is converted once to the storage sentinel. */
  projectVersionId: string | null;
  execution: {
    worktreeRoot: string;
    verified: true;
  };
  signal: AbortSignal;
  now(): Date;
  publish(hint: BuildRunChangedHint): void;
  resolveBuildPlan(target: string | null): Promise<BuildPlan | null>;
  resolveDevice(device: string | null): Promise<string | null>;
  resolveFlashPlan(input: {
    device: string;
    artifactPath: string;
    target: string | null;
  }): Promise<FlashPlan | null>;
  validateDestructiveConfirmation(value: unknown): boolean;
}

export type AuthoringErrorCode =
  | "AUTHORING_NEEDS_CONFIGURATION"
  | "BUILD_FAILED"
  | "BUILD_CANCELLED"
  | "BUILD_ARTIFACT_INVALID"
  | "DESTRUCTIVE_CONFIRMATION_REQUIRED"
  | "FLASH_IMAGE_MISMATCH";

export class AuthoringError extends Error {
  readonly code: AuthoringErrorCode;
  readonly hint: string;
  readonly run: BuildRunRecord | null;
  readonly diagnostic: string | null;
  readonly durationMs: number;

  constructor(input: {
    code: AuthoringErrorCode;
    message: string;
    hint: string;
    run?: BuildRunRecord;
    diagnostic?: string | null;
    durationMs?: number;
  }) {
    super(input.message);
    this.name = "AuthoringError";
    this.code = input.code;
    this.hint = input.hint;
    this.run = input.run ?? null;
    this.diagnostic = input.diagnostic ?? null;
    this.durationMs = input.durationMs ?? 0;
  }
}

export interface BuildActionResult {
  status: BuildRunRecord["status"] | "needsConfiguration";
  runId: string | null;
  durationMs: number;
  digest: string | null;
  diagnostic: string | null;
  hint: string | null;
}

export interface LocalCommandResult {
  exitCode: number | null;
  termination: "completed" | "cancelled" | "timeout" | "spawn-error";
  diagnostic: string | null;
  durationMs: number;
}

const activeJobs = new WeakMap<Database.Database, Set<AbortController>>();
const ENV_NAME = /^[A-Z_][A-Z0-9_]{0,100}$/u;
const DENIED_ENV = /^(?:BASH_ENV|ENV|NODE_OPTIONS|PATH|LD_PRELOAD|LD_LIBRARY_PATH|DYLD_.+)$/u;
const MAX_ARGS = 256;
const MAX_ARG_BYTES = 8192;

function storeFor(ctx: AuthoringContext): BuildRunStore {
  return { db: ctx.db, publish: ctx.publish };
}

function scopeFor(ctx: AuthoringContext): BuildRunScope {
  return {
    projectId: ctx.projectId,
    projectVersionId: toStorageProjectVersionId(ctx.projectVersionId),
  };
}

async function failActiveBuildRun(
  ctx: AuthoringContext,
  runId: string,
): Promise<BuildRunRecord> {
  const scope = scopeFor(ctx);
  const current = getBuildRun(ctx.db, scope, runId);
  if (current === null) throw new Error(`Unknown build run ${runId}`);
  if (current.status !== "queued" && current.status !== "running") return current;
  return await transitionBuildRun(storeFor(ctx), scope, runId, "failed", {
    artifact: current.artifact,
    digest: current.digest,
  });
}

function validatePlan(
  plan: BuildPlan | FlashPlan,
  kind: "build" | "flash",
): void {
  if (plan.command.length < 1 || plan.command.length > MAX_ARGS) {
    throw new Error(`${kind} command must contain between 1 and ${MAX_ARGS} arguments`);
  }
  if (plan.command.some((arg) => arg.includes("\0") || Buffer.byteLength(arg) > MAX_ARG_BYTES)) {
    throw new Error(`${kind} command contains an invalid argument`);
  }
  if (!Number.isInteger(plan.timeoutMs) || plan.timeoutMs < 100 || plan.timeoutMs > 3_600_000) {
    throw new Error(`${kind} timeout must be between 100 and 3600000 ms`);
  }
  const entries = Object.entries(plan.env);
  if (entries.length > 64) throw new Error(`${kind} environment is too large`);
  for (const [name, value] of entries) {
    if (
      !ENV_NAME.test(name) ||
      DENIED_ENV.test(name) ||
      value.includes("\0") ||
      Buffer.byteLength(value) > MAX_ARG_BYTES
    ) {
      throw new Error(`${kind} environment contains an unsafe entry`);
    }
  }
}

function boundedEnvironment(
  pathValue: string,
  configured: Readonly<Record<string, string>>,
): NodeJS.ProcessEnv {
  return {
    LANG: "C",
    LC_ALL: "C",
    ...configured,
    PATH: pathValue,
  };
}

async function verifiedWorktreeRoot(ctx: AuthoringContext): Promise<string> {
  if (ctx.execution.verified !== true || !isAbsolute(ctx.execution.worktreeRoot)) {
    throw new Error("Authoring requires a verified absolute worktree root");
  }
  const root = await realpath(ctx.execution.worktreeRoot);
  if (!(await stat(root)).isDirectory()) throw new Error("Verified worktree root is not a directory");
  return root;
}

function safeRelativeArtifact(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 1024 &&
    !isAbsolute(value) &&
    !value.includes("\\") &&
    !value.split("/").includes("..") &&
    value !== "."
  );
}

export async function resolveArtifact(
  worktreeRoot: string,
  artifact: string,
): Promise<{ relativePath: string; absolutePath: string }> {
  if (!safeRelativeArtifact(artifact)) {
    throw new AuthoringError({
      code: "BUILD_ARTIFACT_INVALID",
      message: "Configured primary artifact is not a safe worktree-relative path",
      hint: "Configure one normalized primary image path inside the verified worktree.",
    });
  }
  let absolutePath: string;
  try {
    absolutePath = await realpath(resolve(worktreeRoot, artifact));
  } catch {
    throw new AuthoringError({
      code: "BUILD_ARTIFACT_INVALID",
      message: `Configured primary artifact was not produced: ${artifact}`,
      hint: "Set primaryArtifact to the firmware image produced by the reviewed build command.",
    });
  }
  const inside = relative(worktreeRoot, absolutePath);
  if (inside === "" || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
    throw new AuthoringError({
      code: "BUILD_ARTIFACT_INVALID",
      message: "Configured primary artifact resolves outside the verified worktree",
      hint: "Configure one normalized primary image path inside the verified worktree.",
    });
  }
  if (!(await stat(absolutePath)).isFile()) {
    throw new AuthoringError({
      code: "BUILD_ARTIFACT_INVALID",
      message: "Configured primary artifact is not a file",
      hint: "Configure primaryArtifact to the firmware image file.",
    });
  }
  return { relativePath: inside.split(sep).join("/"), absolutePath };
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

class DiagnosticCollector {
  #carry = "";
  #first: string | null = null;

  add(chunk: Buffer): void {
    if (this.#first !== null) return;
    this.#carry = `${this.#carry}${chunk.toString("utf8")}`.slice(-16_384);
    const lines = this.#carry.split(/\r?\n/u);
    this.#carry = lines.pop() ?? "";
    for (const line of lines) this.#consider(line);
  }

  finish(): string | null {
    this.#consider(this.#carry);
    return this.#first;
  }

  #consider(line: string): void {
    if (this.#first !== null) return;
    const match = /(?:^|\s)([^\s:][^:\r\n]*):(\d+)(?::(\d+))?:\s*(?:fatal\s+)?error:\s*(.+)$/iu.exec(line);
    if (!match) return;
    const column = match[3] ? `:${match[3]}` : "";
    this.#first = `${match[1]}:${match[2]}${column}: error: ${match[4]}`.slice(0, 2000);
  }
}

function jobControllers(db: Database.Database): Set<AbortController> {
  let controllers = activeJobs.get(db);
  if (!controllers) {
    controllers = new Set();
    activeJobs.set(db, controllers);
  }
  return controllers;
}

export function cancelAuthoringJobs(db: Database.Database): void {
  for (const controller of activeJobs.get(db) ?? []) controller.abort();
}

function killProcessTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    // The process may have exited between the status event and the kill.
  }
}

export async function executeLocalCommand(
  ctx: AuthoringContext,
  run: BuildRunRecord,
  plan: BuildPlan | FlashPlan,
  kind: "build" | "flash",
): Promise<LocalCommandResult> {
  validatePlan(plan, kind);
  const root = await verifiedWorktreeRoot(ctx);
  const executable = await resolveExecutable(plan.command[0], ctx.path);
  if (executable === null) {
    throw new AuthoringError({
      code: "AUTHORING_NEEDS_CONFIGURATION",
      message: `${plan.command[0]} is not installed or executable`,
      hint: `Install and configure the ${plan.toolchain} host prerequisite, then explicitly re-detect toolchains.`,
      run,
    });
  }
  await mkdir(dirname(run.logPath), { recursive: true });
  const handle = await open(run.logPath, "a", 0o600);
  await handle.write(
    `[finite-state] ${kind} command: ${basename(executable)} (${plan.command.length - 1} arguments)\n`,
  );
  await transitionBuildRun(storeFor(ctx), scopeFor(ctx), run.runId, "running", {
    artifact: run.artifact,
    digest: run.digest,
  });
  const started = Date.now();
  const localController = new AbortController();
  const controllers = jobControllers(ctx.db);
  controllers.add(localController);
  const abortFromContext = (): void => localController.abort();
  ctx.signal.addEventListener("abort", abortFromContext, { once: true });
  if (ctx.signal.aborted) localController.abort();
  const diagnostic = new DiagnosticCollector();
  let writeQueue = Promise.resolve();
  const state: { termination: LocalCommandResult["termination"] } = {
    termination: "completed",
  };
  let timeout: NodeJS.Timeout | undefined;
  let forceKill: NodeJS.Timeout | undefined;
  try {
    const result = await new Promise<{ code: number | null; spawnError: Error | null }>((resolveResult) => {
      const child = spawn(executable, plan.command.slice(1), {
        cwd: root,
        env: boundedEnvironment(ctx.path, plan.env),
        detached: process.platform !== "win32",
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      const write = (chunk: Buffer): void => {
        diagnostic.add(chunk);
        writeQueue = writeQueue.then(async () => {
          await handle.write(chunk);
        });
      };
      child.stdout.on("data", write);
      child.stderr.on("data", write);
      const abort = (): void => {
        if (state.termination === "completed") state.termination = "cancelled";
        killProcessTree(child, "SIGTERM");
        forceKill = setTimeout(() => killProcessTree(child, "SIGKILL"), 500);
      };
      localController.signal.addEventListener("abort", abort, { once: true });
      if (localController.signal.aborted) abort();
      timeout = setTimeout(() => {
        state.termination = "timeout";
        killProcessTree(child, "SIGTERM");
        forceKill = setTimeout(() => killProcessTree(child, "SIGKILL"), 500);
      }, plan.timeoutMs);
      child.once("error", (error) => {
        state.termination = "spawn-error";
        resolveResult({ code: null, spawnError: error });
      });
      child.once("close", (code) => resolveResult({ code, spawnError: null }));
    });
    if (timeout) clearTimeout(timeout);
    if (forceKill) clearTimeout(forceKill);
    if (result.spawnError) {
      await handle.write(`[finite-state] spawn error: ${result.spawnError.message}\n`);
    }
    await writeQueue;
    if (state.termination === "timeout") {
      await handle.write(`[finite-state] ${kind} timed out after ${plan.timeoutMs} ms\n`);
    } else if (state.termination === "cancelled") {
      await handle.write(`[finite-state] ${kind} cancelled\n`);
    }
    return {
      exitCode: result.code,
      termination: state.termination,
      diagnostic: diagnostic.finish(),
      durationMs: Date.now() - started,
    };
  } finally {
    if (timeout) clearTimeout(timeout);
    if (forceKill) clearTimeout(forceKill);
    controllers.delete(localController);
    ctx.signal.removeEventListener("abort", abortFromContext);
    await writeQueue;
    await handle.close();
  }
}

async function runBuildDetailed(
  ctx: AuthoringContext,
  req: { target?: string },
): Promise<{ record: BuildRunRecord; command: LocalCommandResult }> {
  const target = req.target ?? null;
  const plan = await ctx.resolveBuildPlan(target);
  if (plan === null) {
    throw new AuthoringError({
      code: "AUTHORING_NEEDS_CONFIGURATION",
      message: "No explicit build command is configured for this target",
      hint: "Configure a reviewed argv build command and one primary firmware image for the target.",
    });
  }
  validatePlan(plan, "build");
  const runId = `build-${randomUUID()}`;
  const logPath = await buildLogPath(ctx.db, runId);
  const queued = await createBuildRun(storeFor(ctx), {
    ...scopeFor(ctx),
    runId,
    kind: "build",
    target,
    toolchain: plan.toolchain,
    artifact: null,
    digest: null,
    logPath,
    startedAt: ctx.now().toISOString(),
  });
  let command: LocalCommandResult;
  try {
    command = await executeLocalCommand(ctx, queued, plan, "build");
  } catch (error) {
    const record = await failActiveBuildRun(ctx, runId);
    if (error instanceof AuthoringError) {
      throw new AuthoringError({
        code: error.code,
        message: error.message,
        hint: error.hint,
        run: record,
      });
    }
    throw new AuthoringError({
      code: "BUILD_FAILED",
      message: error instanceof Error ? error.message : "Build failed before spawn",
      hint: "Inspect the run log and verified execution context before retrying.",
      run: record,
    });
  }
  if (command.termination === "cancelled") {
    const record = await transitionBuildRun(storeFor(ctx), scopeFor(ctx), runId, "cancelled", {
      artifact: null,
      digest: null,
    });
    throw new AuthoringError({
      code: "BUILD_CANCELLED",
      message: "Build was cancelled",
      hint: "Inspect the run log by run id before retrying.",
      run: record,
      diagnostic: command.diagnostic,
      durationMs: command.durationMs,
    });
  }
  if (command.termination !== "completed" || command.exitCode !== 0) {
    const record = await transitionBuildRun(storeFor(ctx), scopeFor(ctx), runId, "failed", {
      artifact: null,
      digest: null,
    });
    throw new AuthoringError({
      code: "BUILD_FAILED",
      message: command.termination === "timeout" ? "Build timed out" : "Build command failed",
      hint: "Inspect the paged log by run id and fix the first diagnostic before retrying.",
      run: record,
      diagnostic: command.diagnostic,
      durationMs: command.durationMs,
    });
  }
  try {
    const root = await verifiedWorktreeRoot(ctx);
    const artifact = await resolveArtifact(root, plan.primaryArtifact);
    const digest = await sha256File(artifact.absolutePath);
    const record = await transitionBuildRun(storeFor(ctx), scopeFor(ctx), runId, "succeeded", {
      artifact: artifact.relativePath,
      digest,
    });
    return { record, command };
  } catch (error) {
    const record = await transitionBuildRun(storeFor(ctx), scopeFor(ctx), runId, "failed", {
      artifact: null,
      digest: null,
    });
    if (error instanceof AuthoringError) {
      throw new AuthoringError({
        code: error.code,
        message: error.message,
        hint: error.hint,
        run: record,
        durationMs: command.durationMs,
      });
    }
    throw error;
  }
}

export async function runBuild(
  ctx: AuthoringContext,
  req: { target?: string },
): Promise<BuildRunRecord> {
  return (await runBuildDetailed(ctx, req)).record;
}

export async function runBuildAction(
  ctx: AuthoringContext,
  req: { target?: string },
): Promise<BuildActionResult> {
  try {
    const result = await runBuildDetailed(ctx, req);
    return {
      status: result.record.status,
      runId: result.record.runId,
      durationMs: result.command.durationMs,
      digest: result.record.digest,
      diagnostic: null,
      hint: null,
    };
  } catch (error) {
    if (!(error instanceof AuthoringError)) throw error;
    return {
      status:
        error.code === "AUTHORING_NEEDS_CONFIGURATION"
          ? "needsConfiguration"
          : error.run?.status ?? "failed",
      runId: error.run?.runId ?? null,
      durationMs: error.durationMs,
      digest: error.run?.digest ?? null,
      diagnostic: error.diagnostic,
      hint: error.hint,
    };
  }
}

export async function detectAuthoringToolchains(
  ctx: AuthoringContext,
): Promise<ToolchainReport> {
  return await detectToolchains(ctx);
}
