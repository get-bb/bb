import { spawn } from "node:child_process";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import {
  createProcessStop,
  spawnManagedProcess,
} from "../src/managed-process.js";
import { probeProcessStart } from "../src/process-start.js";
import {
  snapshotProcessTree,
  stopProcessTree,
  stopRecordedProcess,
} from "../src/recorded-process.js";

const posixOnly = process.platform === "win32" ? describe.skip : describe;

const spawned: number[] = [];

async function startIdOf(pid: number): Promise<string> {
  const probe = await probeProcessStart(pid);
  if (probe.state !== "running")
    throw new Error(`process ${pid} is not running`);
  return probe.startId;
}

function spawnDetachedGroup(): { pid: number } {
  const child = spawn("sh", ["-c", "sleep 60 & sleep 60 & wait"], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  if (child.pid === undefined) throw new Error("spawn failed");
  spawned.push(child.pid);
  return { pid: child.pid };
}

function groupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

const DETACHED_GRANDCHILD = [
  "-e",
  [
    "const { spawn } = require('node:child_process');",
    "const grandchild = spawn('sleep', ['60'], { detached: true, stdio: 'ignore' });",
    "grandchild.unref();",
    "process.stdout.write(String(grandchild.pid) + '\\n');",
    "process.on('SIGTERM', () => process.exit(0));",
    "setInterval(() => {}, 1000);",
  ].join(" "),
];

const strays: number[] = [];

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function firstLine(stream: NodeJS.ReadableStream): Promise<number> {
  const [chunk] = await once(stream, "data");
  const pid = Number(String(chunk).trim());
  strays.push(pid);
  return pid;
}

function spawnRootWithDetachedGrandchild() {
  const child = spawn(process.execPath, DETACHED_GRANDCHILD, {
    detached: true,
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (child.pid === undefined) throw new Error("spawn failed");
  spawned.push(child.pid);
  return { child, pid: child.pid };
}

afterEach(() => {
  for (const pid of spawned.splice(0)) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {}
  }
  for (const pid of strays.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
});

posixOnly("stopRecordedProcess", () => {
  it("stops every member of a recorded process group", async () => {
    const group = spawnDetachedGroup();
    const recorded = {
      pid: group.pid,
      processGroup: true,
      startId: await startIdOf(group.pid),
    };
    await new Promise((resolve) => setTimeout(resolve, 300));

    await expect(
      stopRecordedProcess(recorded, { graceMs: 1_000 }),
    ).resolves.toBe("terminated");
    expect(groupAlive(group.pid)).toBe(false);
  });

  it("leaves a group alone and unverified when its recorded leader is gone", async () => {
    const group = spawnDetachedGroup();
    const startId = await startIdOf(group.pid);
    await new Promise((resolve) => setTimeout(resolve, 300));
    process.kill(group.pid, "SIGKILL");
    await expect
      .poll(async () => {
        try {
          process.kill(group.pid, 0);
          return true;
        } catch {
          return false;
        }
      })
      .toBe(false);
    expect(groupAlive(group.pid)).toBe(true);

    await expect(
      stopRecordedProcess(
        { pid: group.pid, processGroup: true, startId },
        { graceMs: 1_000 },
      ),
    ).resolves.toBe("unverified");
    expect(groupAlive(group.pid)).toBe(true);
  });

  it("leaves a process alone when its start time does not match the record", async () => {
    const group = spawnDetachedGroup();
    const recorded = {
      pid: group.pid,
      processGroup: true,
      startId: "Thu Jan  1 00:00:00 1970",
    };

    await expect(
      stopRecordedProcess(recorded, { graceMs: 1_000 }),
    ).resolves.toBe("unverified");
    expect(groupAlive(group.pid)).toBe(true);
  });

  it("reads the same start token whatever time zone the caller runs in", async () => {
    const group = spawnDetachedGroup();
    const zone = process.env.TZ;
    try {
      process.env.TZ = "America/Los_Angeles";
      const pacific = await startIdOf(group.pid);
      process.env.TZ = "UTC";
      const utc = await startIdOf(group.pid);

      expect(utc).toBe(pacific);
    } finally {
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    }
  });

  it("reports a recorded process that already exited", async () => {
    const child = spawn("true", [], { detached: true, stdio: "ignore" });
    await new Promise((resolve) => child.once("exit", resolve));

    await expect(
      stopRecordedProcess(
        { pid: child.pid!, processGroup: true, startId: null },
        { graceMs: 1_000 },
      ),
    ).resolves.toBe("exited");
  });

  it("stops a descendant that moved into its own process group", async () => {
    const root = spawnRootWithDetachedGrandchild();
    const grandchild = await firstLine(root.child.stdout!);
    expect(alive(grandchild)).toBe(true);

    await expect(
      stopRecordedProcess(
        {
          pid: root.pid,
          processGroup: true,
          startId: await startIdOf(root.pid),
        },
        { graceMs: 1_000 },
      ),
    ).resolves.toBe("terminated");
    await expect.poll(() => alive(grandchild)).toBe(false);
  });

  it("stops descendants captured before their parent exited", async () => {
    const root = spawnRootWithDetachedGrandchild();
    const grandchild = await firstLine(root.child.stdout!);
    const snapshot = await snapshotProcessTree([
      { pid: root.pid, processGroup: true, startId: await startIdOf(root.pid) },
    ]);
    process.kill(-root.pid, "SIGKILL");
    await expect.poll(() => groupAlive(root.pid)).toBe(false);
    expect(alive(grandchild)).toBe(true);

    await expect(stopProcessTree(snapshot, { graceMs: 1_000 })).resolves.toBe(
      "terminated",
    );
    expect(alive(grandchild)).toBe(false);
  });
});

posixOnly("spawnManagedProcess stop", () => {
  it("stops descendants that left the managed process group", async () => {
    const managed = spawnManagedProcess({
      command: process.execPath,
      args: DETACHED_GRANDCHILD,
    });
    spawned.push(managed.child.pid!);
    const grandchild = await firstLine(managed.child.stdout!);

    await managed.stop({ gracePeriodMs: 1_000 });

    expect(alive(grandchild)).toBe(false);
  });

  it("does not signal a group once its leader handle has exited", async () => {
    const exited = spawn("true", [], { stdio: "ignore" });
    await new Promise((resolve) => exited.once("exit", resolve));
    const replacement = spawnDetachedGroup();
    await new Promise((resolve) => setTimeout(resolve, 300));
    Object.defineProperty(exited, "pid", { value: replacement.pid });

    await expect(
      createProcessStop(exited)({ gracePeriodMs: 100 }),
    ).resolves.toEqual({ treeTermination: "unverified" });
    expect(groupAlive(replacement.pid)).toBe(true);
  });
});
