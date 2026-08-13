import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MIGRATIONS } from "../../../lib/store/schema.js";
import type { ClaimResult } from "../registry/claims.js";
import type { BenchDeviceRecord } from "../registry/families.js";
import type { DebugGdbSession } from "../gdb/session.js";
import { isDestructiveGdbCommand, runProbe, type ProbeRuntimeDeps } from "./runtime.js";
import { openProbeStore } from "./store.js";

const databases: Database.Database[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) db.close();
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function database(): Database.Database {
  const db = new Database(":memory:");
  databases.push(db);
  db.transaction(() => { for (const migration of MIGRATIONS) db.exec(migration); })();
  return db;
}

async function worktree(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "fs-probe-runtime-"));
  directories.push(root);
  execFileSync("git", ["init", "--quiet", root]);
  await writeFile(join(root, ".gitignore"), ".fs-bench/\n", "utf8");
  const store = await openProbeStore(root);
  await store.create("test", `"""
hypothesis: test hypothesis
devices: probe-rs:serial-hash
expected discriminating observation: fixture response
"""
`);
  return root;
}

async function fixtureBridge(body: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "fs-python-fixture-"));
  directories.push(root);
  const path = join(root, "python3");
  await writeFile(path, `#!/usr/bin/env node
import readline from "node:readline";
const rl = readline.createInterface({ input: process.stdin });
const request = (message) => new Promise((resolve) => {
  console.log(JSON.stringify(message));
  rl.once("line", (line) => resolve(JSON.parse(line)));
});
${body}
`, "utf8");
  await chmod(path, 0o755);
  return path;
}

const device: BenchDeviceRecord = {
  projectId: "project-1", projectVersionId: "pv-1", deviceId: "probe-rs:serial-hash",
  kind: "probe", make: "J-Link", model: "J-Link", connection: "usb:serial",
  transport: "local-usb", claimedBy: "thread-1", claimedAt: new Date().toISOString(),
  claimScope: "machine", lastSeen: new Date().toISOString(), stale: false,
};
const claim: ClaimResult = { outcome: "claimed", device, expiredHolders: [] };

async function runtime(
  pythonExecutablePath: string,
  root: string,
  overrides: Partial<ProbeRuntimeDeps> = {},
) {
  const releaseClaim = vi.fn(async (_deviceId: string, _holder: string) => undefined);
  const executeCommand = vi.fn(async () => ({ kind: "result" as const, token: 1, class: "done", results: { value: "ok" } }));
  const session: DebugGdbSession = {
    deviceId: device.deviceId, serverKind: "jlink", executeCommand,
    setBreakpoint: vi.fn(), readRegisters: vi.fn(), readMemory: vi.fn(), backtrace: vi.fn(), rtosTasks: vi.fn(),
    halt: vi.fn(), continue: vi.fn(), dispose: async () => { await releaseClaim(device.deviceId, "thread-1"); },
  };
  const deps: ProbeRuntimeDeps = {
    db: database(), projectId: "project-1", projectVersionId: "pv-1", worktreeRoot: root,
    pythonExecutablePath, verifyClaim: vi.fn(async () => undefined), releaseClaim,
    openSession: vi.fn(async () => session), createRunId: () => "probe-run-1",
    now: (() => { let second = 0; return () => new Date(1_700_000_000_000 + second++); })(),
    ...overrides,
  };
  return { deps, releaseClaim, executeCommand };
}

const request = {
  scriptPath: ".fs/bench/probes/test.py",
  deviceIds: [device.deviceId],
  hypothesis: "test hypothesis",
  timeoutMs: 5_000,
};

describe("probe runtime", () => {
  it("binds requested devices, dispatches safe GDB, writes artifacts, and persists the outcome", async () => {
    const root = await worktree();
    const python = await fixtureBridge(`
const gdb = await request({ type: "gdb", id: 1, deviceId: "probe-rs:serial-hash", command: "-data-evaluate-expression", args: ["counter"] });
if (!gdb.ok) throw new Error(gdb.error);
const artifact = await request({ type: "artifact", id: 2, path: "captures/result.csv", data: Buffer.from("a,b\\n").toString("base64") });
if (!artifact.ok) throw new Error(artifact.error);
console.log(JSON.stringify({ type: "result", outcome: "confirmed" }));
`);
    const { deps, executeCommand, releaseClaim } = await runtime(python, root);
    const result = await runProbe(deps, request, [claim], new AbortController().signal);
    expect(result).toMatchObject({ outcome: "confirmed", artifacts: [".fs-bench/probe-run-1/captures/result.csv"] });
    expect(executeCommand).toHaveBeenCalledWith("-data-evaluate-expression", ["counter"]);
    expect(await readFile(join(root, ".fs-bench/probe-run-1/captures/result.csv"), "utf8")).toBe("a,b\n");
    expect(deps.db.prepare("SELECT outcome, finished_at FROM probe_run").get()).toMatchObject({ outcome: "confirmed", finished_at: expect.any(String) });
    expect(releaseClaim).toHaveBeenCalledOnce();
  }, 15_000);

  it("rejects destructive commands before any byte reaches the GDB session", async () => {
    const root = await worktree();
    const python = await fixtureBridge(`
const response = await request({ type: "gdb", id: 1, deviceId: "probe-rs:serial-hash", command: "-interpreter-exec", args: ["console", "monitor reset halt"] });
console.log(JSON.stringify({ type: "error", message: response.error }));
`);
    const { deps, executeCommand } = await runtime(python, root);
    const result = await runProbe(deps, request, [claim], new AbortController().signal);
    expect(result.outcome).toBe("inconclusive");
    expect(executeCommand).not.toHaveBeenCalled();
    expect(await readFile(join(root, ".fs-bench/probe-run-1/runtime-error.txt"), "utf8"))
      .toContain("DESTRUCTIVE_REQUIRES_GRANT");
  });

  it("limits the device handle to the exact requested claim set", async () => {
    const root = await worktree();
    const python = await fixtureBridge(`
const response = await request({ type: "gdb", id: 1, deviceId: "probe-rs:other", command: "-thread-info", args: [] });
console.log(JSON.stringify({ type: "error", message: response.error }));
`);
    const { deps, executeCommand } = await runtime(python, root);
    const result = await runProbe(deps, request, [claim], new AbortController().signal);
    expect(result.outcome).toBe("inconclusive");
    expect(executeCommand).not.toHaveBeenCalled();
    expect(await readFile(join(root, ".fs-bench/probe-run-1/runtime-error.txt"), "utf8"))
      .toContain("DEVICE_SCOPE_VIOLATION");
  });

  it("kills a timed-out subprocess and persists inconclusive with an error artifact", async () => {
    const root = await worktree();
    const python = await fixtureBridge("setInterval(() => {}, 1000);");
    const { deps } = await runtime(python, root);
    const result = await runProbe(deps, { ...request, timeoutMs: 100 }, [claim], new AbortController().signal);
    expect(result.outcome).toBe("inconclusive");
    expect(await readFile(join(root, ".fs-bench/probe-run-1/runtime-error.txt"), "utf8")).toContain("PROBE_TIMEOUT");
  }, 10_000);

  it("records a script exception as inconclusive with captured diagnostics", async () => {
    const root = await worktree();
    const python = await fixtureBridge('console.log(JSON.stringify({ type: "error", message: "fixture exploded", traceback: "line 7" }));');
    const { deps } = await runtime(python, root);
    const result = await runProbe(deps, request, [claim], new AbortController().signal);
    expect(result.outcome).toBe("inconclusive");
    expect(await readFile(join(root, ".fs-bench/probe-run-1/runtime-error.txt"), "utf8")).toContain("fixture exploded");
  });

  it("reports missing Python as needsConfiguration before device I/O and still closes the run", async () => {
    const root = await worktree();
    const { deps, releaseClaim } = await runtime("/definitely/missing/python3", root);
    await expect(runProbe(deps, request, [claim], new AbortController().signal)).rejects.toMatchObject({
      name: "NeedsConfigurationError",
      tool: "python3",
      needsConfiguration: true,
    });
    expect(deps.openSession).not.toHaveBeenCalled();
    expect(releaseClaim).toHaveBeenCalledOnce();
    expect(deps.db.prepare("SELECT outcome, finished_at FROM probe_run").get()).toMatchObject({
      outcome: "inconclusive",
      finished_at: expect.any(String),
    });
  });

  it("recognizes every forbidden destructive family", () => {
    expect(isDestructiveGdbCommand("-interpreter-exec", ["console", "monitor reset"])).toBe(true);
    expect(isDestructiveGdbCommand("load", ["firmware.elf"])).toBe(true);
    expect(isDestructiveGdbCommand("monitor", ["flash", "write_image"])).toBe(true);
    expect(isDestructiveGdbCommand("monitor", ["nrf5", "mass_erase"])).toBe(true);
    expect(isDestructiveGdbCommand("monitor", ["fuse", "write"])).toBe(true);
    expect(isDestructiveGdbCommand("-data-write-memory-bytes", ["0x2000", "00"])).toBe(true);
    expect(isDestructiveGdbCommand("-data-read-memory-bytes", ["0x2000", "16"])).toBe(false);
  });
});
