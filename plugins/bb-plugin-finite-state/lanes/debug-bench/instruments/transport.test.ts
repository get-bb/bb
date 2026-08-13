import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runInstrumentProcess } from "./transport.js";

const directories: string[] = [];
const childPids = new Set<number>();

function directory(): string {
  const value = mkdtempSync(join(tmpdir(), "fs127-transport-"));
  directories.push(value);
  return value;
}

function killChild(pid: number): void {
  try { process.kill(pid, "SIGKILL"); } catch { /* Already exited. */ }
  childPids.delete(pid);
}

async function readPid(path: string): Promise<number> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (existsSync(path)) {
      const pid = Number(readFileSync(path, "utf8"));
      if (Number.isInteger(pid) && pid > 0) {
        childPids.add(pid);
        return pid;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Child PID was not written to ${path}.`);
}

async function expectProcessGone(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { process.kill(pid, 0); } catch {
      childPids.delete(pid);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Process ${pid} survived process-group termination.`);
}

afterEach(() => {
  for (const pid of childPids) killChild(pid);
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true });
});

describe("instrument subprocess supervision", () => {
  it("collects bounded stdout and stderr from a normal exit", async () => {
    await expect(runInstrumentProcess({
      command: process.execPath,
      args: ["-e", "process.stdout.write('result'); process.stderr.write('detail')"],
      timeoutMs: 1_000,
      maxOutputBytes: 1_024,
    }, new AbortController().signal)).resolves.toEqual({
      code: 0,
      stdout: "result",
      stderr: "detail",
    });
  });

  it("reports spawn failure without waiting for close", async () => {
    await expect(runInstrumentProcess({
      command: join(directory(), "missing-command"),
      args: [],
      timeoutMs: 1_000,
      maxOutputBytes: 1_024,
    }, new AbortController().signal)).rejects.toMatchObject({ code: "PROCESS_START_FAILED" });
  });

  it("settles at the deadline when an escaped grandchild inherits stdio", async () => {
    const pidPath = join(directory(), "escaped.pid");
    const script = `
      const { spawn } = require("node:child_process");
      const { writeFileSync } = require("node:fs");
      const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
        detached: true,
        stdio: ["ignore", process.stdout, process.stderr],
      });
      writeFileSync(process.argv[1], String(grandchild.pid));
      grandchild.unref();
      setInterval(() => {}, 1000);
    `;
    const started = Date.now();
    const run = runInstrumentProcess({
      command: process.execPath,
      args: ["-e", script, pidPath],
      timeoutMs: 250,
      maxOutputBytes: 1_024,
    }, new AbortController().signal);
    const pid = await readPid(pidPath);
    await expect(run).rejects.toMatchObject({ code: "PROCESS_TIMEOUT" });
    expect(Date.now() - started).toBeLessThan(2_000);
    killChild(pid);
  });

  it.skipIf(process.platform === "win32")("kills descendants in the supervised process group", async () => {
    const pidPath = join(directory(), "group.pid");
    const script = `
      const { spawn } = require("node:child_process");
      const { writeFileSync } = require("node:fs");
      const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
        stdio: "ignore",
      });
      writeFileSync(process.argv[1], String(grandchild.pid));
      setInterval(() => {}, 1000);
    `;
    const run = runInstrumentProcess({
      command: process.execPath,
      args: ["-e", script, pidPath],
      timeoutMs: 250,
      maxOutputBytes: 1_024,
    }, new AbortController().signal);
    const pid = await readPid(pidPath);
    await expect(run).rejects.toMatchObject({ code: "PROCESS_TIMEOUT" });
    await expectProcessGone(pid);
  });

  it("settles promptly when the direct child exits but an escaped grandchild holds its pipes", async () => {
    const pidPath = join(directory(), "exited-parent.pid");
    const script = `
      const { spawn } = require("node:child_process");
      const { writeFileSync } = require("node:fs");
      const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
        detached: true,
        stdio: ["ignore", process.stdout, process.stderr],
      });
      writeFileSync(process.argv[1], String(grandchild.pid));
      grandchild.unref();
    `;
    const started = Date.now();
    const result = await runInstrumentProcess({
      command: process.execPath,
      args: ["-e", script, pidPath],
      timeoutMs: 1_000,
      maxOutputBytes: 1_024,
    }, new AbortController().signal);
    const pid = await readPid(pidPath);
    expect(result.code).toBe(0);
    expect(Date.now() - started).toBeLessThan(2_000);
    killChild(pid);
  });

  it("aborts and enforces the combined stdout/stderr cap", async () => {
    const abort = new AbortController();
    const run = runInstrumentProcess({
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      timeoutMs: 5_000,
      maxOutputBytes: 1_024,
    }, abort.signal);
    abort.abort("test cancellation");
    await expect(run).rejects.toMatchObject({ code: "PROCESS_ABORTED" });

    await expect(runInstrumentProcess({
      command: process.execPath,
      args: ["-e", "process.stdout.write('x'.repeat(100000))"],
      timeoutMs: 2_000,
      maxOutputBytes: 1_024,
    }, new AbortController().signal)).rejects.toMatchObject({ code: "PROCESS_OUTPUT_LIMIT" });
  });
});
