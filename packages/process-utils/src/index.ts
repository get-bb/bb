import type { ChildProcess, StdioOptions } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
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

export interface ResolveContainedPathArgs {
  rootPath: string;
  candidatePath: string;
}

export interface SanitizeInheritedChildProcessEnvArgs {
  env: NodeJS.ProcessEnv;
}

export type SafeProcessDiagnosticKind =
  | "startupFailure"
  | "uncaughtException";

export interface SafeProcessDiagnosticsOptions {
  logsDir: string;
  processName: string;
}

export interface WriteSafeProcessDiagnosticReportArgs
  extends SafeProcessDiagnosticsOptions {
  kind: SafeProcessDiagnosticKind;
  error: unknown;
  now?: () => Date;
  createReportId?: () => string;
}

interface SafeProcessDiagnosticError {
  name: string;
  message: string;
  stack?: string;
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
 * Removes bb runtime-owned env from an inherited process env. Callers should
 * overlay only the child-specific bb env they intentionally expose afterward.
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
  return sanitizedEnv;
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

function serializeDiagnosticError(
  error: unknown,
): SafeProcessDiagnosticError {
  if (error instanceof Error) {
    const serialized: SafeProcessDiagnosticError = {
      name: error.name,
      message: error.message,
    };
    if (error.stack !== undefined) {
      serialized.stack = error.stack;
    }
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
