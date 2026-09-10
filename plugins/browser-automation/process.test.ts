import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  PROCESS_REAP_CONFIRMATION_TIMEOUT_MS,
  ProcessReapingUnconfirmedError,
  supervise,
} from "./process.js";

async function stopWorker(worker: ChildProcess): Promise<void> {
  if (worker.exitCode !== null || worker.signalCode !== null) return;
  const exited = once(worker, "exit");
  worker.kill("SIGKILL");
  await exited;
}

function killProcessGroup(pid: number): void {
  try {
    process.kill(-pid, "SIGKILL");
  } catch {}
  try {
    process.kill(pid, "SIGKILL");
  } catch {}
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("process ownership", () => {
  it("worker death closes the supervisor pipe and kills its child", async () => {
    const root = await mkdtemp(join(tmpdir(), "db-worker-death-"));
    const file = join(root, "pid");
    const childCode =
      'require("node:fs").writeFileSync(process.argv[1], String(process.pid)); process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);';
    const code = `import { supervise } from ${JSON.stringify(new URL("./process.ts", import.meta.url).href)}; supervise(process.execPath, ["-e", ${JSON.stringify(childCode)}, ${JSON.stringify(file)}], process.env); setInterval(() => {}, 1000);`;
    const worker = spawn(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", code],
      { stdio: "ignore" },
    );
    let pid = 0;
    try {
      await vi.waitFor(
        async () => {
          pid = Number(await readFile(file, "utf8"));
        },
        { timeout: 5000 },
      );
      await stopWorker(worker);
      await vi.waitFor(
        () => {
          expect(() => process.kill(pid, 0)).toThrow();
        },
        { timeout: 5000 },
      );
    } finally {
      await stopWorker(worker);
      if (pid > 0 && isProcessAlive(pid)) killProcessGroup(pid);
      await rm(root, { recursive: true, force: true });
    }
  }, 12_000);
  it("kills a TERM-resistant child group without touching another session", async () => {
    const root = await mkdtemp(join(tmpdir(), "db-supervisor-"));
    const code =
      'require("node:fs").writeFileSync(process.argv[1], String(process.pid)); process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);';
    const a = supervise(
      process.execPath,
      ["-e", code, join(root, "a")],
      process.env,
    );
    const b = supervise(
      process.execPath,
      ["-e", code, join(root, "b")],
      process.env,
    );
    try {
      let pidA = 0,
        pidB = 0;
      await vi.waitFor(
        async () => {
          pidA = Number(await readFile(join(root, "a"), "utf8"));
          pidB = Number(await readFile(join(root, "b"), "utf8"));
        },
        { timeout: 5000 },
      );
      await a.close();
      expect(() => process.kill(pidA, 0)).toThrow();
      expect(() => process.kill(pidB, 0)).not.toThrow();
      await b.close();
      expect(() => process.kill(pidB, 0)).toThrow();
    } finally {
      await Promise.all([a.close(), b.close()]);
      await rm(root, { recursive: true, force: true });
    }
  }, 10_000);
  it("bounds close while the supervisor independently finishes reaping", async () => {
    const root = await mkdtemp(join(tmpdir(), "db-close-deadline-"));
    const file = join(root, "pid");
    const code =
      'require("node:fs").writeFileSync(process.argv[1], `${String(process.pid)}:${String(process.ppid)}`); process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);';
    let expireDeadline = (): void => {
      throw new Error("Close deadline was not scheduled");
    };
    let deadlineScheduled = false;
    let deadlineMs = 0;
    const owned = supervise(process.execPath, ["-e", code, file], process.env, {
      scheduleCloseDeadline(callback, timeoutMs) {
        expireDeadline = callback;
        deadlineScheduled = true;
        deadlineMs = timeoutMs;
        return { cancel() {} };
      },
    });
    let childPid = 0;
    let supervisorPid = 0;
    try {
      await vi.waitFor(
        async () => {
          const pids = (await readFile(file, "utf8")).split(":").map(Number);
          childPid = pids[0] ?? 0;
          supervisorPid = pids[1] ?? 0;
          expect(childPid).toBeGreaterThan(0);
          expect(supervisorPid).toBeGreaterThan(0);
        },
        { timeout: 5000 },
      );
      const closing = owned.close();
      expect(deadlineMs).toBe(PROCESS_REAP_CONFIRMATION_TIMEOUT_MS);
      expect(deadlineScheduled).toBe(true);
      const rejected = expect(closing).rejects.toBeInstanceOf(
        ProcessReapingUnconfirmedError,
      );
      expireDeadline();
      await rejected;
      await expect(closing).rejects.toThrow("child reaping was not confirmed");
      expect(owned.alive()).toBe(true);
      expect(() => process.kill(childPid, 0)).not.toThrow();
      await vi.waitFor(() => expect(owned.alive()).toBe(false), {
        timeout: 5000,
      });
      expect(() => process.kill(childPid, 0)).toThrow();
    } finally {
      if (childPid > 0 && isProcessAlive(childPid)) killProcessGroup(childPid);
      if (supervisorPid > 0 && isProcessAlive(supervisorPid))
        process.kill(supervisorPid, "SIGKILL");
      await rm(root, { recursive: true, force: true });
    }
  }, 8_000);
});
