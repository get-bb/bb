export * from "./plugin-process-paths.js";
import { spawnSync } from "node:child_process";
import type { ChildProcess, StdioOptions } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
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

interface PortableSpawnRequest {
  command: string;
  args: string[];
  cwd?: string;
  detached?: boolean;
  env?: NodeJS.ProcessEnv;
  stdio?: StdioOptions;
}

export type PortableChildProcess = ChildProcess;

interface PortablePipedSpawnRequest {
  command: string;
  args: string[];
  cwd?: string;
  detached?: boolean;
  env?: NodeJS.ProcessEnv;
}

interface PortablePipedChildProcess extends PortableChildProcess {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
}

interface PortableOutputChildProcess extends PortableChildProcess {
  stdin: null;
  stdout: Readable;
  stderr: Readable;
}

interface KillProcessGroupArgs {
  child: {
    pid?: number | undefined;
    kill: (signal: NodeJS.Signals) => unknown;
  };
  signal: NodeJS.Signals;
  platform?: NodeJS.Platform;
  runWindowsTaskkillSync?: (pid: number) => boolean;
}

interface StopProcessGroupLeaderFirstArgs {
  child: ChildProcess;
  timeoutMs: number;
  killGraceMs: number;
  platform?: NodeJS.Platform;
  runWindowsCommand?: WindowsCommandRunner;
  isProcessAlive?: (pid: number) => boolean;
}

export type WindowsSweepMatchEvidence =
  | "spawn-registry"
  | "executable-path"
  | "command-line"
  | "descendant";

export interface ProcessWithCwd {
  pid: number;
  cwd: string;
  approximateCwd?: boolean;
  matchEvidence?: WindowsSweepMatchEvidence;
}

interface ListProcessesWithCwdUnderArgs {
  directory: string;
  platform?: NodeJS.Platform;
  processEnumTimeoutMs?: number;
  runWindowsCommand?: WindowsCommandRunner;
}

interface KillProcessesWithCwdUnderArgs {
  directory: string;
  graceMs?: number;
  platform?: NodeJS.Platform;
  processEnumTimeoutMs?: number;
  runWindowsCommand?: WindowsCommandRunner;
  isProcessAlive?: (pid: number) => boolean;
}

interface ResolveContainedPathArgs {
  rootPath: string;
  candidatePath: string;
}

export interface SanitizeInheritedChildProcessEnvArgs {
  env: NodeJS.ProcessEnv;
  shellPath?: string;
}

type SafeProcessDiagnosticKind = "startupFailure" | "uncaughtException";

interface SafeProcessDiagnosticsOptions {
  logsDir: string;
  processName: string;
}

interface WriteSafeProcessDiagnosticReportArgs extends SafeProcessDiagnosticsOptions {
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
  const child = crossSpawn(request.command, request.args, {
    cwd: request.cwd,
    detached: request.detached,
    env: request.env,
    stdio: request.stdio,
  });
  trackSpawnedSweepRoot(request.cwd, child.pid, child);
  return child;
}

function trackSpawnedSweepRoot(
  cwd: string | undefined,
  pid: number | undefined,
  child: PortableChildProcess,
): void {
  if (cwd === undefined || pid === undefined) {
    return;
  }
  registerSweepRootProcess({ pid, cwd });
  child.once("exit", () => {
    if (trackedSweepRoots.get(pid) === cwd) {
      trackedSweepRoots.delete(pid);
    }
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

export function supportsProcessGroups(platform?: NodeJS.Platform): boolean {
  return (platform ?? process.platform) !== "win32";
}

export function killProcessGroup(args: KillProcessGroupArgs): void {
  const platform = args.platform ?? process.platform;
  if (platform === "win32") {
    if (
      args.child.pid !== undefined &&
      killWindowsProcessTreeSync(
        args.child.pid,
        args.runWindowsTaskkillSync,
      )
    ) {
      return;
    }
    try {
      args.child.kill(args.signal);
    } catch {}
    return;
  }
  if (args.child.pid !== undefined) {
    try {
      process.kill(-args.child.pid, args.signal);
      return;
    } catch {}
  }
  args.child.kill(args.signal);
}

function killWindowsProcessTreeSync(
  pid: number,
  override?: (pid: number) => boolean,
): boolean {
  if (override !== undefined) {
    try {
      return override(pid);
    } catch {
      return false;
    }
  }
  try {
    const request = buildWindowsTaskkillRequest(pid);
    const result = spawnSync(request.command, request.args, {
      stdio: "ignore",
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

export function isProcessGroupAlive(
  child: {
    pid?: number | undefined;
  },
  platform?: NodeJS.Platform,
): boolean {
  if (!supportsProcessGroups(platform) || child.pid === undefined) {
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

export function stopProcessGroupLeaderFirst(
  args: StopProcessGroupLeaderFirstArgs,
): Promise<void> {
  const platform = args.platform ?? process.platform;
  if (platform === "win32") {
    return stopWindowsProcessTree({
      child: args.child,
      timeoutMs: args.timeoutMs,
      killGraceMs: args.killGraceMs,
      runner: args.runWindowsCommand ?? defaultWindowsCommandRunner,
      isAlive: args.isProcessAlive ?? isProcessAlive,
    });
  }
  const { child, timeoutMs, killGraceMs } = args;
  if (hasChildExited(child) && !isProcessGroupAlive(child, platform)) {
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
      hasChildExited(child) && !isProcessGroupAlive(child, platform);
    const softTimer = setTimeout(() => {
      if (groupGone()) {
        finish();
        return;
      }
      killProcessGroup({ child, signal: "SIGKILL", platform });
      if (killGraceMs <= 0) {
        finish();
        return;
      }
      hardTimer = setTimeout(finish, killGraceMs);
    }, timeoutMs);

    const stopSurvivingMembers = (): void => {
      if (!isProcessGroupAlive(child, platform)) {
        finish();
        return;
      }
      killProcessGroup({ child, signal: "SIGTERM", platform });
      poll = setInterval(() => {
        if (!isProcessGroupAlive(child, platform)) {
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

async function stopWindowsProcessTree(args: {
  child: ChildProcess;
  timeoutMs: number;
  killGraceMs: number;
  runner: WindowsCommandRunner;
  isAlive: (pid: number) => boolean;
}): Promise<void> {
  const child = args.child;
  if (!hasChildExited(child)) {
    try {
      child.kill("SIGTERM");
    } catch {}
    const exitDeadline = Date.now() + args.timeoutMs;
    while (!hasChildExited(child) && Date.now() < exitDeadline) {
      await delay(50);
    }
  }
  await killWindowsProcessTreeBestEffort({
    child,
    runner: args.runner,
    isAlive: args.isAlive,
  });
  if (child.pid !== undefined && args.killGraceMs > 0) {
    const reapDeadline = Date.now() + args.killGraceMs;
    while (args.isAlive(child.pid) && Date.now() < reapDeadline) {
      await delay(50);
    }
  }
  if (!hasChildExited(child)) {
    try {
      child.kill("SIGKILL");
    } catch {}
  }
}

async function killWindowsProcessTreeBestEffort(args: {
  child: ChildProcess;
  runner: WindowsCommandRunner;
  isAlive: (pid: number) => boolean;
}): Promise<void> {
  const pid = args.child.pid;
  let treeHandled = pid === undefined;
  if (pid !== undefined) {
    try {
      const result = await args.runner(buildWindowsTaskkillRequest(pid));
      treeHandled =
        result.exitCode === 0 ||
        (isWindowsProcessNotFoundOutput(
          `${result.stdout}\n${result.stderr}`,
        ) &&
          !args.isAlive(pid));
    } catch {
      treeHandled = !args.isAlive(pid);
    }
  }
  if (!treeHandled && !hasChildExited(args.child)) {
    try {
      args.child.kill("SIGKILL");
    } catch {}
  }
}

function isPathUnderDirectory(candidate: string, directory: string): boolean {
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
      } catch {}
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

export interface WindowsProcessSnapshotEntry {
  processId: number;
  parentProcessId: number;
  executablePath: string | null;
  commandLine: string | null;
}

export interface WindowsCommandRequest {
  command: string;
  args: string[];
}

export interface WindowsCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export type WindowsCommandRunner = (
  request: WindowsCommandRequest,
) => Promise<WindowsCommandResult>;

export interface MatchWindowsProcessesUnderDirectoryArgs {
  snapshot: WindowsProcessSnapshotEntry[];
  directory: string;
  trackedRoots?: ReadonlyMap<number, string>;
  selfPid?: number;
  canonicalizePath?: (value: string) => string;
}

const WINDOWS_PROCESS_ENUM_COMMAND = "powershell.exe";

const WINDOWS_PROCESS_ENUM_SCRIPT =
  "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress";

const WINDOWS_PROCESS_ENUM_ARGS: readonly string[] = [
  "-NoLogo",
  "-NoProfile",
  "-NonInteractive",
  "-Command",
  WINDOWS_PROCESS_ENUM_SCRIPT,
];

const WINDOWS_TASKKILL_COMMAND = "taskkill.exe";

export function buildWindowsProcessEnumRequest(): WindowsCommandRequest {
  return {
    command: WINDOWS_PROCESS_ENUM_COMMAND,
    args: [...WINDOWS_PROCESS_ENUM_ARGS],
  };
}

export function buildWindowsTaskkillRequest(
  pid: number,
): WindowsCommandRequest {
  return {
    command: WINDOWS_TASKKILL_COMMAND,
    args: ["/PID", String(pid), "/T", "/F"],
  };
}

const trackedSweepRoots = new Map<number, string>();

export function registerSweepRootProcess(args: {
  pid: number;
  cwd: string;
}): void {
  if (Number.isInteger(args.pid) && args.pid > 0 && args.cwd !== "") {
    trackedSweepRoots.set(args.pid, args.cwd);
  }
}

export function unregisterSweepRootProcess(pid: number): void {
  trackedSweepRoots.delete(pid);
}

export function clearSweepRootProcesses(): void {
  trackedSweepRoots.clear();
}

function canonicalizeWindowsPath(value: string): string {
  let rest = value.replace(/\//g, "\\");
  let prefix = "";
  if (/^\\\\\?\\UNC\\/i.test(rest)) {
    prefix = "\\\\";
    rest = rest.slice(8);
  } else if (/^\\\\\?\\/i.test(rest)) {
    rest = rest.slice(4);
  } else if (rest.startsWith("\\\\")) {
    prefix = "\\\\";
    rest = rest.slice(2);
  }
  rest = rest.replace(/\\+/g, "\\");
  if (
    rest.length > 1 &&
    rest.endsWith("\\") &&
    !/^[A-Za-z]:\\$/.test(rest)
  ) {
    rest = rest.replace(/\\+$/, "");
  }
  if (rest === "") {
    return prefix === "" ? "\\" : prefix;
  }
  return `${prefix}${rest}`.toLowerCase();
}

const WINDOWS_SHORT_NAME_SEGMENT_PATTERN = /~\d+(?=[\\/]|$)/u;

export function expandWindowsShortPath(value: string): string {
  if (!WINDOWS_SHORT_NAME_SEGMENT_PATTERN.test(value)) {
    return value;
  }
  try {
    return realpathSync.native(value);
  } catch {
    return value;
  }
}

export function isWindowsPathUnderDirectory(
  candidate: string,
  directory: string,
): boolean {
  const canonicalCandidate = canonicalizeWindowsPath(candidate);
  const canonicalDirectory = canonicalizeWindowsPath(directory);
  if (canonicalCandidate === canonicalDirectory) {
    return true;
  }
  const directoryPrefix = canonicalDirectory.endsWith("\\")
    ? canonicalDirectory
    : `${canonicalDirectory}\\`;
  return canonicalCandidate.startsWith(directoryPrefix);
}

const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[A-Za-z]:[\\/]/;

function isWindowsAbsolutePathCandidate(token: string): boolean {
  return (
    WINDOWS_ABSOLUTE_PATH_PATTERN.test(token) || token.startsWith("\\\\")
  );
}

function extractWindowsPathCandidates(commandLine: string): string[] {
  const candidates: string[] = [];
  const tokenPattern = /"([^"]+)"|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = tokenPattern.exec(commandLine)) !== null) {
    const token = (match[1] ?? match[2] ?? "").replace(/[,;]+$/u, "");
    if (token !== "" && isWindowsAbsolutePathCandidate(token)) {
      candidates.push(token);
    }
  }
  return candidates;
}

function readCimStringField(
  record: Record<string, unknown>,
  names: string[],
): string | null {
  for (const name of names) {
    const value = record[name];
    if (typeof value === "string") {
      return value;
    }
  }
  return null;
}

export function parseWindowsProcessSnapshot(
  stdout: string,
): WindowsProcessSnapshotEntry[] {
  const trimmed = stdout.trim();
  if (trimmed === "") {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(
      `Unable to parse Get-CimInstance Win32_Process output as JSON: ${trimmed.slice(0, 200)}`,
    );
  }
  if (parsed === null || parsed === undefined) {
    return [];
  }
  const items: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
  const results: WindowsProcessSnapshotEntry[] = [];
  for (const item of items) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const record = item as Record<string, unknown>;
    const processId = Number(record.ProcessId ?? record.processId);
    if (!Number.isInteger(processId) || processId <= 0) {
      continue;
    }
    const parentRaw = Number(
      record.ParentProcessId ?? record.parentProcessId ?? 0,
    );
    const parentProcessId =
      Number.isInteger(parentRaw) && parentRaw >= 0 ? parentRaw : 0;
    results.push({
      processId,
      parentProcessId,
      executablePath: readCimStringField(record, [
        "ExecutablePath",
        "executablePath",
      ]),
      commandLine: readCimStringField(record, ["CommandLine", "commandLine"]),
    });
  }
  return results;
}

function matchWindowsProcessPath(args: {
  entry: WindowsProcessSnapshotEntry;
  directory: string;
  canonicalizePath: (value: string) => string;
}): { path: string; evidence: WindowsSweepMatchEvidence } | null {
  if (
    args.entry.executablePath !== null &&
    isWindowsPathUnderDirectory(
      args.canonicalizePath(args.entry.executablePath),
      args.directory,
    )
  ) {
    return { path: args.entry.executablePath, evidence: "executable-path" };
  }
  if (args.entry.commandLine !== null) {
    for (const candidate of extractWindowsPathCandidates(
      args.entry.commandLine,
    )) {
      if (
        isWindowsPathUnderDirectory(
          args.canonicalizePath(candidate),
          args.directory,
        )
      ) {
        return { path: candidate, evidence: "command-line" };
      }
    }
  }
  return null;
}

export function matchWindowsProcessesUnderDirectory(
  args: MatchWindowsProcessesUnderDirectoryArgs,
): ProcessWithCwd[] {
  const trackedRoots = args.trackedRoots ?? new Map<number, string>();
  const canonicalizePath = args.canonicalizePath ?? expandWindowsShortPath;
  const canonicalCache = new Map<string, string>();
  const canonicalize = (value: string): string => {
    const cached = canonicalCache.get(value);
    if (cached !== undefined) {
      return cached;
    }
    const canonical = canonicalizePath(value);
    canonicalCache.set(value, canonical);
    return canonical;
  };
  const directory = canonicalize(args.directory);
  const byPid = new Map<number, WindowsProcessSnapshotEntry>();
  const childrenByParent = new Map<number, number[]>();
  for (const entry of args.snapshot) {
    byPid.set(entry.processId, entry);
    const siblings = childrenByParent.get(entry.parentProcessId) ?? [];
    siblings.push(entry.processId);
    childrenByParent.set(entry.parentProcessId, siblings);
  }
  const evidenceByPid = new Map<
    number,
    { cwd: string; evidence: WindowsSweepMatchEvidence }
  >();
  for (const [pid, rootCwd] of trackedRoots) {
    if (args.selfPid !== undefined && pid === args.selfPid) {
      continue;
    }
    if (isWindowsPathUnderDirectory(canonicalize(rootCwd), directory)) {
      evidenceByPid.set(pid, { cwd: rootCwd, evidence: "spawn-registry" });
    }
  }
  for (const entry of args.snapshot) {
    if (args.selfPid !== undefined && entry.processId === args.selfPid) {
      continue;
    }
    if (evidenceByPid.has(entry.processId)) {
      continue;
    }
    const match = matchWindowsProcessPath({
      entry,
      directory,
      canonicalizePath: canonicalize,
    });
    if (match !== null) {
      evidenceByPid.set(entry.processId, {
        cwd: match.path,
        evidence: match.evidence,
      });
    }
  }
  const queue = [...evidenceByPid.keys()];
  const queued = new Set<number>(queue);
  while (queue.length > 0) {
    const pid = queue.pop();
    if (pid === undefined) {
      continue;
    }
    const inherited = evidenceByPid.get(pid);
    if (inherited === undefined) {
      continue;
    }
    for (const childPid of childrenByParent.get(pid) ?? []) {
      if (args.selfPid !== undefined && childPid === args.selfPid) {
        continue;
      }
      if (queued.has(childPid)) {
        continue;
      }
      queued.add(childPid);
      const child = byPid.get(childPid);
      const own =
        child === undefined
          ? null
          : matchWindowsProcessPath({
              entry: child,
              directory,
              canonicalizePath: canonicalize,
            });
      evidenceByPid.set(
        childPid,
        own === null
          ? { cwd: inherited.cwd, evidence: "descendant" }
          : { cwd: own.path, evidence: own.evidence },
      );
      queue.push(childPid);
    }
  }
  const results: ProcessWithCwd[] = [];
  for (const [pid, match] of evidenceByPid) {
    if (!byPid.has(pid)) {
      continue;
    }
    results.push({
      pid,
      cwd: match.cwd,
      approximateCwd: true,
      matchEvidence: match.evidence,
    });
  }
  return results;
}

export const WINDOWS_PROCESS_ENUM_TIMEOUT_MS = 10_000;

function defaultWindowsCommandRunner(
  request: WindowsCommandRequest,
): Promise<WindowsCommandResult> {
  return new Promise<WindowsCommandResult>((resolveRunner, rejectRunner) => {
    const child = spawnPortableOutputProcess({
      command: request.command,
      args: request.args,
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        child.kill("SIGKILL");
      } catch {}
      rejectRunner(
        new Error(
          windowsCommandErrorMessage(
            request,
            `timed out after ${WINDOWS_PROCESS_ENUM_TIMEOUT_MS}ms`,
          ),
        ),
      );
    }, WINDOWS_PROCESS_ENUM_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => stdoutChunks.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));
    child.once("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      rejectRunner(error);
    });
    child.once("exit", (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolveRunner({
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        exitCode,
      });
    });
  });
}

function windowsCommandLabel(request: WindowsCommandRequest): string {
  return `${request.command} ${request.args.join(" ")}`;
}

function windowsCommandErrorMessage(
  request: WindowsCommandRequest,
  detail: string,
): string {
  const trimmed = detail.trim();
  const suffix = trimmed === "" ? "no output" : trimmed.slice(0, 2000);
  return `Windows process command failed: ${windowsCommandLabel(request)}: ${suffix}`;
}

async function runWindowsCommandOrThrow(
  runner: WindowsCommandRunner,
  request: WindowsCommandRequest,
): Promise<WindowsCommandResult> {
  let result: WindowsCommandResult;
  try {
    result = await runner(request);
  } catch (error) {
    throw new Error(
      windowsCommandErrorMessage(
        request,
        error instanceof Error ? error.message : String(error),
      ),
    );
  }
  if (result.exitCode !== 0) {
    throw new Error(
      windowsCommandErrorMessage(
        request,
        `exit code ${result.exitCode}: ${result.stderr}`,
      ),
    );
  }
  return result;
}

async function runWindowsCommandWithTimeout(args: {
  runner: WindowsCommandRunner;
  request: WindowsCommandRequest;
  timeoutMs: number;
}): Promise<WindowsCommandResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      runWindowsCommandOrThrow(args.runner, args.request),
      new Promise<WindowsCommandResult>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error(
              windowsCommandErrorMessage(
                args.request,
                `timed out after ${args.timeoutMs}ms`,
              ),
            ),
          );
        }, args.timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

async function listWindowsProcessesWithCwdUnder(args: {
  directory: string;
  runner: WindowsCommandRunner;
  selfPid: number;
  timeoutMs: number;
}): Promise<ProcessWithCwd[]> {
  const result = await runWindowsCommandWithTimeout({
    runner: args.runner,
    request: buildWindowsProcessEnumRequest(),
    timeoutMs: args.timeoutMs,
  });
  const snapshot = parseWindowsProcessSnapshot(result.stdout);
  const livePids = new Set(snapshot.map((entry) => entry.processId));
  for (const pid of trackedSweepRoots.keys()) {
    if (!livePids.has(pid)) {
      trackedSweepRoots.delete(pid);
    }
  }
  return matchWindowsProcessesUnderDirectory({
    snapshot,
    directory: args.directory,
    trackedRoots: trackedSweepRoots,
    selfPid: args.selfPid,
  });
}

function isWindowsProcessNotFoundOutput(output: string): boolean {
  return /not found/i.test(output);
}

function describeWindowsCommandResult(result: WindowsCommandResult): string {
  const output = `${result.stdout}\n${result.stderr}`.trim();
  const suffix = output === "" ? "no output" : output.slice(0, 2000);
  return `exit code ${result.exitCode}: ${suffix}`;
}

async function killWindowsProcessesWithCwdUnder(args: {
  directory: string;
  graceMs: number;
  runner: WindowsCommandRunner;
  isAlive: (pid: number) => boolean;
  selfPid: number;
  timeoutMs: number;
}): Promise<ProcessWithCwd[]> {
  const signalled = new Map<number, ProcessWithCwd>();
  const seen = new Map<number, ProcessWithCwd>();
  const failures = new Map<number, string>();
  for (let round = 0; round < MAX_CWD_SWEEP_ROUNDS; round += 1) {
    const targets = await listWindowsProcessesWithCwdUnder({
      directory: args.directory,
      runner: args.runner,
      selfPid: args.selfPid,
      timeoutMs: args.timeoutMs,
    });
    if (targets.length === 0) {
      break;
    }
    for (const target of targets) {
      seen.set(target.pid, target);
      const request = buildWindowsTaskkillRequest(target.pid);
      try {
        const result = await args.runner(request);
        if (result.exitCode === 0) {
          signalled.set(target.pid, target);
          failures.delete(target.pid);
        } else if (
          isWindowsProcessNotFoundOutput(
            `${result.stdout}\n${result.stderr}`,
          ) &&
          !args.isAlive(target.pid)
        ) {
          signalled.set(target.pid, target);
          failures.delete(target.pid);
        } else {
          failures.set(target.pid, describeWindowsCommandResult(result));
        }
      } catch (error) {
        if (!args.isAlive(target.pid)) {
          signalled.set(target.pid, target);
          failures.delete(target.pid);
        } else {
          failures.set(
            target.pid,
            error instanceof Error ? error.message : String(error),
          );
        }
      }
    }
    const deadline = Date.now() + args.graceMs;
    while (
      Date.now() < deadline &&
      targets.some((target) => args.isAlive(target.pid))
    ) {
      await delay(50);
    }
    const survivors = await listWindowsProcessesWithCwdUnder({
      directory: args.directory,
      runner: args.runner,
      selfPid: args.selfPid,
      timeoutMs: args.timeoutMs,
    });
    if (survivors.length === 0) {
      break;
    }
  }
  const outstanding: string[] = [];
  for (const [pid, detail] of failures) {
    const target = seen.get(pid);
    if (target !== undefined && !args.isAlive(pid)) {
      signalled.set(pid, target);
      continue;
    }
    outstanding.push(`pid ${pid} (${detail})`);
  }
  if (outstanding.length > 0) {
    throw new Error(
      `Failed to kill Windows processes under ${args.directory}: ${outstanding.join("; ")}`,
    );
  }
  return [...signalled.values()];
}

async function resolveSweepDirectory(
  directory: string,
): Promise<string | null> {
  const resolved = resolve(directory);
  let parent = dirname(resolved);
  try {
    parent = await realpath(parent);
  } catch {}
  const canonical = join(parent, basename(resolved));
  try {
    if ((await lstat(canonical)).isSymbolicLink()) {
      return null;
    }
  } catch {}
  return canonical;
}

export async function listProcessesWithCwdUnder(
  args: ListProcessesWithCwdUnderArgs,
): Promise<ProcessWithCwd[]> {
  const platform = args.platform ?? process.platform;
  if (platform === "win32") {
    return listWindowsProcessesWithCwdUnder({
      directory: args.directory,
      runner: args.runWindowsCommand ?? defaultWindowsCommandRunner,
      selfPid: process.pid,
      timeoutMs: args.processEnumTimeoutMs ?? WINDOWS_PROCESS_ENUM_TIMEOUT_MS,
    });
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
    } catch {}
  }
}

export async function killProcessesWithCwdUnder(
  args: KillProcessesWithCwdUnderArgs,
): Promise<ProcessWithCwd[]> {
  const platform = args.platform ?? process.platform;
  const graceMs = args.graceMs ?? 2000;
  const isAlive = args.isProcessAlive ?? isProcessAlive;
  if (platform === "win32") {
    return killWindowsProcessesWithCwdUnder({
      directory: args.directory,
      graceMs,
      runner: args.runWindowsCommand ?? defaultWindowsCommandRunner,
      isAlive,
      selfPid: process.pid,
      timeoutMs: args.processEnumTimeoutMs ?? WINDOWS_PROCESS_ENUM_TIMEOUT_MS,
    });
  }
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
      targets.some((target) => isAlive(target.pid))
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

const NPM_SCRIPT_POLICY_ENV_KEYS: ReadonlySet<string> = new Set([
  "npm_config_allow_scripts",
  "npm_config_ignore_scripts",
  "npm_config_foreground_scripts",
]);

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
    } catch {}
  };

  process.on("uncaughtExceptionMonitor", handleUncaughtExceptionMonitor);

  return () => {
    process.off("uncaughtExceptionMonitor", handleUncaughtExceptionMonitor);
  };
}
