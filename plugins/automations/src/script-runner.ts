import { execFile } from "node:child_process";
import { dirname, isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { mkdir } from "node:fs/promises";
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
 * The env vars come before PATH because the server process does not reliably
 * inherit a PATH containing bb — on a packaged install bb lives in the daemon
 * bundle directory, which is not on any shell PATH. `BB_CLI` (absolute path to
 * the binary) and `BB_CLI_DIR` (the directory holding it) are the two
 * documented pointers; see packages/config/src/env-vars.ts.
 *
 * The trailing absolute paths are macOS-only install locations and are kept as
 * a last resort. Relying on them alone is what left Linux hosts with no way to
 * resolve bb at all.
 */
export function bbBinaryCandidates(env: NodeJS.ProcessEnv): string[] {
  const candidates: string[] = [];
  const fromCli = env.BB_CLI?.trim();
  if (fromCli !== undefined && fromCli.length > 0) {
    candidates.push(fromCli);
  }
  const fromCliDir = env.BB_CLI_DIR?.trim();
  if (fromCliDir !== undefined && fromCliDir.length > 0) {
    candidates.push(join(fromCliDir, "bb"));
  }
  candidates.push("bb", "/opt/homebrew/bin/bb", "/usr/local/bin/bb");
  return candidates;
}

/**
 * Locate the bb CLI so it can be put on a script's PATH. Returns null rather
 * than throwing: injection is a convenience for scripts that call `bb`, not a
 * precondition for running one. Failing the whole automation here meant a
 * script that never mentions bb still died before its first line.
 */
export async function resolveBbBinary(
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  if (resolvedBbPath !== null) return resolvedBbPath;
  for (const candidate of bbBinaryCandidates(env)) {
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
 * A bare `bb` resolved off PATH is deliberately not prepended: `dirname("bb")`
 * is ".", and prepending "." would put the automation scripts directory ahead
 * of the system PATH, letting a file named `git` or `node` sitting next to a
 * script shadow the real binary.
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
  return basePath.length > 0 ? `${bbDir}:${basePath}` : bbDir;
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

export function mapScriptResultToRun(result: ScriptRunResult): ScriptRunOutcome {
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

function trimOutput(output: string): string {
  if (Buffer.byteLength(output, "utf8") <= SCRIPT_OUTPUT_MAX_BYTES) {
    return output;
  }
  return `${output.slice(0, SCRIPT_OUTPUT_MAX_BYTES)}\n[output truncated]\n`;
}

function combinedOutput(stdout: string | Buffer, stderr: string | Buffer): string {
  return trimOutput(`${String(stdout)}${String(stderr)}`);
}

interface ExecFileError extends Error {
  code?: number | string;
  signal?: NodeJS.Signals;
  killed?: boolean;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
}

function exitCodeFromError(error: ExecFileError): number | null {
  return typeof error.code === "number" ? error.code : null;
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
  const interpreter = args.interpreter ?? resolveDefaultInterpreter(args.scriptFile);
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
  try {
    const result = await execFileAsync(command, [scriptPath], {
      cwd,
      timeout: Math.min(args.timeoutMs, AUTOMATION_SCRIPT_TIMEOUT_MAX_MS),
      maxBuffer: SCRIPT_OUTPUT_MAX_BYTES,
      env: scriptEnv,
    });
    return {
      exitCode: 0,
      output: `${warning}${combinedOutput(result.stdout, result.stderr)}`,
      timedOut: false,
    };
  } catch (error) {
    const err = error as ExecFileError;
    return {
      exitCode: exitCodeFromError(err),
      output: `${warning}${combinedOutput(err.stdout ?? "", err.stderr ?? "")}`,
      timedOut: err.killed === true && err.signal === "SIGTERM",
    };
  }
}
