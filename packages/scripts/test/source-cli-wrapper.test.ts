import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

interface SourceCliResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
  stdout: string;
}

interface StatusWrapperPayload {
  childThreads: null;
  dataDir: null;
  pendingTodos: null;
  project: null;
  thread: null;
}

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "..", "..", "..");
const contextEnvKeys: string[] = [
  "BB_ENVIRONMENT_ID",
  "BB_PROJECT_ID",
  "BB_THREAD_ID",
  "BB_THREAD_STORAGE",
];
const spawnedChildren: ChildProcessWithoutNullStreams[] = [];

function buildCleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of contextEnvKeys) {
    delete env[key];
  }
  env.BB_SERVER_URL = "http://127.0.0.1:9";
  return env;
}

function runSourceBb(args: string[]): Promise<SourceCliResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("pnpm", ["--silent", "bb", ...args], {
      cwd: repoRoot,
      env: buildCleanEnv(),
    });
    spawnedChildren.push(child);

    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdoutChunks.push(chunk);
    });
    child.stderr.on("data", (chunk: string) => {
      stderrChunks.push(chunk);
    });
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => {
      resolvePromise({
        code,
        signal,
        stderr: stderrChunks.join(""),
        stdout: stdoutChunks.join(""),
      });
    });
  });
}

afterEach(() => {
  for (const child of spawnedChildren.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  }
});

describe("source CLI wrapper", () => {
  it("keeps --json stdout parseable when the prepare build writes progress", async () => {
    const result = await runSourceBb(["status", "--json"]);

    if (result.code !== 0 || result.signal !== null) {
      throw new Error(
        [
          `Expected source CLI wrapper to exit 0, got code=${result.code} signal=${result.signal}.`,
          "stdout:",
          result.stdout,
          "stderr:",
          result.stderr,
        ].join("\n"),
      );
    }
    expect(result.stdout).not.toContain("Packages in scope");
    expect(result.stdout.trimStart().startsWith("{")).toBe(true);

    const payload: StatusWrapperPayload = JSON.parse(result.stdout);
    expect(payload).toEqual({
      childThreads: null,
      dataDir: null,
      pendingTodos: null,
      project: null,
      thread: null,
    });
  }, 30_000);
});
