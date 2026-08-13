import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MIGRATIONS } from "../../../lib/store/schema.js";
import { claimDevice, DEFAULT_CLAIM_TTL_MS, type DeviceClaim } from "../registry/claims.js";
import type { BenchDeviceRecord } from "../registry/families.js";
import { recordFamilyStatus } from "../registry/store.js";
import { openGdbSession, type DebugBenchDeps } from "./session.js";

const cleanup: string[] = [];
const databases: Database.Database[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) db.close();
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fakeGdb(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "fs-fake-gdb-"));
  cleanup.push(root);
  const path = join(root, "gdb");
  await writeFile(path, `#!/usr/bin/env node
import readline from "node:readline";
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const match = /^(\\d+)(.*)$/.exec(line);
  if (!match) return;
  const token = match[1]; const command = match[2];
  if (command.startsWith("-break-insert")) console.log(token + '^done,bkpt={number="1",addr="0x08000100"}');
  else if (command.startsWith("-break-delete")) console.log(token + "^done");
  else if (command.startsWith("-data-list-register-names")) console.log(token + '^done,register-names=["r0","r1","pc"]');
  else if (command.startsWith("-data-list-register-values")) console.log(token + '^done,register-values=[{number="0",value="0x1"},{number="2",value="0x08000100"}]');
  else if (command.startsWith("-data-read-memory-bytes")) console.log(token + '^done,memory=[{begin="0x2000",contents="01020304"}]');
  else if (command.startsWith("-stack-list-frames")) console.log(token + '^done,stack=[frame={level="0",addr="0x08000100",func="main",file="main.c",line="12"}]');
  else if (command.startsWith("-thread-info")) console.log(token + '^done,threads=[{id="1",target-id="Task idle",state="stopped",priority="0",frame={addr="0x20001000"}}]');
  else console.log(token + "^done");
});
setInterval(() => {}, 1000);
`, "utf8");
  await chmod(path, 0o755);
  return path;
}

const device: BenchDeviceRecord = {
  projectId: "project-1", projectVersionId: "pv-1", deviceId: "probe-rs:serial-hash",
  kind: "probe", make: "J-Link", model: "J-Link", connection: "usb:1366:0101:00009999",
  transport: "local-usb", claimedBy: "thread-1", claimedAt: new Date().toISOString(),
  claimScope: "machine", lastSeen: new Date().toISOString(), stale: false,
};

function claimedDatabase(): { db: Database.Database; claim: DeviceClaim } {
  const db = new Database(":memory:");
  databases.push(db);
  db.transaction(() => { for (const migration of MIGRATIONS) db.exec(migration); })();
  db.prepare(
    `INSERT INTO bench_device (
       project_id, project_version_id, device_id, kind, make, model, connection,
       transport, claimed_by, claimed_at, claim_scope, last_seen
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
  ).run(
    device.projectId, device.projectVersionId, device.deviceId, device.kind, device.make,
    device.model, device.connection, device.transport, device.claimScope, device.lastSeen,
  );
  const claimedAt = new Date();
  claimDevice(db, device.deviceId, "thread-1", {
    scope: { projectId: device.projectId, projectVersionId: device.projectVersionId },
    now: claimedAt,
  });
  return {
    db,
    claim: {
      deviceId: device.deviceId,
      holder: "thread-1",
      scope: "machine",
      expiresAt: new Date(claimedAt.getTime() + DEFAULT_CLAIM_TTL_MS).toISOString(),
    },
  };
}

async function deps(): Promise<DebugBenchDeps & {
  claim: DeviceClaim;
  releaseClaim: ReturnType<typeof vi.fn>;
  startServer: ReturnType<typeof vi.fn>;
}> {
  const { db, claim } = claimedDatabase();
  const releaseClaim = vi.fn(async () => undefined);
  const startServer = vi.fn(async () => ({
    kind: "jlink" as const, host: "127.0.0.1" as const, port: 2331, argv: [],
    diagnostics: () => ({ stdout: "", stderr: "" }), dispose: async () => undefined,
  }));
  return {
    db,
    registryScope: { projectId: device.projectId, projectVersionId: device.projectVersionId },
    claim,
    gdbExecutablePath: await fakeGdb(),
    serverConfig: () => ({ kind: "jlink", executablePath: "/unused", targetConfig: "STM32F407VG", gdbPort: 2331 }),
    releaseClaim,
    startServer,
  };
}

describe("GDB session", () => {
  it("connects and exposes typed bounded operations", async () => {
    const dependencies = await deps();
    const session = await openGdbSession(dependencies, device.deviceId, dependencies.claim, new AbortController().signal);
    const breakpoint = await session.setBreakpoint("main");
    expect(breakpoint).toMatchObject({ id: "1", location: "main" });
    await breakpoint.delete();
    expect(await session.readRegisters()).toEqual({ r0: "0x1", pc: "0x08000100" });
    expect(await session.readMemory("0x2000", 4)).toEqual(Uint8Array.from([1, 2, 3, 4]));
    expect(await session.backtrace()).toEqual([{
      level: 0, address: "0x08000100", function: "main", file: "main.c", line: 12,
    }]);
    expect(await session.rtosTasks()).toEqual({
      method: "server",
      tasks: [{ id: "1", name: "Task idle", state: "stopped", priority: 0, stackPointer: "0x20001000" }],
    });
    await expect(session.executeCommand("-thread-info\n2-target-download")).rejects.toMatchObject({ code: "INVALID_GDB_ARGUMENT" });
    await expect(session.readMemory("0", 65_537)).rejects.toMatchObject({ code: "MEMORY_READ_BOUND" });
    await session.dispose();
    expect(dependencies.releaseClaim).toHaveBeenCalledWith(device.deviceId, "thread-1");
  }, 15_000);

  it("selects the symbol fallback when server RTOS awareness is unavailable", async () => {
    const dependencies = await deps();
    dependencies.rtos = {
      serverAware: false,
      elfPath: "/firmware.elf",
      rtos: "freertos",
      walkSymbols: async () => [{ id: "tcb-1", name: "worker", state: "ready", priority: 2, stackPointer: "0x2000" }],
    };
    const session = await openGdbSession(dependencies, device.deviceId, dependencies.claim, new AbortController().signal);
    expect(await session.rtosTasks()).toMatchObject({ method: "symbols", tasks: [{ id: "tcb-1" }] });
    await session.dispose();
  });

  it("reaps the session and releases its claim exactly once on abort", async () => {
    const dependencies = await deps();
    const controller = new AbortController();
    const session = await openGdbSession(dependencies, device.deviceId, dependencies.claim, controller.signal);
    controller.abort(new Error("test abort"));
    await session.dispose();
    expect(dependencies.releaseClaim).toHaveBeenCalledOnce();
  });

  it("releases a verified claim when GDB configuration prevents opening", async () => {
    const dependencies = await deps();
    dependencies.gdbExecutablePath = "/definitely/missing/gdb";
    await expect(openGdbSession(dependencies, device.deviceId, dependencies.claim, new AbortController().signal))
      .rejects.toMatchObject({ name: "NeedsConfigurationError", tool: "gdb" });
    expect(dependencies.startServer).not.toHaveBeenCalled();
    expect(dependencies.releaseClaim).toHaveBeenCalledOnce();
  });

  it("refuses an absent, foreign, or stale claim before server or device I/O", async () => {
    const dependencies = await deps();
    await expect(openGdbSession(
      dependencies,
      device.deviceId,
      { ...dependencies.claim, expiresAt: "2000-01-01T00:00:00.000Z" },
      new AbortController().signal,
    )).rejects.toMatchObject({ code: "CLAIM_EXPIRED" });
    await expect(openGdbSession(
      dependencies,
      device.deviceId,
      { ...dependencies.claim, holder: "thread-2" },
      new AbortController().signal,
    )).rejects.toMatchObject({ code: "DEVICE_NOT_HELD", holder: "thread-1" });
    recordFamilyStatus(dependencies.db, dependencies.registryScope, {
      familyId: "probe-rs",
      kind: "probe",
      label: "Debug probes",
      availability: "unavailable",
      reason: "fixture unavailable",
      helper: { id: "probe-rs-tools", displayName: "probe-rs", source: "fixture", why: "fixture" },
      needsConfiguration: true,
      checkedAt: new Date(Date.now() + 1_000).toISOString(),
    });
    await expect(openGdbSession(
      dependencies,
      device.deviceId,
      dependencies.claim,
      new AbortController().signal,
    )).rejects.toMatchObject({ code: "DEVICE_UNAVAILABLE" });
    expect(dependencies.startServer).not.toHaveBeenCalled();
  });
});
