import { mkdtemp, open, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  experimental_hostToolchain as hostToolchain,
  experimental_spawnHostProcess as spawn,
} from "@get-bb/plugin-sdk/process";

const supervisor = `
const { spawn } = require('node:child_process');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(process.argv[1], process.argv.slice(2), { detached: true, stdio: 'ignore', env });
let stopping = false;
function kill(signal) { if (child.pid) { try { process.kill(-child.pid, signal); } catch {} } }
function stop() {
  if (stopping) return;
  stopping = true;
  kill('SIGTERM');
  setTimeout(() => {
    kill('SIGKILL');
    if (child.exitCode !== null || child.signalCode !== null) process.exit(0);
    else child.once('exit', () => process.exit(0));
  }, 1500);
}
child.on('error', () => process.exit(1));
child.on('exit', () => { if (!stopping) { kill('SIGKILL'); process.exit(1); } });
process.stdin.resume();
process.stdin.on('end', stop);
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
`;

export function supervise(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
) {
  const launch = hostToolchain.command(command, args, { env });
  const child = spawn(
    process.execPath,
    ["-e", supervisor, launch.command, ...launch.args],
    {
      env: process.versions.electron
        ? { ...launch.env, ELECTRON_RUN_AS_NODE: "1" }
        : launch.env,
      stdio: ["pipe", "ignore", "ignore"],
    },
  );
  child.stdin.on("error", () => {});
  let exited = false;
  const completion = new Promise<void>((resolve) => {
    child.once("exit", () => {
      exited = true;
      resolve();
    });
    child.once("error", () => {
      exited = true;
      resolve();
    });
  });
  return {
    alive: () => !exited,
    async close() {
      child.stdin.end();
      await completion;
    },
  };
}

const MAX_OUTPUT_BYTES = 512_000;

export async function execute(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted();
  const dir = await mkdtemp(join(tmpdir(), "bb-devbrowser-"));
  const path = join(dir, "stdout");
  const file = await open(path, "w", 0o600);
  let stdoutBytes = 0;
  let stderrBytes = 0;
  const sizeError = () =>
    stdoutBytes + stderrBytes > MAX_OUTPUT_BYTES
      ? new Error("DevBrowser output exceeded 512 KB")
      : null;
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, {
        env,
        stdio: ["ignore", file.fd, "pipe"],
      });
      let failure: Error | null = null;
      const fail = (error: Error) => {
        failure ??= error;
        child.kill("SIGKILL");
      };
      const checkSize = () => {
        const error = sizeError();
        if (error) fail(error);
      };
      const abort = () =>
        fail(new Error("Browser work cancelled or timed out"));
      const watch = setInterval(() => {
        file.stat().then(({ size }) => {
          stdoutBytes = size;
          checkSize();
        }, fail);
      }, 100);
      const settle = () => {
        clearInterval(watch);
        signal.removeEventListener("abort", abort);
      };
      signal.addEventListener("abort", abort, { once: true });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderrBytes += chunk.length;
        checkSize();
      });
      child.once("error", (error) => {
        settle();
        reject(error);
      });
      child.once("close", () => {
        settle();
        if (failure) reject(failure);
        else resolve();
      });
      if (signal.aborted) abort();
    });
    stdoutBytes = (await file.stat()).size;
    const error = sizeError();
    if (error) throw error;
    return await readFile(path, "utf8");
  } finally {
    await file.close();
    await rm(dir, { recursive: true, force: true });
  }
}
