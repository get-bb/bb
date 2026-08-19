export * from "./plugin-process-paths.js";
import type { ChildProcess, StdioOptions } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { lstat, readdir, readlink, realpath } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import type { Readable, Writable } from "node:stream";
import crossSpawn from "cross-spawn";

export interface PortableSpawnRequest {
  command: string;
  args: string[];
  cwd?: string;
  detached?: boolean;
  env?: NodeJS.ProcessEnv;
  stdio?: StdioOptions;
}

export type PortableChildProcess = ChildProcess;

export interface PortablePipedSpawnRequest {
  command: string;
  args: string[];
  cwd?: string;
  detached?: boolean;
  env?: NodeJS.ProcessEnv;
}

export interface PortablePipedChildProcess extends PortableChildProcess {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
}

export interface PortableOutputChildProcess extends PortableChildProcess {
  stdin: null;
  stdout: Readable;
  stderr: Readable;
}

export interface KillProcessGroupArgs {
  child: {
    pid?: number | undefined;
    kill: (signal: NodeJS.Signals) => unknown;
  };
  signal: NodeJS.Signals;
}

export interface StopProcessGroupLeaderFirstArgs {
  child: ChildProcess;
  /** Time after the leader SIGTERM before the whole group gets SIGKILL. */
  timeoutMs: number;
  /**
   * Time to wait for the exit after SIGKILL before the promise resolves
   * anyway. Use 0 to resolve as soon as SIGKILL is sent.
   */
  killGraceMs: number;
}

export interface ProcessWithCwd {
  pid: number;
  cwd: string;
}

export interface ListProcessesWithCwdUnderArgs {
  directory: string;
}

export interface KillProcessesWithCwdUnderArgs {
  directory: string;
  /** Time to wait after SIGTERM before SIGKILL. Defaults to 2000ms. */
  graceMs?: number;
}

export interface ResolveContainedPathArgs {
  rootPath: string;
  candidatePath: string;
}

export interface SanitizeInheritedChildProcessEnvArgs {
  env: NodeJS.ProcessEnv;
  /**
   * The user's login-shell PATH, substituted for the inherited one. Omit to
   * keep the parent's PATH: that is a real distinction, not a default. A
   * daemon started by launchd or systemd inherits a minimal PATH that finds
   * none of the user's tools, so anything spawning user-facing executables
   * (plugin hosts, provider bridges) passes the resolved shell PATH, while a
   * child that must run exactly what the parent runs must not.
   */
  shellPath?: string;
}

export type SafeProcessDiagnosticKind = "startupFailure" | "uncaughtException";

export interface SafeProcessDiagnosticsOptions {
  logsDir: string;
  processName: string;
}

export interface WriteSafeProcessDiagnosticReportArgs extends SafeProcessDiagnosticsOptions {
  kind: SafeProcessDiagnosticKind;
  error: unknown;
  now?: () => Date;
  createReportId?: () => string;
}

const MAX_DIAGNOSTIC_ERROR_CAUSE_DEPTH = 8;
const MAX_DIAGNOSTIC_AGGREGATE_ERRORS = 8;

interface SafeProcessDiagnosticError {
  name: string;
  message: string;
  stack?: string;
  code?: string;
  cause?: SafeProcessDiagnosticError;
  errors?: SafeProcessDiagnosticError[];
  errorsTruncated?: number;
  truncationReason?: "cycle" | "depth";
}

interface SafeProcessDiagnosticReport {
  diagnosticVersion: 1;
  kind: SafeProcessDiagnosticKind;
  processName: string;
  occurredAt: string;
  pid: number;
  runtime: {
    nodeVersion: string;
    platform: NodeJS.Platform;
    arch: string;
    execPath: string;
  };
  error: SafeProcessDiagnosticError;
}

type UncaughtExceptionMonitorHandler = (
  error: Error,
  origin: NodeJS.UncaughtExceptionOrigin,
) => void;

export function spawnPortableProcess(
  request: PortableSpawnRequest,
): PortableChildProcess {
  return crossSpawn(request.command, request.args, {
    cwd: request.cwd,
    detached: request.detached,
    env: request.env,
    stdio: request.stdio,
  });
}

function assertPortablePipedProcess(
  child: PortableChildProcess,
): asserts child is PortablePipedChildProcess {
  if (!child.stdin || !child.stdout || !child.stderr) {
    throw new Error("Portable child process did not attach piped stdio");
  }
}

function assertPortableOutputProcess(
  child: PortableChildProcess,
): asserts child is PortableOutputChildProcess {
  if (child.stdin || !child.stdout || !child.stderr) {
    throw new Error("Portable child process did not attach output-only stdio");
  }
}

export function spawnPortablePipedProcess(
  request: PortablePipedSpawnRequest,
): PortablePipedChildProcess {
  const child = spawnPortableProcess({
    ...request,
    stdio: ["pipe", "pipe", "pipe"],
  });
  assertPortablePipedProcess(child);
  return child;
}

export function spawnPortableOutputProcess(
  request: PortablePipedSpawnRequest,
): PortableOutputChildProcess {
  const child = spawnPortableProcess({
    ...request,
    stdio: ["ignore", "pipe", "pipe"],
  });
  assertPortableOutputProcess(child);
  return child;
}

/**
 * True when the platform supports POSIX process groups. Callers spawn with
 * `detached: true` so the child leads its own group and this helper can signal
 * the whole group, including grandchildren.
 */
export function supportsProcessGroups(): boolean {
  return process.platform !== "win32";
}

/**
 * Sends `signal` to the child's process group when possible, and falls back
 * to the direct child when the group is gone or unsupported.
 */
export function killProcessGroup(args: KillProcessGroupArgs): void {
  if (supportsProcessGroups() && args.child.pid !== undefined) {
    try {
      process.kill(-args.child.pid, args.signal);
      return;
    } catch {
      // Fall back to killing the direct child if the process group is gone.
    }
  }
  args.child.kill(args.signal);
}

/**
 * True when at least one process still belongs to the group led by `child`.
 * Returns false when the platform has no process groups or the child was not
 * spawned as a group leader.
 */
export function isProcessGroupAlive(child: {
  pid?: number | undefined;
}): boolean {
  if (!supportsProcessGroups() || child.pid === undefined) {
    return false;
  }
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch {
    return false;
  }
}

function hasChildExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

const PROCESS_GROUP_EXIT_POLL_MS = 100;

/**
 * Stops a process-group leader and everything it started, leader first.
 *
 * SIGTERM goes to the leader alone so a provider bridge can drive its own
 * CLI down gracefully instead of racing a group-wide SIGTERM. Escalation keys
 * on "any group member still alive": when the leader exits and members
 * remain, the group gets SIGTERM and is polled; when `timeoutMs` passes and
 * anything remains, the group gets SIGKILL. Resolves once the group is gone
 * or `killGraceMs` after SIGKILL.
 */
export function stopProcessGroupLeaderFirst(
  args: StopProcessGroupLeaderFirstArgs,
): Promise<void> {
  const { child, timeoutMs, killGraceMs } = args;
  if (hasChildExited(child) && !isProcessGroupAlive(child)) {
    return Promise.resolve();
  }
  return new Promise<void>((resolveStop) => {
    let settled = false;
    let hardTimer: NodeJS.Timeout | undefined;
    let poll: NodeJS.Timeout | undefined;
    const finish = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(softTimer);
      if (hardTimer !== undefined) {
        clearTimeout(hardTimer);
      }
      if (poll !== undefined) {
        clearInterval(poll);
      }
      resolveStop();
    };
    const groupGone = (): boolean =>
      hasChildExited(child) && !isProcessGroupAlive(child);
    const softTimer = setTimeout(() => {
      if (groupGone()) {
        finish();
        return;
      }
      killProcessGroup({ child, signal: "SIGKILL" });
      if (killGraceMs <= 0) {
        finish();
        return;
      }
      hardTimer = setTimeout(finish, killGraceMs);
    }, timeoutMs);

    // Group members outlive the leader: signal them and poll so the stop
    // resolves as soon as they are gone instead of at the SIGKILL timer.
    const stopSurvivingMembers = (): void => {
      if (!isProcessGroupAlive(child)) {
        finish();
        return;
      }
      killProcessGroup({ child, signal: "SIGTERM" });
      poll = setInterval(() => {
        if (!isProcessGroupAlive(child)) {
          finish();
        }
      }, PROCESS_GROUP_EXIT_POLL_MS);
    };

    if (hasChildExited(child)) {
      stopSurvivingMembers();
      return;
    }
    child.once("exit", stopSurvivingMembers);
    child.kill("SIGTERM");
  });
}

function isPathUnderDirectory(candidate: string, directory: string): boolean {
  // Linux reports a removed cwd as "<path> (deleted)".
  const normalized = candidate.endsWith(" (deleted)")
    ? candidate.slice(0, -" (deleted)".length)
    : candidate;
  return (
    normalized === directory || normalized.startsWith(`${directory}${sep}`)
  );
}

async function listLinuxProcessCwds(): Promise<ProcessWithCwd[]> {
  const entries = await readdir("/proc");
  const results: ProcessWithCwd[] = [];
  await Promise.all(
    entries.map(async (entry) => {
      if (!/^\d+$/.test(entry)) {
        return;
      }
      try {
        const cwd = await readlink(`/proc/${entry}/cwd`);
        results.push({ pid: Number(entry), cwd });
      } catch {
        // Process exited or is not readable by this user.
      }
    }),
  );
  return results;
}

async function listLsofProcessCwds(): Promise<ProcessWithCwd[]> {
  const child = spawnPortableOutputProcess({
    command: "lsof",
    args: ["-a", "-d", "cwd", "-F", "pn", "-w", "-n"],
  });
  const chunks: Buffer[] = [];
  child.stdout.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  child.stderr.resume();
  await new Promise<void>((resolveExit) => {
    child.once("error", () => resolveExit());
    child.once("exit", () => resolveExit());
  });
  const results: ProcessWithCwd[] = [];
  let pid: number | null = null;
  for (const line of Buffer.concat(chunks).toString("utf8").split("\n")) {
    if (line.startsWith("p")) {
      pid = Number(line.slice(1));
    } else if (line.startsWith("n") && pid !== null) {
      results.push({ pid, cwd: line.slice(1) });
    }
  }
  return results;
}

/**
 * Resolves the canonical path of `directory` for cwd matching. Returns null
 * when the final path component is a symlink: a workspace root that was
 * swapped for a link must not redirect the sweep to unrelated processes.
 */
async function resolveSweepDirectory(
  directory: string,
): Promise<string | null> {
  const resolved = resolve(directory);
  let parent = dirname(resolved);
  try {
    parent = await realpath(parent);
  } catch {
    // The parent may already be gone; match against the given path.
  }
  const canonical = join(parent, basename(resolved));
  try {
    if ((await lstat(canonical)).isSymbolicLink()) {
      return null;
    }
  } catch {
    // The directory itself may already be removed. Processes can still hold
    // it as a "(deleted)" cwd, so keep matching on the path.
  }
  return canonical;
}

/**
 * Lists processes whose current working directory is `directory` or a path
 * inside it. Excludes the current process. Returns [] on unsupported
 * platforms and when `directory` is a symlink.
 */
export async function listProcessesWithCwdUnder(
  args: ListProcessesWithCwdUnderArgs,
): Promise<ProcessWithCwd[]> {
  if (process.platform === "win32") {
    return [];
  }
  const directory = await resolveSweepDirectory(args.directory);
  if (directory === null) {
    return [];
  }
  const all =
    process.platform === "linux"
      ? await listLinuxProcessCwds()
      : await listLsofProcessCwds();
  return all.filter(
    (entry) =>
      entry.pid !== process.pid && isPathUnderDirectory(entry.cwd, directory),
  );
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

const MAX_CWD_SWEEP_ROUNDS = 5;

function signalProcesses(
  targets: ProcessWithCwd[],
  signal: NodeJS.Signals,
  signalled: Map<number, ProcessWithCwd>,
): void {
  for (const target of targets) {
    try {
      process.kill(target.pid, signal);
      signalled.set(target.pid, target);
    } catch {
      // Already exited.
    }
  }
}

/**
 * Sends SIGTERM to every process rooted in `directory`, waits up to
 * `graceMs`, rescans, and SIGKILLs the processes that are still rooted there.
 * Ownership-agnostic: any process of the current user with a cwd under
 * `directory` is a target, whether or not this process started it.
 * Each signal follows a fresh scan, so a reused pid or a process that
 * appeared during shutdown never receives a stale signal. Repeats until a
 * scan finds nothing, bounded by a small round limit. Returns the processes
 * that received a signal.
 */
export async function killProcessesWithCwdUnder(
  args: KillProcessesWithCwdUnderArgs,
): Promise<ProcessWithCwd[]> {
  const graceMs = args.graceMs ?? 2000;
  const signalled = new Map<number, ProcessWithCwd>();
  for (let round = 0; round < MAX_CWD_SWEEP_ROUNDS; round += 1) {
    const targets = await listProcessesWithCwdUnder({
      directory: args.directory,
    });
    if (targets.length === 0) {
      break;
    }
    signalProcesses(targets, "SIGTERM", signalled);
    const deadline = Date.now() + graceMs;
    while (
      Date.now() < deadline &&
      targets.some((target) => isProcessAlive(target.pid))
    ) {
      await delay(50);
    }
    const survivors = await listProcessesWithCwdUnder({
      directory: args.directory,
    });
    if (survivors.length === 0) {
      break;
    }
    signalProcesses(survivors, "SIGKILL", signalled);
    await delay(50);
  }
  return Array.from(signalled.values());
}

export function resolveContainedPath(
  args: ResolveContainedPathArgs,
): string | null {
  const resolvedRootPath = resolve(args.rootPath);
  const resolvedCandidatePath = resolve(args.candidatePath);
  const relativePath = relative(resolvedRootPath, resolvedCandidatePath);

  if (relativePath === "") {
    return null;
  }

  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    return null;
  }

  return resolvedCandidatePath;
}

/**
 * The one answer to "what does a bb-spawned child process inherit": the
 * parent's env minus bb runtime-owned variables (`BB_*`) and `NODE_ENV`,
 * optionally with the user's login-shell PATH substituted. Callers overlay
 * only the child-specific bb env they intentionally expose afterward.
 */
export function sanitizeInheritedChildProcessEnv(
  args: SanitizeInheritedChildProcessEnvArgs,
): NodeJS.ProcessEnv {
  const sanitizedEnv: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(args.env)) {
    if (value === undefined) {
      continue;
    }
    if (key === "NODE_ENV" || key.startsWith("BB_")) {
      continue;
    }
    sanitizedEnv[key] = value;
  }
  if (args.shellPath !== undefined) {
    sanitizedEnv.PATH = args.shellPath;
  }
  return sanitizedEnv;
}

/**
 * The `npm_config_*` keys that decide whether package scripts run. npm reads
 * `npm_config_<key>` env as configuration above every `.npmrc` file (cli >
 * env > project > user > global), and it case-folds the key.
 *
 * bb's own npm children (plugin installs, the plugin build toolchain fetch)
 * always pass `--ignore-scripts`: nothing in a freshly fetched tree may
 * execute, and that policy is bb's, not the environment's. An inherited value
 * is also a live footgun: launching bb through a package manager (`pnpm
 * start`) exports the user's whole `~/.npmrc` as `npm_config_*`, so an
 * ordinary `allow-scripts=@github/keytar,node-pty` line reaches npm 11/12 as
 * if it were `--allow-scripts`, which npm refuses on project-scoped installs
 * (`EALLOWSCRIPTS`).
 *
 * Every other `npm_config_*` key is left alone on purpose: env is a supported
 * way to point bb's npm at a private registry, a shared cache, or an
 * alternate userconfig.
 */
export const NPM_SCRIPT_POLICY_ENV_KEYS: ReadonlySet<string> = new Set([
  "npm_config_allow_scripts",
  "npm_config_ignore_scripts",
  "npm_config_foreground_scripts",
]);

/**
 * The environment a bb-owned npm child inherits: `env` minus the npm
 * script-policy keys (matched case-insensitively, as npm does).
 */
export function omitNpmScriptPolicyEnv(
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (NPM_SCRIPT_POLICY_ENV_KEYS.has(key.toLowerCase())) continue;
    childEnv[key] = value;
  }
  return childEnv;
}

function createCurrentDiagnosticDate(): Date {
  return new Date();
}

function sanitizeDiagnosticFilenamePart(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9_-]+/g, "-");
  return sanitized.length > 0 ? sanitized : "process";
}

function formatDiagnosticTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

function createTruncatedDiagnosticError(
  truncationReason: "cycle" | "depth",
): SafeProcessDiagnosticError {
  return {
    name: "TruncatedErrorCause",
    message:
      truncationReason === "cycle"
        ? "Error cause serialization stopped because the cause chain contains a cycle"
        : `Error cause serialization stopped at the maximum depth of ${MAX_DIAGNOSTIC_ERROR_CAUSE_DEPTH}`,
    truncationReason,
  };
}

function serializeDiagnosticError(
  error: unknown,
  seenErrors: Set<Error> = new Set(),
  depth = 0,
): SafeProcessDiagnosticError {
  if (error instanceof Error) {
    if (seenErrors.has(error)) {
      return createTruncatedDiagnosticError("cycle");
    }
    if (depth >= MAX_DIAGNOSTIC_ERROR_CAUSE_DEPTH) {
      return createTruncatedDiagnosticError("depth");
    }
    seenErrors.add(error);

    const serialized: SafeProcessDiagnosticError = {
      name: error.name,
      message: error.message,
    };
    if (error.stack !== undefined) {
      serialized.stack = error.stack;
    }
    if ("code" in error && typeof error.code === "string") {
      serialized.code = error.code;
    }
    if (error.cause !== undefined) {
      serialized.cause = serializeDiagnosticError(
        error.cause,
        seenErrors,
        depth + 1,
      );
    }
    if (error instanceof AggregateError) {
      const aggregateErrors = error.errors.slice(
        0,
        MAX_DIAGNOSTIC_AGGREGATE_ERRORS,
      );
      serialized.errors = aggregateErrors.map((aggregateError) =>
        serializeDiagnosticError(aggregateError, seenErrors, depth + 1),
      );
      const errorsTruncated = error.errors.length - aggregateErrors.length;
      if (errorsTruncated > 0) {
        serialized.errorsTruncated = errorsTruncated;
      }
    }
    seenErrors.delete(error);
    return serialized;
  }

  return {
    name: "NonError",
    message: String(error),
  };
}

export function writeSafeProcessDiagnosticReport(
  args: WriteSafeProcessDiagnosticReportArgs,
): string {
  mkdirSync(args.logsDir, { recursive: true });
  const occurredAt = (args.now ?? createCurrentDiagnosticDate)();
  const reportId = sanitizeDiagnosticFilenamePart(
    (args.createReportId ?? randomUUID)(),
  );
  const processName = sanitizeDiagnosticFilenamePart(args.processName);
  const reportPath = join(
    args.logsDir,
    `process-${processName}-${args.kind}-${formatDiagnosticTimestamp(
      occurredAt,
    )}-${reportId}.json`,
  );
  const report: SafeProcessDiagnosticReport = {
    diagnosticVersion: 1,
    kind: args.kind,
    processName: args.processName,
    occurredAt: occurredAt.toISOString(),
    pid: process.pid,
    runtime: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      execPath: process.execPath,
    },
    error: serializeDiagnosticError(args.error),
  };

  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf8",
  });
  return reportPath;
}

/**
 * Installs env-safe JS failure diagnostics. This intentionally avoids Node
 * process.report on supported runtimes because diagnostic reports can include
 * inherited environment secrets. It observes uncaught JS exceptions only;
 * native SIGSEGV/SIGABRT failures may terminate before JS can write anything.
 */
export function installSafeProcessDiagnostics(
  options: SafeProcessDiagnosticsOptions,
): () => void {
  mkdirSync(options.logsDir, { recursive: true });
  const handleUncaughtExceptionMonitor: UncaughtExceptionMonitorHandler = (
    error,
  ) => {
    try {
      writeSafeProcessDiagnosticReport({
        ...options,
        kind: "uncaughtException",
        error,
      });
    } catch {
      // Preserve Node's original uncaught-exception behavior if logging fails.
    }
  };

  process.on("uncaughtExceptionMonitor", handleUncaughtExceptionMonitor);

  return () => {
    process.off("uncaughtExceptionMonitor", handleUncaughtExceptionMonitor);
  };
}
