import type { HostDaemonCommandResult } from "@bb/host-daemon-contract";
import {
  spawnPortableOutputProcess,
  type PortableOutputChildProcess,
} from "@bb/process-utils";
import {
  type CommandDispatchOptions,
  type CommandOf,
} from "../command-dispatch-support.js";
import { requireResolvedWorkspaceForCommand } from "../workspace-resolution.js";

// Output stored on the run row lives in SQLite, so it must be bounded. Mirrors
// the server-side cap; the daemon truncates the tail and marks it explicitly.
const RUN_SCRIPT_OUTPUT_CAP_BYTES = 64 * 1024;
const RUN_SCRIPT_OUTPUT_TRUNCATION_MARKER = "\n[output truncated]\n";

export interface RunScriptProcessArgs {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
}

export interface RunScriptProcessResult {
  exitCode: number | null;
  output: string;
  durationMs: number;
  timedOut: boolean;
}

function capOutput(output: string): string {
  if (Buffer.byteLength(output, "utf8") <= RUN_SCRIPT_OUTPUT_CAP_BYTES) {
    return output;
  }
  const head = Buffer.from(output, "utf8")
    .subarray(0, RUN_SCRIPT_OUTPUT_CAP_BYTES)
    .toString("utf8");
  return `${head}${RUN_SCRIPT_OUTPUT_TRUNCATION_MARKER}`;
}

/**
 * Spawn a one-shot command, capture combined stdout/stderr, and resolve with the
 * exit code. Never throws on a non-zero exit (that is a recorded run failure, not
 * an RPC failure). A process that overruns `timeoutMs` is SIGKILL'd and reported
 * with `timedOut: true`.
 */
export async function runScriptProcess(
  args: RunScriptProcessArgs,
): Promise<RunScriptProcessResult> {
  const startedAt = Date.now();
  const child: PortableOutputChildProcess = spawnPortableOutputProcess({
    command: args.command,
    args: args.args,
    cwd: args.cwd,
    env: args.env,
  });

  const outputChunks: string[] = [];
  let timedOut = false;

  const handleChunk = (chunk: Buffer): void => {
    outputChunks.push(chunk.toString("utf8"));
  };
  child.stdout.on("data", handleChunk);
  child.stderr.on("data", handleChunk);

  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, args.timeoutMs);

  try {
    const result = await new Promise<{
      exitCode: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (exitCode, signal) => resolve({ exitCode, signal }));
    });
    return {
      exitCode: result.exitCode,
      output: capOutput(outputChunks.join("")),
      durationMs: Date.now() - startedAt,
      timedOut,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function runScript(
  command: CommandOf<"host.run_script">,
  options: CommandDispatchOptions,
): Promise<HostDaemonCommandResult<"host.run_script">> {
  // Resolve the workspace to validate the environment exists before spawning.
  await requireResolvedWorkspaceForCommand({
    dataDir: options.dataDir,
    environmentId: command.environmentId,
    runtimeManager: options.runtimeManager,
    workspaceContext: command.workspaceContext,
  });
  return runScriptProcess({
    command: command.command,
    args: command.args,
    cwd: command.cwd,
    env: command.env,
    timeoutMs: command.timeoutMs,
  });
}
