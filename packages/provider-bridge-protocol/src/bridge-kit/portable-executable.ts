import {
  spawn as nodeSpawn,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";
import path from "node:path";
import {
  spawnPortableOutputProcess,
  spawnPortablePipedProcess,
} from "@bb/process-utils";

export type PortableSpawnFn = (
  file: string,
  args: string[],
  options: SpawnOptions,
) => ChildProcess;

export interface PortableProcessCall {
  command: string;
  args: readonly string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

export function resolveBinaryLookupCommand(
  platform: NodeJS.Platform = process.platform,
): "where.exe" | "which" {
  return platform === "win32" ? "where.exe" : "which";
}

const WINDOWS_EXECUTABLE_EXTENSION_PATTERN = /\.(?:com|exe|bat|cmd|ps1)$/iu;

export function parseBinaryLookupOutput(
  stdout: string,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const lines = stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  if (lines.length === 0) return null;
  if (platform !== "win32") return lines[0] ?? null;
  return (
    lines.find((line) => WINDOWS_EXECUTABLE_EXTENSION_PATTERN.test(line)) ??
    lines[0] ??
    null
  );
}

const WINDOWS_SCRIPT_EXECUTABLE_PATTERN = /\.(?:cmd|bat|ps1)$/iu;

export function isWindowsScriptExecutable(
  command: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return (
    platform === "win32" && WINDOWS_SCRIPT_EXECUTABLE_PATTERN.test(command)
  );
}

export function resolveNpmCommand(
  platform: NodeJS.Platform = process.platform,
): "npm.cmd" | "npm" {
  return platform === "win32" ? "npm.cmd" : "npm";
}

export function resolveNpmGlobalBinDir(
  npmPrefix: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === "win32") {
    return npmPrefix;
  }
  return path.posix.join(npmPrefix, "bin");
}

function pipedSpawnOptions(call: PortableProcessCall): SpawnOptions {
  return {
    ...(call.cwd !== undefined ? { cwd: call.cwd } : {}),
    ...(call.env !== undefined ? { env: call.env } : {}),
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
  };
}

function outputSpawnOptions(call: PortableProcessCall): SpawnOptions {
  return {
    ...(call.cwd !== undefined ? { cwd: call.cwd } : {}),
    ...(call.env !== undefined ? { env: call.env } : {}),
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  };
}

export function spawnPortableAgentProcess(
  call: PortableProcessCall,
  spawnImpl?: PortableSpawnFn,
): ChildProcess {
  const platform = call.platform ?? process.platform;
  if (spawnImpl !== undefined) {
    return spawnImpl(call.command, [...call.args], pipedSpawnOptions(call));
  }
  if (platform === "win32") {
    return spawnPortablePipedProcess({
      command: call.command,
      args: [...call.args],
      ...(call.cwd !== undefined ? { cwd: call.cwd } : {}),
      ...(call.env !== undefined ? { env: call.env } : {}),
    });
  }
  return nodeSpawn(call.command, [...call.args], pipedSpawnOptions(call));
}

export const PORTABLE_CAPTURE_MAX_BUFFER_BYTES = 1024 * 1024;

export interface PortableCaptureCall extends PortableProcessCall {
  timeoutMs: number;
}

export interface PortableCaptureResult {
  stdout: string;
  stderr: string;
}

export class PortableCommandError extends Error {
  readonly exitCode: number | null;
  readonly errorCode: string | number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly syscall: string | undefined;
  readonly timedOut: boolean;

  constructor(args: {
    message: string;
    exitCode?: number | null;
    errorCode?: string | number | null;
    stdout?: string;
    stderr?: string;
    syscall?: string;
    timedOut?: boolean;
  }) {
    super(args.message);
    this.name = "PortableCommandError";
    this.exitCode = args.exitCode ?? null;
    this.errorCode = args.errorCode ?? null;
    this.stdout = args.stdout ?? "";
    this.stderr = args.stderr ?? "";
    this.syscall = args.syscall;
    this.timedOut = args.timedOut ?? false;
  }
}

export function isMissingPortableExecutable(error: unknown): boolean {
  return (
    error instanceof PortableCommandError &&
    error.errorCode === "ENOENT" &&
    (error.syscall?.startsWith("spawn") ?? false)
  );
}

function spawnForCapture(
  call: PortableCaptureCall,
  spawnImpl: PortableSpawnFn | undefined,
  platform: NodeJS.Platform,
): ChildProcess {
  if (spawnImpl !== undefined) {
    return spawnImpl(call.command, [...call.args], outputSpawnOptions(call));
  }
  if (platform === "win32") {
    return spawnPortableOutputProcess({
      command: call.command,
      args: [...call.args],
      ...(call.cwd !== undefined ? { cwd: call.cwd } : {}),
      ...(call.env !== undefined ? { env: call.env } : {}),
    });
  }
  return nodeSpawn(call.command, [...call.args], outputSpawnOptions(call));
}

export function runPortableCommandCapture(
  call: PortableCaptureCall,
  spawnImpl?: PortableSpawnFn,
): Promise<PortableCaptureResult> {
  const platform = call.platform ?? process.platform;
  return new Promise<PortableCaptureResult>((resolveCapture, rejectCapture) => {
    let child: ChildProcess;
    try {
      child = spawnForCapture(call, spawnImpl, platform);
    } catch (error) {
      rejectCapture(
        new PortableCommandError({
          message:
            error instanceof Error
              ? `Failed to launch "${call.command}": ${error.message}`
              : `Failed to launch "${call.command}"`,
          errorCode:
            error instanceof Error && "code" in error
              ? (error.code as string | number)
              : null,
          syscall: `spawn ${call.command}`,
        }),
      );
      return;
    }

    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;

    const fail = (error: PortableCommandError): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      try {
        child.kill("SIGTERM");
      } catch {}
      rejectCapture(error);
    };

    const timeout = setTimeout(() => {
      fail(
        new PortableCommandError({
          message: `"${call.command}" timed out after ${call.timeoutMs}ms`,
          stdout,
          stderr,
          syscall: `spawn ${call.command}`,
          timedOut: true,
        }),
      );
    }, call.timeoutMs);
    timeout.unref?.();

    const trackChunk = (
      chunk: Buffer | string,
      append: (text: string, bytes: number) => void,
    ): void => {
      const text =
        typeof chunk === "string" ? chunk : chunk.toString("utf8");
      append(text, Buffer.byteLength(text));
      if (stdoutBytes + stderrBytes > PORTABLE_CAPTURE_MAX_BUFFER_BYTES) {
        fail(
          new PortableCommandError({
            message: `"${call.command}" exceeded the ${PORTABLE_CAPTURE_MAX_BUFFER_BYTES} byte output limit`,
            stdout,
            stderr,
            syscall: `spawn ${call.command}`,
          }),
        );
      }
    };

    child.stdout?.on("data", (chunk: Buffer | string) => {
      trackChunk(chunk, (text, bytes) => {
        stdout += text;
        stdoutBytes += bytes;
      });
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      trackChunk(chunk, (text, bytes) => {
        stderr += text;
        stderrBytes += bytes;
      });
    });
    child.on("error", (error: Error) => {
      fail(
        new PortableCommandError({
          message: `Failed to launch "${call.command}": ${error.message}`,
          errorCode:
            "code" in error ? (error.code as string | number) : null,
          stdout,
          stderr,
          syscall: `spawn ${call.command}`,
        }),
      );
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (code === 0) {
        resolveCapture({ stdout, stderr });
        return;
      }
      rejectCapture(
        new PortableCommandError({
          message: `"${call.command}" exited with code ${code ?? "null"}${stderr.trim() ? `: ${stderr.trim().slice(0, 500)}` : ""}`,
          exitCode: code,
          errorCode: code,
          stdout,
          stderr,
          syscall: `spawn ${call.command}`,
        }),
      );
    });
  });
}
