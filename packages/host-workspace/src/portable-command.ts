import { spawnPortableOutputProcess } from "@bb/process-utils";

export interface PortableCommandRequest {
  command: string;
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs?: number;
  maxBufferBytes: number;
  signal?: AbortSignal;
  encoding: "utf8" | "buffer";
}

export interface PortableCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface PortableCommandBufferResult {
  stdout: Buffer;
  stderr: Buffer;
  exitCode: number;
}

export function runPortableCommand(
  request: PortableCommandRequest & { encoding: "utf8" },
): Promise<PortableCommandResult>;
export function runPortableCommand(
  request: PortableCommandRequest & { encoding: "buffer" },
): Promise<PortableCommandBufferResult>;
export function runPortableCommand(
  request: PortableCommandRequest,
): Promise<PortableCommandResult | PortableCommandBufferResult> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const child = spawnPortableOutputProcess({
      command: request.command,
      args: [...request.args],
      cwd: request.cwd,
      env: request.env,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutOverflow = false;
    let stderrOverflow = false;
    let timedOut = false;
    let spawnError: Error | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const describeCommand = (): string =>
      `${request.command} ${request.args.join(" ")}`;

    const collectStdout = (): Buffer => Buffer.concat(stdoutChunks);
    const collectStderr = (): Buffer => Buffer.concat(stderrChunks);
    const finishStdout = (): string | Buffer =>
      request.encoding === "buffer"
        ? collectStdout()
        : collectStdout().toString("utf8");
    const finishStderr = (): string | Buffer =>
      request.encoding === "buffer"
        ? collectStderr()
        : collectStderr().toString("utf8");

    const fail = (
      message: string,
      fields: {
        code: string | number | null;
        killed: boolean;
        signal: NodeJS.Signals | null;
      },
    ): Error =>
      Object.assign(new Error(message), {
        code: fields.code,
        killed: fields.killed,
        signal: fields.signal,
        stdout: finishStdout(),
        stderr: finishStderr(),
      });

    const killChild = (): void => {
      try {
        child.kill();
      } catch {}
    };

    const cleanup = (): void => {
      if (timeout !== undefined) {
        clearTimeout(timeout);
        timeout = undefined;
      }
      request.signal?.removeEventListener("abort", onAbort);
    };

    const settleResolve = (
      value: PortableCommandResult | PortableCommandBufferResult,
    ): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const settleReject = (error: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const onAbort = (): void => {
      killChild();
      const abortError = new Error(
        `The operation was aborted: ${describeCommand()}`,
      );
      abortError.name = "AbortError";
      Object.assign(abortError, { code: "ABORT_ERR" });
      settleReject(abortError);
    };

    request.signal?.addEventListener("abort", onAbort, { once: true });
    if (request.signal?.aborted) {
      onAbort();
      return;
    }
    if (request.timeoutMs !== undefined) {
      timeout = setTimeout(() => {
        timedOut = true;
        killChild();
      }, request.timeoutMs);
      timeout.unref?.();
    }

    child.stdout.on("data", (chunk: Buffer) => {
      if (settled || timedOut || stdoutOverflow || stderrOverflow) return;
      const remaining = request.maxBufferBytes - stdoutBytes;
      if (chunk.length > remaining) {
        if (remaining > 0) {
          stdoutChunks.push(Buffer.from(chunk.subarray(0, remaining)));
          stdoutBytes += remaining;
        }
        stdoutOverflow = true;
        killChild();
        return;
      }
      stdoutBytes += chunk.length;
      stdoutChunks.push(Buffer.from(chunk));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (settled || timedOut || stdoutOverflow || stderrOverflow) return;
      const remaining = request.maxBufferBytes - stderrBytes;
      if (chunk.length > remaining) {
        if (remaining > 0) {
          stderrChunks.push(Buffer.from(chunk.subarray(0, remaining)));
          stderrBytes += remaining;
        }
        stderrOverflow = true;
        killChild();
        return;
      }
      stderrBytes += chunk.length;
      stderrChunks.push(Buffer.from(chunk));
    });
    child.once("error", (error) => {
      spawnError = error;
    });
    child.once("close", (code) => {
      if (settled) return;
      if (request.signal?.aborted) {
        onAbort();
        return;
      }
      if (timedOut) {
        settleReject(
          fail(`Command timed out: ${describeCommand()}`, {
            code: null,
            killed: true,
            signal: "SIGTERM",
          }),
        );
        return;
      }
      if (stdoutOverflow || stderrOverflow) {
        const stream = stdoutOverflow ? "stdout" : "stderr";
        settleReject(
          fail(`${stream} maxBuffer length exceeded`, {
            code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
            killed: false,
            signal: null,
          }),
        );
        return;
      }
      if (spawnError !== undefined) {
        if (!("stdout" in spawnError)) {
          Object.assign(spawnError, { stdout: finishStdout() });
        }
        if (!("stderr" in spawnError)) {
          Object.assign(spawnError, { stderr: finishStderr() });
        }
        settleReject(spawnError);
        return;
      }
      const exitCode = code ?? 1;
      if (exitCode !== 0) {
        const stderrText = collectStderr().toString("utf8").trim();
        const detail = stderrText ? `: ${stderrText}` : "";
        settleReject(
          fail(`Command failed: ${describeCommand()}${detail}`, {
            code: exitCode,
            killed: false,
            signal: null,
          }),
        );
        return;
      }
      settleResolve({
        stdout: finishStdout(),
        stderr: finishStderr(),
        exitCode: 0,
      } as PortableCommandResult | PortableCommandBufferResult);
    });
  });
}
