import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CliUnavailableError,
  cliEnvironment,
  createCliRunner,
  resolveCliLaunch,
} from "./cli-runner.js";

const posix = process.platform !== "win32";

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe.runIf(posix)("createCliRunner", () => {
  let directory: string;
  let binary: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "bb-mcp-cli-"));
    binary = join(directory, "bb");
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function script(body: string): Promise<void> {
    await writeFile(binary, `#!/bin/sh\n${body}\n`);
    await chmod(binary, 0o755);
  }

  function runner(maxConcurrent?: number) {
    return createCliRunner({
      env: {
        PATH: process.env.PATH,
        BB_THREAD_ID: "thr_parent",
        BB_SERVER_HEADERS: '{"x":"y"}',
      },
      serverUrl: () => "http://127.0.0.1:1",
      resolveBinary: async () => binary,
      ...(maxConcurrent === undefined ? {} : { maxConcurrent }),
    });
  }

  const options = (over: { stdin?: string; timeoutMs?: number } = {}) => ({
    stdin: over.stdin ?? null,
    timeoutMs: over.timeoutMs ?? 10_000,
    signal: new AbortController().signal,
  });

  it("passes arguments verbatim, the server URL, and stdin, and strips thread context", async () => {
    await script(
      `printf '%s|' "$@"; printf '\\n%s|%s|%s\\n' "$BB_SERVER_URL" "\${BB_THREAD_ID:-unset}" "\${BB_SERVER_HEADERS:-unset}"; cat; exit 3`,
    );
    const result = await runner()(
      ["thread", "tell", "a b", "$(touch x); `id`", "--flag=;rm"],
      options({ stdin: "from stdin" }),
    );
    expect(result.exitCode).toBe(3);
    expect(result.stdout).toBe(
      "thread|tell|a b|$(touch x); `id`|--flag=;rm|\nhttp://127.0.0.1:1|unset|unset\nfrom stdin",
    );
    expect(result).toMatchObject({ timedOut: false, truncated: false });
  });

  it("kills a command that outlives its timeout, along with its children", async () => {
    const pidFile = join(directory, "child.pid");
    await script(`sleep 60 &\necho $! > ${pidFile}\nwait`);
    const startedAt = Date.now();
    const result = await runner()(["hang"], options({ timeoutMs: 300 }));
    expect(Date.now() - startedAt).toBeLessThan(5_000);
    expect(result.timedOut).toBe(true);
    const childPid = Number((await readFile(pidFile, "utf8")).trim());
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(alive(childPid)).toBe(false);
  });

  it("returns when the command exits even if a child keeps its output open", async () => {
    await script(`(sleep 30) &\necho done`);
    const startedAt = Date.now();
    const result = await runner()(["leaky"], options());
    expect(Date.now() - startedAt).toBeLessThan(5_000);
    expect(result).toMatchObject({ exitCode: 0, stdout: "done\n" });
  });

  it("stops a running command when the call is cancelled", async () => {
    await script(`sleep 60`);
    const controller = new AbortController();
    const startedAt = Date.now();
    const pending = runner()(["hang"], {
      stdin: null,
      timeoutMs: 30_000,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 200);
    const result = await pending;
    expect(Date.now() - startedAt).toBeLessThan(5_000);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).not.toBe(0);
  });

  it("caps captured output and says so", async () => {
    await script(`head -c 900000 /dev/zero | tr '\\0' 'x'`);
    const result = await runner()(["big"], options());
    expect(result.truncated).toBe(true);
    expect(result.stdout.length).toBe(512 * 1024);
  });

  it("runs at most the configured number of commands at once", async () => {
    const log = join(directory, "log");
    await script(`echo start >> ${log}\nsleep 0.3\necho end >> ${log}`);
    const run = runner(2);
    await Promise.all(Array.from({ length: 6 }, () => run(["x"], options())));
    let active = 0;
    let peak = 0;
    for (const line of (await readFile(log, "utf8")).trim().split("\n")) {
      active += line === "start" ? 1 : -1;
      peak = Math.max(peak, active);
    }
    expect(peak).toBe(2);
  });

  it("reports a missing CLI and looks again on the next call", async () => {
    let found: string | null = null;
    const run = createCliRunner({
      env: {},
      serverUrl: () => "http://127.0.0.1:1",
      resolveBinary: async () => found,
    });
    await expect(run(["status"], options())).rejects.toBeInstanceOf(
      CliUnavailableError,
    );
    await script(`echo ok`);
    found = binary;
    expect((await run(["status"], options())).stdout).toBe("ok\n");
  });
});

describe("resolveCliLaunch", () => {
  it("runs an extensionless CLI through Node on Windows", () => {
    expect(
      resolveCliLaunch("C:\\bb\\bundle\\bb", ["status"], "win32", "node.exe"),
    ).toEqual({ command: "node.exe", args: ["C:\\bb\\bundle\\bb", "status"] });
    expect(
      resolveCliLaunch("C:\\bb\\bb.exe", ["status"], "win32", "node.exe"),
    ).toEqual({ command: "C:\\bb\\bb.exe", args: ["status"] });
  });

  it("runs the CLI directly elsewhere", () => {
    expect(resolveCliLaunch("/opt/bb/bb", ["status"], "linux", "node")).toEqual(
      { command: "/opt/bb/bb", args: ["status"] },
    );
  });
});

describe("cliEnvironment", () => {
  it("points the CLI at this server and drops inherited thread context", () => {
    const env = cliEnvironment(
      {
        HOME: "/home/me",
        BB_SERVER_URL: "http://elsewhere",
        BB_PROJECT_ID: "prj",
        BB_ENVIRONMENT_ID: "env",
        BB_THREAD_STORAGE: "/tmp/x",
      },
      "http://127.0.0.1:9",
    );
    expect(env).toMatchObject({
      HOME: "/home/me",
      BB_SERVER_URL: "http://127.0.0.1:9",
      NO_COLOR: "1",
    });
    expect(env.BB_PROJECT_ID).toBeUndefined();
    expect(env.BB_ENVIRONMENT_ID).toBeUndefined();
    expect(env.BB_THREAD_STORAGE).toBeUndefined();
  });
});
