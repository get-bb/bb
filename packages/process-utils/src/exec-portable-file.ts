import { execFile, type ExecFileException } from "node:child_process";
import path from "node:path";
import crossSpawn from "cross-spawn";

interface ExecPortableFileOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  maxBuffer: number;
  timeout?: number;
  signal?: AbortSignal;
  input?: string;
  onStderr?: (chunk: string) => void;
}

export function execPortableFile(
  command: string,
  args: string[],
  options: ExecPortableFileOptions,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(options.signal.reason);
      return;
    }
    const child = crossSpawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: "pipe",
    });
    const {
      stdin: childInput,
      stdout: childOutput,
      stderr: childError,
    } = child;
    if (!childInput || !childOutput || !childError) {
      child.kill();
      throw new Error("Portable command did not attach piped stdio");
    }
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let failure: ExecFileException | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let stopping: Promise<void> | undefined;
    const stop = (error: ExecFileException) => {
      if (failure) return;
      failure = error;
      if (process.platform === "win32" && child.pid !== undefined) {
        stopping = new Promise<void>((resolveStop) => {
          execFile(
            path.join(
              process.env.SystemRoot ?? "C:\\Windows",
              "System32",
              "taskkill.exe",
            ),
            ["/pid", String(child.pid), "/T", "/F"],
            { windowsHide: true, timeout: 5_000 },
            () => {
              child.kill();
              resolveStop();
            },
          );
        });
      } else {
        child.kill();
      }
      childInput.destroy();
      childOutput.destroy();
      childError.destroy();
    };
    const abort = () => {
      stop(
        Object.assign(
          new Error("The operation was aborted", {
            cause: options.signal?.reason,
          }),
          { name: "AbortError", code: "ABORT_ERR" },
        ),
      );
    };
    child.once("error", (error) => {
      failure ??= error;
    });
    childInput.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code !== "EPIPE") stop(error);
    });
    const collect = (stream: "stdout" | "stderr", chunk: Buffer) => {
      const length = stream === "stdout" ? stdoutBytes : stderrBytes;
      const chunks = stream === "stdout" ? stdout : stderr;
      chunks.push(chunk.subarray(0, Math.max(0, options.maxBuffer - length)));
      if (stream === "stdout") stdoutBytes += chunk.length;
      else stderrBytes += chunk.length;
      if (length + chunk.length > options.maxBuffer) {
        stop(
          Object.assign(new RangeError(`${stream} maxBuffer length exceeded`), {
            code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
          }),
        );
      }
    };
    childOutput.on("data", (chunk: Buffer) => collect("stdout", chunk));
    childError.on("data", (chunk: Buffer) => collect("stderr", chunk));
    if (options.onStderr) {
      const decoder = new TextDecoder();
      const onStderr = options.onStderr;
      childError.on("data", (chunk: Buffer) => {
        const text = decoder.decode(chunk, { stream: true });
        if (text) onStderr(text);
      });
      childError.on("end", () => {
        const text = decoder.decode();
        if (text) onStderr(text);
      });
    }
    child.once("close", async (code, signal) => {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
      await stopping;
      const output = {
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      };
      if (failure || code !== 0) {
        reject(
          Object.assign(failure ?? new Error(`Command failed: ${command}`), {
            code: failure?.code ?? code,
            signal: stopping ? "SIGTERM" : signal,
            killed: stopping !== undefined || child.killed,
            ...output,
          }),
        );
      } else {
        resolve(output);
      }
    });
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    if (options.timeout !== undefined && options.timeout > 0) {
      timeout = setTimeout(() => {
        stop(new Error(`Command timed out after ${options.timeout}ms`));
      }, options.timeout);
    }
    childInput.end(options.input);
  });
}
