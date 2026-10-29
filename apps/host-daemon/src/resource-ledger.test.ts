import { spawn } from "node:child_process";
import { once } from "node:events";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { makeTempDir } from "@bb/test-helpers";
import { trackedChildProcess } from "@bb/process-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestResourceLedger } from "../test/resource-ledger-fixture.js";
import type { DaemonResource } from "./resource-ledger.js";

const posixOnly = process.platform === "win32" ? describe.skip : describe;

const spawned: number[] = [];

function startGroup(resource: DaemonResource): number {
  const child = spawn("sh", ["-c", "sleep 60 & wait"], {
    detached: true,
    stdio: "ignore",
  });
  const tracked = trackedChildProcess(child, {
    processGroup: true,
    label: "test group",
  });
  if (tracked === null) throw new Error("spawn failed");
  spawned.push(tracked.pid);
  resource.trackProcess(tracked);
  return tracked.pid;
}

async function startRootWithEscapedChild(
  resource: DaemonResource,
): Promise<{ root: number; escaped: number }> {
  const child = spawn(
    process.execPath,
    [
      "-e",
      [
        "const { spawn } = require('node:child_process');",
        "const escaped = spawn('sleep', ['60'], { detached: true, stdio: 'ignore' });",
        "process.stdout.write(String(escaped.pid) + '\\n');",
        "setInterval(() => {}, 1000);",
      ].join(" "),
    ],
    { detached: true, stdio: ["ignore", "pipe", "ignore"] },
  );
  const tracked = trackedChildProcess(child, {
    processGroup: true,
    label: "test root",
  });
  if (tracked === null) throw new Error("spawn failed");
  spawned.push(tracked.pid);
  resource.trackProcess(tracked);
  const [chunk] = await once(child.stdout, "data");
  const escaped = Number(String(chunk).trim());
  spawned.push(escaped);
  return { root: tracked.pid, escaped };
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function groupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

function records(directory: string): string[] {
  return readdirSync(directory).filter((name) => name.endsWith(".json"));
}

afterEach(() => {
  for (const pid of spawned.splice(0)) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {}
  }
});

posixOnly("ResourceLedger", () => {
  it("stops what a previous daemon instance left running and reports it once", async () => {
    const directory = await makeTempDir("bb-resource-ledger-");
    const previous = createTestResourceLedger(directory);
    const hook = previous.open({
      owner: {
        kind: "environment-hook",
        operationId: "environment:env-1:key:teardown",
        hook: "teardown",
        path: "/workspace",
      },
      deadline: { kind: "at", at: Date.now() + 60_000 },
    });
    const pid = startGroup(hook);
    await expect
      .poll(() =>
        records(directory).flatMap(
          (name) =>
            JSON.parse(readFileSync(path.join(directory, name), "utf8"))
              .processes,
        ),
      )
      .toEqual([expect.objectContaining({ pid, startId: expect.any(String) })]);
    previous.shutdown();
    expect(records(directory)).toHaveLength(1);

    const next = createTestResourceLedger(directory);
    await next.reconcile();

    expect(groupAlive(pid)).toBe(false);
    expect(records(directory)).toEqual([]);
    expect(
      next.previousOperationTermination("environment:env-1:key:teardown"),
    ).toBe("confirmed");
  });

  it("stops a resource's processes when its owner does not end it by the deadline", async () => {
    const ledger = createTestResourceLedger();
    const resource = ledger.open({
      owner: { kind: "provider-runtime", environmentId: "env-2" },
      deadline: { kind: "at", at: Date.now() + 50 },
      onDeadline: () => undefined,
    });
    const pid = startGroup(resource);

    await expect(resource.done).resolves.toEqual({
      status: "failed",
      message: "The resource was stopped at its deadline",
      terminationUnverified: false,
    });
    expect(groupAlive(pid)).toBe(false);
  });

  it("holds an idle deadline while a lease is held and expires a lease that never ends", async () => {
    const ledger = createTestResourceLedger();
    let expirations = 0;
    const resource = ledger.open({
      owner: { kind: "provider-maintenance" },
      deadline: { kind: "idle", idleMs: 50 },
      onDeadline: () => {
        expirations += 1;
        resource.close();
      },
    });
    const release = resource.lease(Date.now() + 60_000);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(expirations).toBe(0);
    release();
    await expect.poll(() => expirations).toBe(1);

    const hung = ledger.open({
      owner: { kind: "provider-maintenance" },
      deadline: { kind: "idle", idleMs: 60_000 },
      onDeadline: () => hung.close(),
    });
    hung.lease(Date.now() + 50);
    await expect(hung.done).resolves.toEqual({ status: "completed" });
  });

  it("keeps the record of a resource whose processes outlive a graceful shutdown", async () => {
    const directory = await makeTempDir("bb-resource-ledger-");
    const ledger = createTestResourceLedger(directory);
    ledger.open({
      owner: { kind: "file-watcher" },
      deadline: { kind: "owner" },
    });
    const running = ledger.open({
      owner: { kind: "provider-runtime", environmentId: "env-1" },
      deadline: { kind: "owner" },
    });
    startGroup(running);

    ledger.shutdown();

    expect(records(directory)).toEqual([`${running.id}.json`]);
  });

  it("stops descendants that left the owner's process group when the owner ends", async () => {
    const ledger = createTestResourceLedger();
    const resource = ledger.open({
      owner: { kind: "provider-runtime", environmentId: "env-1" },
      deadline: { kind: "owner" },
    });
    const { root, escaped } = await startRootWithEscapedChild(resource);

    await resource.end(() => {
      process.kill(-root, "SIGKILL");
    });

    expect(groupAlive(root)).toBe(false);
    expect(alive(escaped)).toBe(false);
  });

  it("stops captured descendants of a previous instance after their parent died", async () => {
    const directory = await makeTempDir("bb-resource-ledger-");
    const previous = createTestResourceLedger(directory);
    const resource = previous.open({
      owner: { kind: "provider-runtime", environmentId: "env-2" },
      deadline: { kind: "owner" },
    });
    const { root, escaped } = await startRootWithEscapedChild(resource);
    await resource.captureTree();
    process.kill(-root, "SIGKILL");
    await expect.poll(() => groupAlive(root)).toBe(false);
    expect(alive(escaped)).toBe(true);

    await createTestResourceLedger(directory).reconcile();

    expect(alive(escaped)).toBe(false);
    expect(records(directory)).toEqual([]);
  });

  it("keeps an idle resource whose owner became busy during the deadline", async () => {
    const ledger = createTestResourceLedger();
    let release: (() => void) | null = null;
    const resource = ledger.open({
      owner: { kind: "provider-maintenance" },
      deadline: { kind: "idle", idleMs: 20 },
      onDeadline: () => {
        release ??= resource.lease(Number.POSITIVE_INFINITY);
      },
    });
    const group = startGroup(resource);
    await expect.poll(() => release).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 1_000));

    expect(resource.closed).toBe(false);
    expect(groupAlive(group)).toBe(true);
    release!();
    await expect.poll(() => resource.closed).toBe(true);
  });

  it("never signals a group a late exit report cannot tie to its record", async () => {
    const ledger = createTestResourceLedger();
    const resource = ledger.open({
      owner: { kind: "plugin-host", pluginId: "fixture", generation: "g1" },
      deadline: { kind: "owner" },
    });
    const replacement = spawn("sh", ["-c", "sleep 60 & exit 0"], {
      detached: true,
      stdio: "ignore",
    });
    spawned.push(replacement.pid!);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(alive(replacement.pid!)).toBe(false);
    expect(groupAlive(replacement.pid!)).toBe(true);
    let reportExit: () => void = () => undefined;
    resource.adoptProcess({
      pid: replacement.pid!,
      processGroup: true,
      label: "reported",
      startId: async () => "a process that no longer exists",
      exited: new Promise((resolve) => {
        reportExit = resolve;
      }),
    });
    reportExit();
    await new Promise((resolve) => setTimeout(resolve, 200));

    await expect(resource.close()).resolves.toMatchObject({
      terminationUnverified: true,
    });
    expect(groupAlive(replacement.pid!)).toBe(true);
  });

  it("keeps a recorded group whose leader is gone but whose members live on", async () => {
    const directory = await makeTempDir("bb-resource-ledger-");
    const resource = createTestResourceLedger(directory).open({
      owner: { kind: "provider-runtime", environmentId: "env-1" },
      deadline: { kind: "owner" },
    });
    const child = spawn("sh", ["-c", "sleep 60 & wait"], {
      detached: true,
      stdio: "ignore",
    });
    spawned.push(child.pid!);
    resource.trackProcess({
      pid: child.pid!,
      processGroup: true,
      label: "group",
      startId: async () => null,
      exited: new Promise(() => undefined),
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    process.kill(child.pid!, "SIGKILL");
    await expect.poll(() => alive(child.pid!)).toBe(false);

    const restarted = createTestResourceLedger(directory);
    await restarted.reconcile();

    expect(groupAlive(child.pid!)).toBe(true);
    expect(records(directory)).toEqual([`${resource.id}.json`]);
  });

  it("matches an adopted child by its OS start identity after the wall clock jumps", async () => {
    const ledger = createTestResourceLedger();
    const resource = ledger.open({
      owner: { kind: "host-command" },
      deadline: { kind: "owner" },
    });
    const child = spawn("sleep", ["60"], { stdio: "ignore" });
    spawned.push(child.pid!);
    const tracked = trackedChildProcess(child, {
      processGroup: false,
      label: "sleep",
    });
    const realNow = Date.now();
    const jumped = vi
      .spyOn(Date, "now")
      .mockImplementation(() => realNow + 60 * 60_000);
    try {
      resource.adoptProcess(tracked!);
      await resource.close();
    } finally {
      jumped.mockRestore();
    }

    expect(alive(child.pid!)).toBe(false);
  });

  it("does not rewrite the record when only an idle lease changes", async () => {
    const directory = await makeTempDir("bb-resource-ledger-");
    const ledger = createTestResourceLedger(directory);
    const resource = ledger.open({
      owner: { kind: "plugin-host", pluginId: "fixture", generation: "g1" },
      deadline: { kind: "idle", idleMs: 60_000 },
    });
    const record = path.join(directory, `${resource.id}.json`);
    const written = statSync(record).ino;

    for (let call = 0; call < 5; call += 1) {
      resource.lease(Number.POSITIVE_INFINITY)();
    }

    expect(statSync(record).ino).toBe(written);
  });

  it("ends the tree of its own live child after the wall clock jumps", async () => {
    const ledger = createTestResourceLedger();
    const resource = ledger.open({
      owner: { kind: "provider-runtime", environmentId: "env-1" },
      deadline: { kind: "owner" },
    });
    const { root, escaped } = await startRootWithEscapedChild(resource);
    const realNow = Date.now();
    const jumped = vi
      .spyOn(Date, "now")
      .mockImplementation(() => realNow + 60 * 60_000);
    try {
      await resource.end(() => {
        process.kill(-root, "SIGKILL");
      });
    } finally {
      jumped.mockRestore();
    }

    expect(alive(escaped)).toBe(false);
  });

  it("reads a held child's start token again when the first read failed", async () => {
    const ledger = createTestResourceLedger();
    const resource = ledger.open({
      owner: { kind: "provider-runtime", environmentId: "env-1" },
      deadline: { kind: "owner" },
    });
    const child = spawn("sleep", ["60"], { stdio: "ignore" });
    spawned.push(child.pid!);
    const tracked = trackedChildProcess(child, {
      processGroup: false,
      label: "sleep",
    })!;
    let reads = 0;
    resource.trackProcess({
      ...tracked,
      startId: () => {
        reads += 1;
        return reads === 1 ? Promise.resolve(null) : tracked.startId();
      },
    });
    await expect.poll(() => reads).toBe(1);

    await resource.close();

    expect(alive(child.pid!)).toBe(false);
  });

  it("keeps a record it cannot read and reports it unverified", async () => {
    const directory = await makeTempDir("bb-resource-ledger-");
    const owner = {
      kind: "environment-hook",
      operationId: "environment:env-1:key:setup",
      hook: "setup",
      path: "/workspace",
    } as const;
    writeFileSync(
      path.join(directory, "legacy.json"),
      JSON.stringify({
        version: 1,
        id: "legacy",
        instanceId: "previous",
        owner,
        openedAt: Date.now(),
        deadlineAt: null,
        processes: [
          {
            pid: process.pid,
            processGroup: false,
            startedAt: Date.now(),
            label: "legacy",
          },
        ],
      }),
    );
    const ledger = createTestResourceLedger(directory);

    await ledger.reconcile();

    expect(records(directory)).toEqual(["legacy.json"]);
    expect(ledger.previousOperationTermination(owner.operationId)).toBe(
      "unverified",
    );
  });
});
