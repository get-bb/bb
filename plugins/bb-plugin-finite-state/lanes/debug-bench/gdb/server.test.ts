import { spawn, type ChildProcess } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DebugBenchConfigurationError,
  gdbServerArgv,
  inspectDebugBenchPrerequisites,
  startGdbServer,
} from "./server.js";

const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

async function fixtureExecutable(body: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "fs-gdb-server-"));
  cleanup.push(root);
  const path = join(root, "fixture-tool");
  await writeFile(path, `#!/usr/bin/env node\n${body}\n`, "utf8");
  await chmod(path, 0o755);
  return path;
}

describe("GDB server lifecycle", () => {
  it("builds explicit OpenOCD and J-Link argv", () => {
    expect(gdbServerArgv({
      kind: "openocd", executablePath: "/opt/openocd", targetConfig: "/cfg/stm32.cfg",
      connection: "usb:1366:0101:00009999", gdbPort: 3333, rtos: "freertos",
    })).toEqual([
      "-f", "/cfg/stm32.cfg", "-c", "gdb_port 3333", "-c", "adapter serial 00009999",
      "-c", "$_TARGETNAME configure -rtos freertos", "-c", "init",
    ]);
    expect(gdbServerArgv({
      kind: "jlink", executablePath: "/opt/JLinkGDBServer", targetConfig: "STM32F407VG",
      connection: "123456", gdbPort: 2331, interface: "jtag",
    })).toEqual([
      "-select", "USB=123456", "-device", "STM32F407VG", "-if", "JTAG",
      "-port", "2331", "-noir",
    ]);
  });

  it("rejects command-interpreter injection through a registry connection", () => {
    expect(() => gdbServerArgv({
      kind: "openocd", executablePath: "/opt/openocd", targetConfig: "target.cfg",
      connection: "usb:1366:0101:serial;reset", gdbPort: 3333,
    })).toThrowError(/unsafe characters/iu);
  });

  it("reports a missing server binary as needsConfiguration", async () => {
    await expect(startGdbServer({}, {
      kind: "openocd", executablePath: "/definitely/missing/openocd", targetConfig: "target.cfg",
      connection: "serial", gdbPort: 3333,
    }, new AbortController().signal)).rejects.toBeInstanceOf(DebugBenchConfigurationError);
  });

  it("reports every prerequisite with named remediation", async () => {
    const executable = await fixtureExecutable("process.exit(0)");
    await expect(inspectDebugBenchPrerequisites({
      python3: executable, gdb: null, openocd: "/missing/openocd", jlink: null,
    })).resolves.toMatchObject({
      needsConfiguration: true,
      tools: [
        { tool: "python3", configured: true },
        { tool: "gdb", configured: false, remediation: expect.stringContaining("gdb") },
        { tool: "openocd", configured: false, remediation: expect.stringContaining("OpenOCD") },
        { tool: "jlink", configured: false, remediation: expect.stringContaining("J-Link") },
      ],
    });
  });

  it("bounds failure diagnostics", async () => {
    const executablePath = await fixtureExecutable('process.stderr.write("x".repeat(4096)); process.exit(7)');
    await expect(startGdbServer({ healthProbe: async () => { throw new Error("not ready"); } }, {
      kind: "openocd", executablePath, targetConfig: "target.cfg", connection: "serial", gdbPort: 3333,
      maxOutputBytes: 64, startupTimeoutMs: 2_000,
    }, new AbortController().signal)).rejects.toMatchObject({
      code: "GDB_SERVER_EXITED",
      message: expect.not.stringMatching(/x{65}/u),
    });
  }, 10_000);

  it("owns and tears down the detached process on abort", async () => {
    const executablePath = await fixtureExecutable("setInterval(() => {}, 1000)");
    const controller = new AbortController();
    const children: ChildProcess[] = [];
    const handle = await startGdbServer({
      spawnProcess(command, args, options) {
        const child = spawn(command, args, options);
        children.push(child);
        return child;
      },
      healthProbe: async () => undefined,
    }, {
      kind: "jlink", executablePath, targetConfig: "device", connection: "serial", gdbPort: 2331,
    }, controller.signal);
    const child = children[0];
    if (!child) throw new Error("fixture process was not spawned");
    expect(child.exitCode).toBeNull();
    const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
    controller.abort();
    await closed;
    expect(child.signalCode).not.toBeNull();
    await handle.dispose();
  }, 10_000);

  it("disposes at the deadline when an escaped grandchild inherits server stdout", async () => {
    const executablePath = await fixtureExecutable(`
import { spawn } from "node:child_process";
const escaped = spawn(process.execPath, ["-e", "setTimeout(() => process.exit(0), 2000)"], {
  detached: true,
  stdio: ["ignore", 1, "ignore"],
});
escaped.unref();
setInterval(() => {}, 1000);
`);
    const handle = await startGdbServer({ healthProbe: async () => undefined }, {
      kind: "jlink",
      executablePath,
      targetConfig: "device",
      connection: "serial",
      gdbPort: 2331,
      stopTimeoutMs: 100,
    }, new AbortController().signal);
    const started = Date.now();
    await handle.dispose();
    expect(Date.now() - started).toBeLessThan(1_500);
  }, 10_000);
});
