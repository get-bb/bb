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

/**
 * Base the script env on the daemon's own inherited process env (so scripts get
 * PATH for `bb`/`node` and pass-through BB_* like BB_DEV_REMOTE), then overlay
 * the server-provided env so injected vars (BB_SERVER_URL, BB_AUTOMATION_ID, …)
 * win. Mirrors Hermes no_agent inheriting the gateway process env.
 */
export function buildInheritedScriptEnv(
  commandEnv: Record<string, string>,
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      merged[key] = value;
    }
  }
  return { ...merged, ...commandEnv };
}

export interface RunScriptProcessResult {
  exitCode: number | null;
  output: string;
  durationMs: number;
  timedOut: boolean;
}

// Process groups exist on POSIX; on Windows we fall back to killing the direct
// child (mirrors `runSetupScript` in @bb/host-workspace).
function shouldRunInProcessGroup(): boolean {
  return process.platform !== "win32";
}

/**
 * Kill the whole process group on POSIX so a script that spawned descendants
 * does not leave orphans on timeout; fall back to the direct child if the group
 * is already gone (or on Windows).
 */
function killScriptProcess(child: PortableOutputChildProcess): void {
  if (shouldRunInProcessGroup() && child.pid !== undefined) {
    try {
      process.kill(-child.pid, "SIGKILL");
      return;
    } catch {
      // Fall back to killing the direct child if the group is gone.
    }
  }
  child.kill("SIGKILL");
}

/**
 * Accumulates streamed chunks while enforcing a hard byte cap so a noisy script
 * cannot grow daemon memory. Once the cap is reached, excess bytes are dropped
 * and a single truncation marker is appended on read.
 */
class CappedOutputBuffer {
  private chunks: string[] = [];
  private bytes = 0;
  private truncated = false;

  append(chunk: Buffer): void {
    if (this.truncated) {
      return;
    }
    const remaining = RUN_SCRIPT_OUTPUT_CAP_BYTES - this.bytes;
    if (chunk.byteLength <= remaining) {
      this.chunks.push(chunk.toString("utf8"));
      this.bytes += chunk.byteLength;
      return;
    }
    // Keep only the bytes that fit under the cap, then stop appending.
    if (remaining > 0) {
      this.chunks.push(chunk.subarray(0, remaining).toString("utf8"));
      this.bytes += remaining;
    }
    this.truncated = true;
  }

  toString(): string {
    const head = this.chunks.join("");
    return this.truncated
      ? `${head}${RUN_SCRIPT_OUTPUT_TRUNCATION_MARKER}`
      : head;
  }
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
    // Run in its own process group on POSIX so a timeout can kill descendants.
    detached: shouldRunInProcessGroup(),
  });

  const output = new CappedOutputBuffer();
  let timedOut = false;

  const handleChunk = (chunk: Buffer): void => {
    output.append(chunk);
  };
  child.stdout.on("data", handleChunk);
  child.stderr.on("data", handleChunk);

  const timeout = setTimeout(() => {
    timedOut = true;
    killScriptProcess(child);
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
      output: output.toString(),
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
    env: buildInheritedScriptEnv(command.env),
    timeoutMs: command.timeoutMs,
  });
}
