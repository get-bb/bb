import { execFile } from "node:child_process";
import { dirname } from "node:path";
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

async function commandWorks(command: string, args: string[]): Promise<boolean> {
  try {
    await execFileAsync(command, args, { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

export async function resolveBbBinary(): Promise<string> {
  if (resolvedBbPath !== null) return resolvedBbPath;
  const candidates = ["bb", "/opt/homebrew/bin/bb", "/usr/local/bin/bb"];
  for (const candidate of candidates) {
    if (await commandWorks(candidate, ["--version"])) {
      resolvedBbPath = candidate;
      return candidate;
    }
  }
  throw new Error("bb CLI not found on PATH or in common install locations");
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
  const cwd = scriptsRoot(args.pluginDataDir);
  await mkdir(cwd, { recursive: true });
  try {
    const result = await execFileAsync(command, [scriptPath], {
      cwd,
      timeout: Math.min(args.timeoutMs, AUTOMATION_SCRIPT_TIMEOUT_MAX_MS),
      maxBuffer: SCRIPT_OUTPUT_MAX_BYTES,
      env: {
        ...process.env,
        ...(args.env ?? {}),
        PATH: `${dirname(bbPath)}:${process.env.PATH ?? ""}`,
        BB_SERVER_URL: args.serverUrl,
        BB_PROJECT_ID: args.projectId,
        BB_AUTOMATION_ID: args.automationId,
        BB_AUTOMATION_RUN_ID: args.runId,
      },
    });
    return {
      exitCode: 0,
      output: combinedOutput(result.stdout, result.stderr),
      timedOut: false,
    };
  } catch (error) {
    const err = error as ExecFileError;
    return {
      exitCode: exitCodeFromError(err),
      output: combinedOutput(err.stdout ?? "", err.stderr ?? ""),
      timedOut: err.killed === true && err.signal === "SIGTERM",
    };
  }
}
