import type {
  MachineExecutor,
  MachineExecutorRequest,
} from "@get-bb/plugin-sdk";
import { posixCommand } from "./posix-quote.js";
import type { SshTarget } from "./target.js";

export interface SshChildProcess {
  stdin: {
    write(chunk: string): boolean;
    end(): void;
  };
  stdout: {
    on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
  };
  stderr: {
    on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
  };
  on(event: "error", listener: (error: Error) => void): unknown;
  on(
    event: "close",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): unknown;
  kill(signal?: NodeJS.Signals): boolean;
}

export type SshSpawner = (
  command: string,
  args: readonly string[],
) => SshChildProcess;

export function buildSshArgs(
  target: SshTarget,
  command: readonly string[],
): string[] {
  const args = [
    "-o",
    "BatchMode=yes",
    "-o",
    `StrictHostKeyChecking=${target.knownHosts}`,
    "-o",
    `ConnectTimeout=${String(target.connectTimeoutSeconds)}`,
  ];
  if (target.identityFile !== null) {
    args.push("-o", "IdentitiesOnly=yes", "-i", target.identityFile);
  }
  if (target.port !== undefined) {
    args.push("-p", String(target.port));
  }
  args.push(target.destination, "--", posixCommand(command));
  return args;
}

export function createSshExecutor(
  target: SshTarget,
  spawn: SshSpawner,
): MachineExecutor {
  return {
    exec(request) {
      return execSsh(target, spawn, request);
    },
  };
}

export function execSsh(
  target: SshTarget,
  spawn: SshSpawner,
  request: MachineExecutorRequest,
): Promise<{ exitCode: number }> {
  request.signal.throwIfAborted();
  const child = spawn(target.sshPath, buildSshArgs(target, request.command));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error: Error | null, exitCode: number): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request.signal.removeEventListener("abort", onAbort);
      if (error !== null) {
        child.kill("SIGKILL");
        reject(error);
        return;
      }
      resolve({ exitCode });
    };
    const onAbort = (): void => {
      const reason = request.signal.reason;
      finish(
        reason instanceof Error ? reason : new Error("SSH command aborted"),
        1,
      );
    };
    const timer = setTimeout(() => {
      finish(
        new Error(`SSH command timed out after ${request.timeoutMs} ms`),
        1,
      );
    }, request.timeoutMs);
    request.signal.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk) => {
      request.onOutput(String(chunk));
    });
    child.stderr.on("data", (chunk) => {
      request.onOutput(String(chunk));
    });
    child.on("error", (error) => {
      finish(error, 1);
    });
    child.on("close", (code) => {
      finish(null, code ?? 1);
    });
    if (request.stdin.length > 0) {
      child.stdin.write(request.stdin);
    }
    child.stdin.end();
  });
}
