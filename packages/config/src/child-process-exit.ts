import type { ChildProcess } from "node:child_process";

export interface ChildProcessExitResult {
  code: number | null;
  signal: NodeJS.Signals | null;
}

interface WaitForProcessExitWithTimeoutArgs {
  childProcess: ChildProcess;
  timeoutMs: number;
}

type WaitForProcessExitWithTimeoutResult = "exited" | "timed-out";
type ResolveWaitForProcessExitWithTimeout = (
  result: WaitForProcessExitWithTimeoutResult,
) => void;

export function hasProcessExited(childProcess: ChildProcess): boolean {
  return childProcess.exitCode !== null || childProcess.signalCode !== null;
}

export function waitForProcessExit(
  childProcess: ChildProcess,
): Promise<ChildProcessExitResult> {
  if (hasProcessExited(childProcess)) {
    return Promise.resolve({
      code: childProcess.exitCode,
      signal: childProcess.signalCode,
    });
  }

  return new Promise<ChildProcessExitResult>(
    (resolvePromise, rejectPromise) => {
      const exitHandler = (
        code: number | null,
        signal: NodeJS.Signals | null,
      ): void => {
        childProcess.off("error", errorHandler);
        resolvePromise({ code, signal });
      };
      const errorHandler = (error: Error): void => {
        childProcess.off("exit", exitHandler);
        rejectPromise(error);
      };
      childProcess.once("error", errorHandler);
      childProcess.once("exit", exitHandler);
    },
  );
}

export function waitForProcessExitWithTimeout(
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
