import { spawn } from "node:child_process";

interface CloseDeadline {
  cancel(): void;
}

interface SuperviseOptions {
  scheduleCloseDeadline?: (
    callback: () => void,
    timeoutMs: number,
  ) => CloseDeadline;
}

export const PROCESS_REAP_CONFIRMATION_TIMEOUT_MS = 5_000;

export class ProcessReapingUnconfirmedError extends Error {
  constructor(timeoutMs: number) {
    super(
      `Browser process shutdown exceeded ${String(timeoutMs)} ms; child reaping was not confirmed`,
    );
    this.name = "ProcessReapingUnconfirmedError";
  }
}

function scheduleCloseDeadline(
  callback: () => void,
  timeoutMs: number,
): CloseDeadline {
  const timer = setTimeout(callback, timeoutMs);
  timer.unref();
  return { cancel: () => clearTimeout(timer) };
}

const supervisor = `
const { spawn } = require('node:child_process');
const child = spawn(process.argv[1], process.argv.slice(2), { detached: true, stdio: 'ignore', env: process.env });
let stopping = false;
let childClosed = false;
function kill(signal) { if (child.pid) { try { process.kill(-child.pid, signal); } catch {} } }
function finish(code) {
  if (childClosed) process.exit(code);
  child.once('close', () => process.exit(code));
}
function stop() {
  if (stopping) return;
  stopping = true;
  kill('SIGTERM');
  setTimeout(() => { kill('SIGKILL'); finish(0); }, 1500);
}
child.on('error', () => process.exit(1));
child.on('close', () => { childClosed = true; if (!stopping) { kill('SIGKILL'); process.exit(1); } });
process.stdin.resume();
process.stdin.on('end', stop);
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
`;

export function supervise(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  options: SuperviseOptions = {},
) {
  const child = spawn(process.execPath, ["-e", supervisor, command, ...args], {
    env,
    stdio: ["pipe", "ignore", "ignore"],
  });
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
  let closing: Promise<void> | null = null;
  const close = (): Promise<void> => {
    if (closing !== null) return closing;
    child.stdin.end();
    closing = new Promise<void>((resolve, reject) => {
      let settled = false;
      let cancelDeadline = (): void => {};
      completion.then(() => {
        if (settled) return;
        settled = true;
        cancelDeadline();
        resolve();
      });
      cancelDeadline = (options.scheduleCloseDeadline ?? scheduleCloseDeadline)(
        () => {
          if (settled) return;
          settled = true;
          child.stdin.destroy();
          child.unref();
          reject(
            new ProcessReapingUnconfirmedError(
              PROCESS_REAP_CONFIRMATION_TIMEOUT_MS,
            ),
          );
        },
        PROCESS_REAP_CONFIRMATION_TIMEOUT_MS,
      ).cancel;
    });
    return closing;
  };
  return {
    alive: () => !exited,
    close,
  };
}

export function execute(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let bytes = 0;
    let failure: Error | null = null;
    const abort = () => {
      failure = new Error("Browser work cancelled or timed out");
      child.kill("SIGKILL");
    };
    signal.addEventListener("abort", abort, { once: true });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 512_000) {
        failure = new Error("DevBrowser output exceeded 512 KB");
        child.kill("SIGKILL");
      } else stdout += chunk;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 512_000) {
        failure = new Error("DevBrowser output exceeded 512 KB");
        child.kill("SIGKILL");
      }
    });
    child.once("error", (error) => {
      signal.removeEventListener("abort", abort);
      reject(error);
    });
    child.once("close", () => {
      signal.removeEventListener("abort", abort);
      if (failure) reject(failure);
      else resolve(stdout);
    });
    if (signal.aborted) abort();
  });
}
