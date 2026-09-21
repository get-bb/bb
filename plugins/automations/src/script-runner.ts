import { execFile, spawn, type ChildProcess } from "node:child_process";
import { constants } from "node:fs";
import { delimiter, dirname, isAbsolute, join } from "node:path";
import { promisify, stripVTControlCharacters } from "node:util";
import { access, mkdir, stat } from "node:fs/promises";
import {
  AUTOMATION_SCRIPT_TIMEOUT_MAX_MS,
  type AutomationScriptInterpreter,
} from "./rpc-types.js";
import {
  resolveAutomationScriptPath,
  resolveDefaultInterpreter,
  scriptsRoot,
} from "./script-files.js";
// bb-fork(windows): platform-aware bb CLI probing.
import {
  bbProbeCandidates,
  bbProbeCommand,
} from "./script-runner.fork.js";

const execFileAsync = promisify(execFile);
const SCRIPT_OUTPUT_MAX_BYTES = 1024 * 1024;
const SCRIPT_FAILURE_DETAIL_MAX_CHARS = 200;

let resolvedBbPath: string | null = null;

const BB_NOT_INJECTED_WARNING =
  "[bb] warning: could not locate the bb CLI, so `bb` is not on PATH for this script.";

async function commandWorks(candidate: string, args: string[]): Promise<boolean> {
  // bb-fork(windows): a .cmd launcher needs shell, an extensionless bundle needs Node,
  // and a POSIX-shell shim is not runnable here at all.
  const probe = bbProbeCommand(candidate, args);
  if (probe === null) return false;
  try {
    await execFileAsync(probe.command, probe.args, {
      timeout: 5_000,
      shell: probe.shell,
    });
    return true;
  } catch {
    return false;
  }
}

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

async function isDirectory(candidate: string): Promise<boolean> {
  try {
    return (await stat(candidate)).isDirectory();
  } catch {
    return false;
  }
}

async function resolveBbBinary(
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  if (resolvedBbPath !== null) return resolvedBbPath;
  // bb-fork(windows): also try each candidate's bb.cmd launcher.
  for (const candidate of bbProbeCandidates(bbBinaryCandidates(env))) {
    if (!(await isExecutableFile(candidate))) continue;
    if (await commandWorks(candidate, ["--version"])) {
      resolvedBbPath = candidate;
      return candidate;
    }
  }
  return null;
}

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
  stderr: string;
  timedOut: boolean;
  /**
   * bb-fork(windows): plugin diagnostics about the run itself (today: bb is not on the
   * script's PATH). Kept out of `output` so it cannot turn a silent tick into a run.
   */
  warning?: string | null;
}

interface ScriptRunOutcome {
  status: "succeeded" | "failed" | "skipped";
  output: string | null;
  exitCode: number | null;
  error: string | null;
  skipReason: string | null;
}

function firstStderrLine(stderr: string): string | null {
  let start = 0;
  while (start < stderr.length) {
    const newline = stderr.indexOf("\n", start);
    const lineEnd = newline === -1 ? stderr.length : newline;
    const trimmedEnd =
      lineEnd > start && stderr[lineEnd - 1] === "\r" ? lineEnd - 1 : lineEnd;
    if (trimmedEnd > start) {
      const trimmed = stripVTControlCharacters(stderr.slice(start, trimmedEnd))
        .replace(/\p{Cc}/gu, " ")
        .trim();
      if (trimmed.length > 0) {
        return trimmed.length > SCRIPT_FAILURE_DETAIL_MAX_CHARS
          ? `${trimmed.slice(0, SCRIPT_FAILURE_DETAIL_MAX_CHARS - 1)}…`
          : trimmed;
      }
    }
    if (newline === -1) break;
    start = newline + 1;
  }
  return null;
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
    const detail = firstStderrLine(result.stderr);
    return {
      status: "failed",
      output: result.output.length > 0 ? result.output : null,
      exitCode: result.exitCode,
      error: `Script exited with code ${result.exitCode}${
        detail === null ? "" : `: ${detail}`
      }`,
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
    } catch {}
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
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      resolve({
        exitCode: timedOut ? null : outputLimitExceeded ? 1 : code,
        output: `${Buffer.concat(stdoutChunks).toString("utf8")}${stderr}${suffix}`,
        stderr,
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
  workingDir: string;
}): Promise<ScriptRunResult> {
  const scriptPath = await resolveAutomationScriptPath({
    dataDir: args.pluginDataDir,
    automationId: args.automationId,
    scriptFile: args.scriptFile,
  });
  const interpreter =
    args.interpreter ?? resolveDefaultInterpreter(args.scriptFile);
  const bbPath = await resolveBbBinary();
  const warning = bbPath === null ? BB_NOT_INJECTED_WARNING : null;
  const scriptEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...(args.env ?? {}),
    PATH: scriptPathEnv(bbPath, process.env.PATH),
    BB_SERVER_URL: args.serverUrl,
    BB_PROJECT_ID: args.projectId,
    BB_AUTOMATION_ID: args.automationId,
    BB_AUTOMATION_RUN_ID: args.runId,
  };
  if (bbPath !== null) {
    scriptEnv.BB_CLI = bbPath;
  }
  await mkdir(scriptsRoot(args.pluginDataDir), { recursive: true });
  if (!(await isDirectory(args.workingDir))) {
    throw new Error(
      `Script working directory is not an existing directory: ${args.workingDir}`,
    );
  }
  const cwd = args.workingDir;
  const result = await executeWithProcessGroup({
    command: interpreter,
    scriptPath,
    cwd,
    timeoutMs: Math.min(args.timeoutMs, AUTOMATION_SCRIPT_TIMEOUT_MAX_MS),
    env: scriptEnv,
  });
  // bb-fork(windows): the warning travels beside the script's own output, not inside it.
  return { ...result, warning };
}
