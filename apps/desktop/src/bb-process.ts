import { spawn, type ChildProcess } from "node:child_process";

export interface RuntimeLogBuffer {
  append(chunk: Buffer | string): void;
  text(): string;
}

export interface CreateRuntimeLogBufferArgs {
  maxLines: number;
}

export interface StartBbAppProcessArgs {
  bridgePath: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  logLineLimit: number;
}

export interface BbAppProcess {
  childProcess: ChildProcess;
  exit: Promise<BbAppProcessExit>;
  logs: RuntimeLogBuffer;
  pid: number;
  stop(args: StopBbAppProcessArgs): Promise<void>;
}

export interface BbAppProcessExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface StopBbAppProcessArgs {
  killSignal: NodeJS.Signals;
  killTimeoutMs: number;
  signal: NodeJS.Signals;
  timeoutMs: number;
}

export interface CreateElectronNodeEnvArgs {
  env: NodeJS.ProcessEnv;
}

interface WaitForProcessExitWithTimeoutArgs {
  childProcess: ChildProcess;
  timeoutMs: number;
}

type WaitForProcessExitWithTimeoutResult = "exited" | "timed-out";
type ResolveWaitForProcessExitWithTimeout = (
  result: WaitForProcessExitWithTimeoutResult,
) => void;

export function createRuntimeLogBuffer(
  args: CreateRuntimeLogBufferArgs,
): RuntimeLogBuffer {
  const lines: string[] = [];

  return {
    append(chunk) {
      const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
      for (const line of text.split(/\r?\n/u)) {
        if (line.length === 0) {
          continue;
        }
        lines.push(line);
      }
      while (lines.length > args.maxLines) {
        lines.shift();
      }
    },
    text() {
      return lines.join("\n");
    },
  };
}

export function createElectronNodeEnv(
  args: CreateElectronNodeEnvArgs,
): NodeJS.ProcessEnv {
  return {
    ...args.env,
    ELECTRON_RUN_AS_NODE: "1",
  };
}

function hasProcessExited(childProcess: ChildProcess): boolean {
  return childProcess.exitCode !== null || childProcess.signalCode !== null;
}

function waitForProcessExit(
  childProcess: ChildProcess,
): Promise<BbAppProcessExit> {
  if (hasProcessExited(childProcess)) {
    return Promise.resolve({
      code: childProcess.exitCode,
      signal: childProcess.signalCode,
    });
  }

  return new Promise<BbAppProcessExit>((resolvePromise) => {
    childProcess.once("exit", (code, signal) => {
      resolvePromise({ code, signal });
    });
  });
}

function waitForProcessExitWithTimeout(
  args: WaitForProcessExitWithTimeoutArgs,
): Promise<WaitForProcessExitWithTimeoutResult> {
  if (hasProcessExited(args.childProcess)) {
    return Promise.resolve("exited");
  }

  return new Promise<WaitForProcessExitWithTimeoutResult>((resolvePromise) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout>;
    const finish: ResolveWaitForProcessExitWithTimeout = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      args.childProcess.off("exit", exitHandler);
      resolvePromise(result);
    };
    const exitHandler = (): void => {
      finish("exited");
    };
    timeout = setTimeout(() => {
      finish("timed-out");
    }, args.timeoutMs);
    timeout.unref();

    args.childProcess.once("exit", exitHandler);
    if (hasProcessExited(args.childProcess)) {
      finish("exited");
    }
  });
}

export function startBbAppProcess(args: StartBbAppProcessArgs): BbAppProcess {
  const logs = createRuntimeLogBuffer({ maxLines: args.logLineLimit });
  const childProcess = spawn(process.execPath, [args.bridgePath], {
    cwd: args.cwd,
    env: createElectronNodeEnv({ env: args.env }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const pid = childProcess.pid;
  if (pid === undefined) {
    throw new Error("bb-app child process did not expose a PID");
  }

  if (childProcess.stdout !== null) {
    childProcess.stdout.on("data", (chunk: Buffer) => {
      logs.append(chunk);
    });
  }

  if (childProcess.stderr !== null) {
    childProcess.stderr.on("data", (chunk: Buffer) => {
      logs.append(chunk);
    });
  }

  const exit = waitForProcessExit(childProcess);

  return {
    childProcess,
    exit,
    logs,
    pid,
    async stop(stopArgs) {
      if (hasProcessExited(childProcess)) {
        return;
      }
      childProcess.kill(stopArgs.signal);
      const gracefulResult = await waitForProcessExitWithTimeout({
        childProcess,
        timeoutMs: stopArgs.timeoutMs,
      });
      if (gracefulResult === "exited") {
        return;
      }

      if (!hasProcessExited(childProcess)) {
        childProcess.kill(stopArgs.killSignal);
      }
      await waitForProcessExitWithTimeout({
        childProcess,
        timeoutMs: stopArgs.killTimeoutMs,
      });
    },
  };
}
