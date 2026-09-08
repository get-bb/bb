import { spawn } from "node:child_process";
import { sshDestinationSchema } from "./configuration.js";

const MAX_OUTPUT_BYTES = 1024 * 1024;

export interface SshExecRequest {
  command: string[];
  timeoutMs: number;
  signal: AbortSignal;
  stdin?: string;
}

export interface SshExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface SshRunner {
  available(): Promise<boolean>;
  exec(target: string, request: SshExecRequest): Promise<SshExecResult>;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function createSshRunner(executable = "ssh"): SshRunner {
  return {
    available() {
      return new Promise((resolve) => {
        const child = spawn(executable, ["-V"], {
          stdio: "ignore",
          timeout: 5_000,
        });
        child.once("error", () => resolve(false));
        child.once("close", (code) => resolve(code === 0));
      });
    },
    async exec(destination, request) {
      const target = sshDestinationSchema.parse(destination);
      request.signal.throwIfAborted();
      if (
        request.command.length === 0 ||
        request.command[0].length === 0 ||
        request.command.some((argument) => argument.includes("\0"))
      ) {
        throw new Error("SSH command must contain a program and no NUL bytes.");
      }
      if (!Number.isSafeInteger(request.timeoutMs) || request.timeoutMs <= 0) {
        throw new Error(
          "SSH timeout must be a positive integer in milliseconds.",
        );
      }
      return new Promise((resolve, reject) => {
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        let outputBytes = 0;
        let failure: Error | null = null;
        const child = spawn(
          executable,
          [
            "-T",
            "-o",
            "BatchMode=yes",
            "-o",
            "StrictHostKeyChecking=yes",
            "-o",
            "ClearAllForwardings=yes",
            "-o",
            "ControlMaster=no",
            "-o",
            "ControlPath=none",
            "--",
            target,
            request.command.map(shellQuote).join(" "),
          ],
          { stdio: ["pipe", "pipe", "pipe"] },
        );
        function stop(error: Error) {
          failure ??= error;
          child.kill("SIGKILL");
        }
        const abort = () => stop(new Error("SSH operation cancelled"));
        request.signal.addEventListener("abort", abort, { once: true });
        if (request.signal.aborted) abort();
        const timeout = setTimeout(
          () =>
            stop(
              new Error(`SSH command timed out after ${request.timeoutMs}ms.`),
            ),
          request.timeoutMs,
        );
        function collect(chunks: Buffer[], chunk: Buffer) {
          outputBytes += chunk.length;
          if (outputBytes > MAX_OUTPUT_BYTES) {
            stop(new Error("SSH command output exceeded 1 MiB."));
          } else {
            chunks.push(chunk);
          }
        }
        child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
        child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
        child.once("error", (error) => {
          failure ??= error;
        });
        child.once("close", (code) => {
          clearTimeout(timeout);
          request.signal.removeEventListener("abort", abort);
          if (failure !== null) reject(failure);
          else
            resolve({
              exitCode: code ?? 1,
              stdout: Buffer.concat(stdout).toString("utf8"),
              stderr: Buffer.concat(stderr).toString("utf8"),
            });
        });
        child.stdin.on("error", (error: NodeJS.ErrnoException) => {
          if (error.code !== "EPIPE") stop(error);
        });
        child.stdin.end(request.stdin);
      });
    },
  };
}

export const openSshRunner = createSshRunner();
