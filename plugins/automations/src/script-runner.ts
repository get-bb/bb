import { execFile, spawn, type ChildProcess } from "node:child_process";
import { constants } from "node:fs";
import { delimiter, dirname, isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { access, mkdir, stat } from "node:fs/promises";
import {
  AUTOMATION_SCRIPT_TIMEOUT_MAX_MS,
  type AutomationScriptInterpreter,
} from "./rpc-types.js";
import {
  resolveAutomationScriptPath,
  resolveDefaultInterpreter,
  resolveInterpreterCommand,
  scriptsRoot,
} from "./script-files.js";

const execFileAsync = promisify(execFile);
const SCRIPT_OUTPUT_MAX_BYTES = 1024 * 1024;

let resolvedBbPath: string | null = null;

/** Warning prepended to a script's output when bb could not be injected. */
export const BB_NOT_INJECTED_WARNING =
  "[bb] warning: could not locate the bb CLI, so `bb` is not on PATH for this script.";

async function commandWorks(command: string, args: string[]): Promise<boolean> {
  try {
    await execFileAsync(command, args, { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Ordered places to look for the bb CLI, most authoritative first.
 *
 * Every candidate is an absolute path. The resolved value is handed to scripts
 * as `BB_CLI`, which is documented as an absolute path, and a script is free to
 * rewrite `PATH` before it runs `"$BB_CLI"` — a bare `bb` would then resolve to
 * a different binary, or to none. Expanding `PATH` here rather than letting the
 * shell do it also keeps the probe and the script on the same executable.
 *
 * The env vars come before `PATH` because the server process does not reliably
 * inherit a `PATH` containing bb: on a packaged install bb lives in the daemon
 * bundle directory, which is on no shell `PATH`. `BB_CLI` (the binary) and
 * `BB_CLI_DIR` (its directory) are the two documented pointers; see
 * packages/config/src/env-vars.ts. Relative values are skipped rather than
 * resolved against the process cwd, which has nothing to do with either.
 *
 * The trailing paths are macOS-only install locations, kept as a last resort.
 * Relying on them alone is what left Linux hosts unable to resolve bb at all.
 */
export function bbBinaryCandidates(env: NodeJS.ProcessEnv): string[] {
  const candidates: string[] = [];
  const pushIfAbsolute = (candidate: string): void => {
    if (isAbsolute(candidate)) {
      candidates.push(candidate);
    }
  };
  const fromCli = env.BB_CLI?.trim();
  if (fromCli !== undefined && fromCli.length > 0) {
    pushIfAbsolute(fromCli);
  }
  const fromCliDir = env.BB_CLI_DIR?.trim();
  if (fromCliDir !== undefined && fromCliDir.length > 0) {
    pushIfAbsolute(join(fromCliDir, "bb"));
  }
  // Empty PATH entries mean "the current directory". Scripts run inside the
  // automation scripts directory, so honouring one would let a file named `bb`
  // dropped next to a script stand in for the CLI.
  for (const entry of (env.PATH ?? "").split(delimiter)) {
    const trimmed = entry.trim();
    if (trimmed.length > 0) {
      pushIfAbsolute(join(trimmed, "bb"));
    }
  }
  candidates.push("/opt/homebrew/bin/bb", "/usr/local/bin/bb");
  return candidates;
}

async function isExecutableFile(candidate: string): Promise<boolean> {
  try {
    const stats = await stat(candidate);
    if (!stats.isFile()) return false;
    await access(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Locate the bb CLI so it can be put on a script's PATH. Returns null rather
 * than throwing: injection is a convenience for scripts that call `bb`, not a
 * precondition for running one. Failing the whole automation here meant a
 * script that never mentions bb still died before its first line.
 *
 * Candidates are stat-ed before being executed. Expanding `PATH` makes the list
 * long, and spawning a process per entry — each with its own timeout — would
 * make a host without bb pay seconds on every run.
 */
export async function resolveBbBinary(
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  if (resolvedBbPath !== null) return resolvedBbPath;
  for (const candidate of bbBinaryCandidates(env)) {
    if (!(await isExecutableFile(candidate))) continue;
    if (await commandWorks(candidate, ["--version"])) {
      resolvedBbPath = candidate;
      return candidate;
    }
  }
  return null;
}

/**
 * PATH for a script run, with bb's directory prepended when it is known.
 *
 * The absolute-path guard is belt and braces: bbBinaryCandidates only yields
 * absolute paths, so a relative one would mean dirname() could return ".",
 * putting the automation scripts directory ahead of the system PATH.
 */
export function scriptPathEnv(
  bbPath: string | null,
  inheritedPath: string | undefined,
): string {
  const basePath = inheritedPath ?? "";
  if (bbPath === null || !isAbsolute(bbPath)) {
    return basePath;
  }
  const bbDir = dirname(bbPath);
  return basePath.length > 0 ? `${bbDir}${delimiter}${basePath}` : bbDir;
}

export function isWakeAgentSuppressed(output: string): boolean {
  const lines = output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const last = lines[lines.length - 1];
  if (last === undefined) return false;
  try {
    const parsed: unknown = JSON.parse(last);
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      "wakeAgent" in parsed &&
      (parsed as { wakeAgent: unknown }).wakeAgent === false
    );
  } catch {
    return false;
  }
}

export interface ScriptRunResult {
  exitCode: number | null;
  output: string;
  timedOut: boolean;
}

export interface ScriptRunOutcome {
  status: "succeeded" | "failed" | "skipped";
  output: string | null;
  exitCode: number | null;
  error: string | null;
  skipReason: string | null;
}

export function mapScriptResultToRun(
  result: ScriptRunResult,
): ScriptRunOutcome {
  if (result.timedOut) {
    return {
      status: "failed",
      output: result.output.length > 0 ? result.output : null,
      exitCode: null,
      error: "Script timed out",
      skipReason: null,
    };
  }
  if (result.exitCode !== 0) {
    return {
      status: "failed",
      output: result.output.length > 0 ? result.output : null,
      exitCode: result.exitCode,
      error: `Script exited with code ${result.exitCode}`,
      skipReason: null,
    };
  }
  if (result.output.trim().length === 0) {
    return {
      status: "skipped",
      output: null,
      exitCode: 0,
      error: null,
      skipReason: "empty output",
    };
  }
  if (isWakeAgentSuppressed(result.output)) {
    return {
      status: "skipped",
      output: null,
      exitCode: 0,
      error: null,
      skipReason: "wakeAgent false",
    };
  }
  return {
    status: "succeeded",
    output: result.output,
    exitCode: 0,
    error: null,
    skipReason: null,
  };
}

function signalProcessGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  try {
    if (process.platform !== "win32" && child.pid !== undefined) {
      process.kill(-child.pid, signal);
      return;
    }
    child.kill(signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
    try {
      child.kill(signal);
    } catch {
      // The child may have exited between the group and direct signals.
    }
  }
}

function executeWithProcessGroup(args: {
  command: string;
  scriptPath: string;
  cwd: string;
  timeoutMs: number;
  env: NodeJS.ProcessEnv;
}): Promise<ScriptRunResult> {
  return new Promise((resolve) => {
    let timedOut = false;
    let outputLimitExceeded = false;
    let outputBytes = 0;
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let forceKill: NodeJS.Timeout | undefined;
    let timeout: NodeJS.Timeout;
    const child = spawn(args.command, [args.scriptPath], {
      cwd: args.cwd,
      detached: process.platform !== "win32",
      env: args.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const terminateGroup = (): void => {
      signalProcessGroup(child, "SIGTERM");
      if (forceKill) return;
      forceKill = setTimeout(() => {
        signalProcessGroup(child, "SIGKILL");
      }, 1_000);
      forceKill.unref();
    };
    const capture = (target: Buffer[], chunk: Buffer | string): void => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = SCRIPT_OUTPUT_MAX_BYTES - outputBytes;
      if (remaining > 0) {
        const captured = buffer.subarray(0, remaining);
        target.push(captured);
        outputBytes += captured.byteLength;
      }
      if (buffer.byteLength > remaining && !outputLimitExceeded) {
        outputLimitExceeded = true;
        terminateGroup();
      }
    };
    child.stdout?.on("data", (chunk: Buffer) => capture(stdoutChunks, chunk));
    child.stderr?.on("data", (chunk: Buffer) => capture(stderrChunks, chunk));
    child.once("error", (error) => {
      capture(stderrChunks, `${error.message}\n`);
      terminateGroup();
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (forceKill) clearTimeout(forceKill);
      if (timedOut || outputLimitExceeded) {
        signalProcessGroup(child, "SIGKILL");
      }
      const suffix = outputLimitExceeded ? "\n[output truncated]\n" : "";
      resolve({
        exitCode: timedOut ? null : outputLimitExceeded ? 1 : code,
        output: `${Buffer.concat(stdoutChunks).toString("utf8")}${Buffer.concat(
          stderrChunks,
        ).toString("utf8")}${suffix}`,
        timedOut,
      });
    });
    timeout = setTimeout(() => {
      timedOut = true;
      terminateGroup();
    }, args.timeoutMs);
    timeout.unref();
  });
}

export async function executeStoredScript(args: {
  pluginDataDir: string;
  automationId: string;
  runId: string;
  projectId: string;
  scriptFile: string;
  interpreter?: AutomationScriptInterpreter;
  timeoutMs: number;
  env?: Record<string, string>;
  serverUrl: string;
}): Promise<ScriptRunResult> {
  const scriptPath = await resolveAutomationScriptPath({
    dataDir: args.pluginDataDir,
    automationId: args.automationId,
    scriptFile: args.scriptFile,
  });
  const interpreter =
    args.interpreter ?? resolveDefaultInterpreter(args.scriptFile);
  const command = resolveInterpreterCommand(interpreter);
  const bbPath = await resolveBbBinary();
  // A script that never calls bb must still run, so an unresolved CLI only
  // costs the PATH injection and leaves a note in the captured output.
  const warning = bbPath === null ? `${BB_NOT_INJECTED_WARNING}\n` : "";
  const scriptEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...(args.env ?? {}),
    PATH: scriptPathEnv(bbPath, process.env.PATH),
    BB_SERVER_URL: args.serverUrl,
    BB_PROJECT_ID: args.projectId,
    BB_AUTOMATION_ID: args.automationId,
    BB_AUTOMATION_RUN_ID: args.runId,
  };
  // Scripts are told where bb is the same way agent shells are, so `"$BB_CLI"`
  // works even when the directory is already on PATH.
  if (bbPath !== null) {
    scriptEnv.BB_CLI = bbPath;
  }
  const cwd = scriptsRoot(args.pluginDataDir);
  await mkdir(cwd, { recursive: true });
  const result = await executeWithProcessGroup({
    command,
    scriptPath,
    cwd,
    timeoutMs: Math.min(args.timeoutMs, AUTOMATION_SCRIPT_TIMEOUT_MAX_MS),
    env: scriptEnv,
  });
  return { ...result, output: `${warning}${result.output}` };
}
