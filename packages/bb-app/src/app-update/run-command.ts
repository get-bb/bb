import { spawn } from "node:child_process";

const OUTPUT_TAIL_LINES = 40;

export interface RunCommandArgs {
  args: string[];
  command: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  onLine?: (line: string) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface RunCommandResult {
  code: number | null;
  outputTail: string[];
  signal: NodeJS.Signals | null;
  stdout: string;
}

export type RunCommand = (args: RunCommandArgs) => Promise<RunCommandResult>;

export class CommandFailedError extends Error {
  constructor(
    readonly label: string,
    readonly result: RunCommandResult,
  ) {
    const lastLine = result.outputTail.at(-1);
    super(
      `${label} failed with ${
        result.code === null
          ? `signal ${result.signal ?? "unknown"}`
          : `exit code ${String(result.code)}`
      }${lastLine === undefined ? "" : `: ${lastLine}`}`,
    );
  }
}

export const runCommand: RunCommand = (args) =>
  new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(args.command, args.args, {
      cwd: args.cwd,
      env: args.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const tail: string[] = [];
    const stdoutChunks: Buffer[] = [];
    const pushLines = (chunk: Buffer, partial: { value: string }): void => {
      const text = partial.value + chunk.toString("utf8");
      const lines = text.split(/\r?\n/u);
      partial.value = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim() === "") continue;
        tail.push(line);
        if (tail.length > OUTPUT_TAIL_LINES) tail.shift();
        args.onLine?.(line);
      }
    };
    const stdoutPartial = { value: "" };
    const stderrPartial = { value: "" };
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      pushLines(chunk, stdoutPartial);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      pushLines(chunk, stderrPartial);
    });
    const timeout =
      args.timeoutMs === undefined
        ? null
        : setTimeout(() => {
            tail.push(
              `Timed out after ${String(Math.round((args.timeoutMs ?? 0) / 1000))}s`,
            );
            child.kill("SIGTERM");
          }, args.timeoutMs);
    const onAbort = (): void => {
      tail.push("Cancelled");
      child.kill("SIGTERM");
    };
    if (args.signal?.aborted === true) onAbort();
    args.signal?.addEventListener("abort", onAbort, { once: true });
    child.once("error", (error) => {
      if (timeout !== null) clearTimeout(timeout);
      args.signal?.removeEventListener("abort", onAbort);
      rejectPromise(error);
    });
    child.once("close", (code, signal) => {
      if (timeout !== null) clearTimeout(timeout);
      args.signal?.removeEventListener("abort", onAbort);
      for (const partial of [stdoutPartial, stderrPartial]) {
        if (partial.value.trim() !== "") {
          tail.push(partial.value);
          if (tail.length > OUTPUT_TAIL_LINES) tail.shift();
          args.onLine?.(partial.value);
        }
      }
      resolvePromise({
        code,
        outputTail: tail,
        signal,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
      });
    });
  });

export async function runCheckedCommand(
  runner: RunCommand,
  label: string,
  args: RunCommandArgs,
): Promise<RunCommandResult> {
  const result = await runner(args);
  if (result.code !== 0) {
    throw new CommandFailedError(label, result);
  }
  return result;
}
