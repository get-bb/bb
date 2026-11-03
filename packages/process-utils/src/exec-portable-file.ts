import { execa } from "execa";
import {
  runVcsProcess,
  type VcsProcessPriority,
} from "./vcs-process-scheduler.js";
import { basename } from "node:path";
import { hostToolchain } from "./host-toolchain.js";
import { createProcessStop } from "./managed-process.js";
import {
  supportsProcessGroups,
  type ProcessStopResult,
} from "./process-group.js";

interface ExecPortableFileOptions {
  priority?: VcsProcessPriority;
  cwd: string;
  env: NodeJS.ProcessEnv;
  maxBuffer: number;
  timeout?: number;
  signal?: AbortSignal;
  input?: string;
  onStderr?: (chunk: string) => void;
}

export function resolvePortableCommand(
  command: string,
  options: { cwd: string; env: NodeJS.ProcessEnv },
): string | undefined {
  return hostToolchain.resolve(command, options) ?? undefined;
}

export async function execPortableFile(
  command: string,
  args: string[],
  options: ExecPortableFileOptions,
): Promise<{ stdout: string; stderr: string }> {
  const executable = basename(command)
    .toLowerCase()
    .replace(/\.(exe|cmd|bat)$/u, "");
  if (executable === "git" || executable === "gh") {
    return runVcsProcess(
      executable,
      args,
      () => execPortableFileUnbounded(command, args, options),
      {
        priority: options.priority,
        signal: options.signal,
      },
    );
  }
  return execPortableFileUnbounded(command, args, options);
}

async function execPortableFileUnbounded(
  command: string,
  args: string[],
  options: ExecPortableFileOptions,
): Promise<{ stdout: string; stderr: string }> {
  if (options.signal?.aborted) throw options.signal.reason;
  if (
    process.platform === "win32" &&
    resolvePortableCommand(command, options) === undefined
  ) {
    throw Object.assign(new Error(`spawn ${command} ENOENT`), {
      code: "ENOENT",
      syscall: `spawn ${command}`,
      stdout: "",
      stderr: "",
      signal: null,
      killed: false,
    });
  }
  const launch = hostToolchain.command(command, args, options);
  const subprocess = execa(launch.command, launch.args, {
    cwd: options.cwd,
    env: launch.env,
    extendEnv: false,
    encoding: "buffer",
    stripFinalNewline: false,
    maxBuffer: options.maxBuffer,
    input: options.input ?? "",
    detached: supportsProcessGroups(),
    forceKillAfterDelay: 1_000,
    reject: false,
  });
  const stopProcess = createProcessStop(subprocess);
  let stopPromise: Promise<ProcessStopResult> | undefined;
  let canceled = false;
  let timedOut = false;
  function stop(): void {
    stopPromise ??= stopProcess({ gracePeriodMs: 1_000 });
    void stopPromise.catch(() => undefined);
  }
  const onAbort = (): void => {
    canceled = true;
    stop();
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });
  const timer = options.timeout
    ? setTimeout(() => {
        timedOut = true;
        stop();
      }, options.timeout)
    : undefined;
  for (const stream of [subprocess.stdout, subprocess.stderr]) {
    stream?.once("close", () => {
      if (
        !stream.readableEnded &&
        (process.platform !== "win32" ||
          (subprocess.exitCode === null && subprocess.signalCode === null))
      ) {
        stop();
      }
    });
  }
  if (options.onStderr) {
    const decoder = new TextDecoder();
    const onStderr = options.onStderr;
    subprocess.stderr?.on("data", (chunk: Buffer) => {
      const text = decoder.decode(chunk, { stream: true });
      if (text) onStderr(text);
    });
    subprocess.stderr?.on("end", () => {
      const text = decoder.decode();
      if (text) onStderr(text);
    });
  }
  const result = await subprocess.finally(() => {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  });
  await stopPromise;
  const output = {
    stdout: Buffer.from(result.stdout).toString("utf8"),
    stderr: Buffer.from(result.stderr).toString("utf8"),
  };
  if (!result.failed && !canceled && !timedOut) return output;
  hostToolchain.invalidateFailure(result.code ?? result.exitCode);
  const stopped = canceled || result.isMaxBuffer || timedOut;
  const syscall =
    result.cause instanceof Error &&
    "syscall" in result.cause &&
    typeof result.cause.syscall === "string"
      ? result.cause.syscall
      : undefined;
  const overflowStream = result.shortMessage?.startsWith(
    "Command's stderr was larger than ",
  )
    ? "stderr"
    : "stdout";
  const message = canceled
    ? "The operation was aborted"
    : result.isMaxBuffer
      ? `${overflowStream} maxBuffer length exceeded`
      : timedOut
        ? `Command timed out after ${options.timeout}ms`
        : result.originalMessage || `Command failed: ${command}`;
  throw Object.assign(
    new Error(message, {
      cause: canceled ? options.signal?.reason : result.cause,
    }),
    {
      name: canceled ? "AbortError" : "Error",
      code: canceled
        ? "ABORT_ERR"
        : result.isMaxBuffer
          ? "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
          : (result.code ?? result.exitCode ?? null),
      signal: stopped ? "SIGTERM" : (result.signal ?? null),
      killed: stopped || result.isTerminated,
      ...(syscall === undefined ? {} : { syscall }),
      ...output,
    },
  );
}
