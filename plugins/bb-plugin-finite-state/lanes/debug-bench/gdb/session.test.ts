import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClaimResult } from "../registry/claims.js";
import type { BenchDeviceRecord } from "../registry/families.js";
import { GdbSessionError, openGdbSession, type DebugBenchDeps } from "./session.js";

const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

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

function claim(overrides: Partial<BenchDeviceRecord> = {}): ClaimResult {
  return { outcome: "claimed", device: { ...device, ...overrides }, expiredHolders: [] };
}

async function deps(): Promise<DebugBenchDeps & { releaseClaim: ReturnType<typeof vi.fn>; startServer: ReturnType<typeof vi.fn> }> {
  const releaseClaim = vi.fn(async () => undefined);
  const startServer = vi.fn(async () => ({
    kind: "jlink" as const, host: "127.0.0.1" as const, port: 2331, argv: [],
    diagnostics: () => ({ stdout: "", stderr: "" }), dispose: async () => undefined,
  }));
  return {
    gdbExecutablePath: await fakeGdb(),
    serverConfig: () => ({ kind: "jlink", executablePath: "/unused", targetConfig: "STM32F407VG", gdbPort: 2331 }),
    verifyClaim: vi.fn(async () => undefined),
    releaseClaim,
    startServer,
  };
}

describe("GDB session", () => {
  it("connects and exposes typed bounded operations", async () => {
    const dependencies = await deps();
    const session = await openGdbSession(dependencies, device.deviceId, claim(), new AbortController().signal);
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
    const session = await openGdbSession(dependencies, device.deviceId, claim(), new AbortController().signal);
    expect(await session.rtosTasks()).toMatchObject({ method: "symbols", tasks: [{ id: "tcb-1" }] });
    await session.dispose();
  });

  it("reaps the session and releases its claim exactly once on abort", async () => {
    const dependencies = await deps();
    const controller = new AbortController();
    const session = await openGdbSession(dependencies, device.deviceId, claim(), controller.signal);
    controller.abort(new Error("test abort"));
    await session.dispose();
    expect(dependencies.releaseClaim).toHaveBeenCalledOnce();
  });

  it("releases a verified claim when GDB configuration prevents opening", async () => {
    const dependencies = await deps();
    dependencies.gdbExecutablePath = "/definitely/missing/gdb";
    await expect(openGdbSession(dependencies, device.deviceId, claim(), new AbortController().signal))
      .rejects.toMatchObject({ name: "NeedsConfigurationError", tool: "gdb" });
    expect(dependencies.startServer).not.toHaveBeenCalled();
    expect(dependencies.releaseClaim).toHaveBeenCalledOnce();
  });

  it("refuses an absent, foreign, or stale claim before server or device I/O", async () => {
    const dependencies = await deps();
    await expect(openGdbSession(
      dependencies,
      device.deviceId,
      claim({ claimedBy: null }),
      new AbortController().signal,
    )).rejects.toBeInstanceOf(GdbSessionError);
    await expect(openGdbSession(
      dependencies,
      "other-device",
      claim(),
      new AbortController().signal,
    )).rejects.toMatchObject({ code: "DEVICE_CLAIM_REQUIRED" });
    await expect(openGdbSession(
      dependencies,
      device.deviceId,
      claim({ stale: true }),
      new AbortController().signal,
    )).rejects.toMatchObject({ code: "DEVICE_UNAVAILABLE" });
    expect(dependencies.startServer).not.toHaveBeenCalled();
  });
});
