import { spawn } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { listProcessesWithCwdUnder } from "../src/cwd-processes.js";

const lsofScans = vi.hoisted(() => ({ maxRunning: 0, running: 0 }));

vi.mock("../src/spawn.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/spawn.js")>();
  return {
    ...actual,
    spawnPortableOutputProcess: (
      request: Parameters<typeof actual.spawnPortableOutputProcess>[0],
    ) => {
      const child = actual.spawnPortableOutputProcess(request);
      if (request.command === "lsof") {
        lsofScans.running += 1;
        lsofScans.maxRunning = Math.max(
          lsofScans.maxRunning,
          lsofScans.running,
        );
        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          lsofScans.running -= 1;
        };
        child.once("exit", finish);
        child.once("error", finish);
      }
      return child;
    },
  };
});

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function makeBase(): Promise<string> {
  const base = await realpath(
    await mkdtemp(join(tmpdir(), "bb-cwd-scan-sharing-")),
  );
  cleanups.push(() => rm(base, { recursive: true, force: true }));
  return base;
}

async function runIn(cwd: string): Promise<number | undefined> {
  await mkdir(cwd, { recursive: true });
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    cwd,
    stdio: "ignore",
  });
  const exited = new Promise<void>((resolve) =>
    child.once("exit", () => resolve()),
  );
  cleanups.push(async () => {
    child.kill("SIGKILL");
    await exited;
  });
  await new Promise<void>((resolve) => child.once("spawn", () => resolve()));
  return child.pid;
}

it.skipIf(process.platform === "win32" || process.platform === "linux")(
  "runs one lsof scan at a time for concurrent callers",
  async () => {
    const base = await makeBase();
    const pids = await Promise.all(
      Array.from({ length: 8 }, (_, index) => runIn(join(base, `${index}`))),
    );
    lsofScans.maxRunning = 0;

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        listProcessesWithCwdUnder({ directories: [join(base, `${index}`)] }),
      ),
    );

    expect(results.map((entries) => entries.map((entry) => entry.pid))).toEqual(
      pids.map((pid) => [pid]),
    );
    expect(lsofScans.maxRunning).toBe(1);
  },
);

it.skipIf(process.platform === "win32" || process.platform === "linux")(
  "does not answer a caller with a scan that started before it asked",
  async () => {
    const base = await makeBase();
    const directory = join(base, "late");
    await mkdir(directory);
    const earlier = listProcessesWithCwdUnder({ directories: [directory] });
    await vi.waitFor(() => expect(lsofScans.running).toBe(1));
    const pid = await runIn(directory);

    const later = await listProcessesWithCwdUnder({ directories: [directory] });

    expect(later.map((entry) => entry.pid)).toEqual([pid]);
    await earlier;
  },
);
