import { execa } from "execa";

interface ExecPortableFileOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  maxBuffer: number;
  timeout?: number;
  signal?: AbortSignal;
  input?: string;
  onStderr?: (chunk: string) => void;
}

export async function execPortableFile(
  command: string,
  args: string[],
  options: ExecPortableFileOptions,
): Promise<{ stdout: string; stderr: string }> {
  if (options.signal?.aborted) throw options.signal.reason;
  const subprocess = execa(command, args, {
    cwd: options.cwd,
    env: options.env,
    extendEnv: false,
    encoding: "buffer",
    stripFinalNewline: false,
    maxBuffer: options.maxBuffer,
    timeout: options.timeout,
    cancelSignal: options.signal,
    input: options.input ?? "",
    killDescendants: true,
    forceKillAfterDelay: 1_000,
    reject: false,
  });
  for (const stream of [subprocess.stdout, subprocess.stderr]) {
    stream?.once("close", () => {
      const child = subprocess.nodeChildProcess;
      if (
        !stream.readableEnded &&
        (process.platform !== "win32" ||
          (child.exitCode === null && child.signalCode === null))
      ) {
        subprocess.kill();
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
  const result = await subprocess;
  const output = {
    stdout: Buffer.from(result.stdout).toString("utf8"),
    stderr: Buffer.from(result.stderr).toString("utf8"),
  };
  if (!result.failed) return output;
  const stopped = result.isCanceled || result.isMaxBuffer || result.timedOut;
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
  const message = result.isCanceled
    ? "The operation was aborted"
    : result.isMaxBuffer
      ? `${overflowStream} maxBuffer length exceeded`
      : result.timedOut
        ? `Command timed out after ${options.timeout}ms`
        : result.originalMessage || `Command failed: ${command}`;
  throw Object.assign(new Error(message, { cause: result.cause }), {
    name: result.isCanceled ? "AbortError" : "Error",
    code: result.isCanceled
      ? "ABORT_ERR"
      : result.isMaxBuffer
        ? "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
        : (result.code ?? result.exitCode ?? null),
    signal: stopped ? "SIGTERM" : (result.signal ?? null),
    killed: stopped || result.isTerminated,
    ...(syscall === undefined ? {} : { syscall }),
    ...output,
  });
}
