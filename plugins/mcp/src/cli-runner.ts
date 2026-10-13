import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, extname, isAbsolute, join } from "node:path";
import { createLimiter } from "./limiter.js";

const OUTPUT_MAX_BYTES = 512 * 1024;
const KILL_GRACE_MS = 2_000;
const CLOSE_GRACE_MS = 1_000;
export const MAX_CONCURRENT_CLI_PROCESSES = 8;
const STRIPPED_ENVIRONMENT_KEYS = [
  "BB_THREAD_ID",
  "BB_PROJECT_ID",
  "BB_ENVIRONMENT_ID",
  "BB_THREAD_STORAGE",
  "BB_SERVER_HEADERS",
];

export interface CliRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
}

export interface CliRunOptions {
  stdin: string | null;
  timeoutMs: number;
  signal: AbortSignal;
}

export type CliRunner = (
  argv: readonly string[],
  options: CliRunOptions,
) => Promise<CliRunResult>;

export class CliUnavailableError extends Error {
  constructor() {
    super(
      "The bb CLI could not be found on the bb server's machine, so MCP calls cannot run commands.",
    );
    this.name = "CliUnavailableError";
  }
}

export function bbBinaryCandidates(env: NodeJS.ProcessEnv): string[] {
  const candidates: string[] = [];
  const pushIfAbsolute = (candidate: string): void => {
    if (isAbsolute(candidate)) candidates.push(candidate);
  };
  const fromCli = env.BB_CLI?.trim();
  if (fromCli !== undefined && fromCli.length > 0) pushIfAbsolute(fromCli);
  const fromCliDir = env.BB_CLI_DIR?.trim();
  if (fromCliDir !== undefined && fromCliDir.length > 0) {
    pushIfAbsolute(join(fromCliDir, "bb"));
  }
  for (const entry of (env.PATH ?? "").split(delimiter)) {
    const trimmed = entry.trim();
    if (trimmed.length > 0) pushIfAbsolute(join(trimmed, "bb"));
  }
  candidates.push("/opt/homebrew/bin/bb", "/usr/local/bin/bb");
  return candidates;
}

async function isExecutableFile(candidate: string): Promise<boolean> {
  try {
    if (!(await stat(candidate)).isFile()) return false;
    await access(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function resolveBbBinary(
  env: NodeJS.ProcessEnv,
): Promise<string | null> {
  for (const candidate of bbBinaryCandidates(env)) {
    if (await isExecutableFile(candidate)) return candidate;
  }
  return null;
}

export function cliEnvironment(
  env: NodeJS.ProcessEnv,
  serverUrl: string,
): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = { ...env };
  for (const key of STRIPPED_ENVIRONMENT_KEYS) delete next[key];
  next.BB_SERVER_URL = serverUrl;
  next.NO_COLOR = "1";
  next.FORCE_COLOR = "0";
  return next;
}

class BoundedOutput {
  private readonly chunks: Buffer[] = [];
  private bytes = 0;
  truncated = false;

  push(chunk: Buffer): void {
    if (this.truncated) return;
    const remaining = OUTPUT_MAX_BYTES - this.bytes;
    if (chunk.length > remaining) {
      this.chunks.push(chunk.subarray(0, remaining));
      this.bytes = OUTPUT_MAX_BYTES;
      this.truncated = true;
      return;
    }
    this.chunks.push(chunk);
    this.bytes += chunk.length;
  }

  text(): string {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

export function resolveCliLaunch(
  binary: string,
  argv: readonly string[],
  platform: NodeJS.Platform,
  nodePath: string,
): { command: string; args: string[] } {
  return platform === "win32" && extname(binary) === ""
    ? { command: nodePath, args: [binary, ...argv] }
    : { command: binary, args: [...argv] };
}

export function createCliRunner(options: {
  env: NodeJS.ProcessEnv;
  serverUrl: () => string;
  resolveBinary?: (env: NodeJS.ProcessEnv) => Promise<string | null>;
  maxConcurrent?: number;
}): CliRunner {
  const resolve = options.resolveBinary ?? resolveBbBinary;
  const limiter = createLimiter(
    options.maxConcurrent ?? MAX_CONCURRENT_CLI_PROCESSES,
  );
  const ownsProcessGroup = process.platform !== "win32";
  let binary: Promise<string | null> | null = null;

  const runOnce = (
    resolved: string,
    argv: readonly string[],
    runOptions: CliRunOptions,
  ) =>
    new Promise<CliRunResult>((resolveRun, rejectRun) => {
      const launch = resolveCliLaunch(
        resolved,
        argv,
        process.platform,
        process.execPath,
      );
      const child = spawn(launch.command, launch.args, {
        cwd: homedir(),
        detached: ownsProcessGroup,
        env: cliEnvironment(options.env, options.serverUrl()),
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      const stdout = new BoundedOutput();
      const stderr = new BoundedOutput();
      let timedOut = false;
      let settled = false;
      let killTimer: NodeJS.Timeout | null = null;
      let closeTimer: NodeJS.Timeout | null = null;

      const signalChild = (signal: NodeJS.Signals) => {
        if (ownsProcessGroup && child.pid !== undefined) {
          try {
            process.kill(-child.pid, signal);
            return;
          } catch {
            child.kill(signal);
            return;
          }
        }
        child.kill(signal);
      };
      const terminate = () => {
        if (child.exitCode !== null || child.signalCode !== null) return;
        signalChild("SIGTERM");
        killTimer ??= setTimeout(() => signalChild("SIGKILL"), KILL_GRACE_MS);
      };
      const timeout = setTimeout(() => {
        timedOut = true;
        terminate();
      }, runOptions.timeoutMs);
      const onAbort = () => terminate();
      runOptions.signal.addEventListener("abort", onAbort, { once: true });
      if (runOptions.signal.aborted) terminate();

      const finish = (exitCode: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (killTimer !== null) clearTimeout(killTimer);
        if (closeTimer !== null) clearTimeout(closeTimer);
        runOptions.signal.removeEventListener("abort", onAbort);
        child.stdout.destroy();
        child.stderr.destroy();
        resolveRun({
          exitCode,
          stdout: stdout.text(),
          stderr: stderr.text(),
          timedOut,
          truncated: stdout.truncated || stderr.truncated,
        });
      };

      child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      child.stdin.on("error", () => {});
      child.stdin.end(runOptions.stdin ?? "");
      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (killTimer !== null) clearTimeout(killTimer);
        runOptions.signal.removeEventListener("abort", onAbort);
        rejectRun(error);
      });
      child.on("exit", (exitCode) => {
        closeTimer = setTimeout(() => finish(exitCode), CLOSE_GRACE_MS);
      });
      child.on("close", (exitCode) => finish(exitCode));
    });

  return async (argv, runOptions) => {
    binary ??= resolve(options.env);
    const resolved = await binary;
    if (resolved === null) {
      binary = null;
      throw new CliUnavailableError();
    }
    return limiter.run(
      () => runOnce(resolved, argv, runOptions),
      runOptions.signal,
    );
  };
}
