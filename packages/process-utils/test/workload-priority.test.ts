import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { getPriority, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AGENT_WORKLOAD_NICE,
  agentCpuPriorityFilePath,
  deprioritizeAgentWorkload,
  readAgentCpuPriority,
  setAgentWorkloadsLowered,
  spawnManagedProcess,
  writeAgentCpuPriority,
} from "../src/index.js";

const scratchDirs: string[] = [];

afterEach(() => {
  setAgentWorkloadsLowered(false);
  for (const dir of scratchDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function scratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "bb-agent-cpu-priority-"));
  scratchDirs.push(dir);
  return dir;
}

function spawnIdleChild(): ReturnType<typeof spawnManagedProcess> {
  return spawnManagedProcess({
    command: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000)"],
  });
}

describe("deprioritizeAgentWorkload", () => {
  it("lowers a running process so the processes it starts later inherit the priority", async () => {
    setAgentWorkloadsLowered(true);
    const { child, stop } = spawnManagedProcess({
      command: process.execPath,
      args: [
        "-e",
        `process.stdin.once("data", () => {
           const { execFileSync } = require("node:child_process");
           process.stdout.write(execFileSync(process.execPath, ["-e", "process.stdout.write(String(require('node:os').getPriority()))"]));
           process.exit(0);
         });`,
      ],
    });
    try {
      deprioritizeAgentWorkload(child.pid);
      expect(getPriority(child.pid)).toBe(AGENT_WORKLOAD_NICE);
      let output = "";
      child.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString();
      });
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.stdin.write("go\n");
      await exited;
      expect(Number(output)).toBe(AGENT_WORKLOAD_NICE);
    } finally {
      await stop();
    }
  });

  it("leaves processes at their inherited priority until lowering is turned on", async () => {
    const inherited = getPriority();
    const { child, stop } = spawnIdleChild();
    try {
      deprioritizeAgentWorkload(child.pid);
      expect(getPriority(child.pid)).toBe(inherited);
      setAgentWorkloadsLowered(true);
      setAgentWorkloadsLowered(false);
      deprioritizeAgentWorkload(child.pid);
      expect(getPriority(child.pid)).toBe(inherited);
    } finally {
      await stop();
    }
  });

  it("ignores a process that has already exited", async () => {
    setAgentWorkloadsLowered(true);
    const { child } = spawnManagedProcess({
      command: process.execPath,
      args: ["-e", "process.exit(0)"],
    });
    await new Promise((resolve) => child.once("exit", resolve));
    expect(() => deprioritizeAgentWorkload(child.pid)).not.toThrow();
  });
});

describe("agent CPU priority file", () => {
  it("round-trips the last written value", () => {
    const dataDir = scratchDir();
    writeAgentCpuPriority(dataDir, true);
    expect(readAgentCpuPriority(dataDir)).toBe(true);
    writeAgentCpuPriority(dataDir, false);
    expect(readAgentCpuPriority(dataDir)).toBe(false);
  });

  it.each([
    ["missing", null],
    ["garbled", "{not json"],
    ["a non-boolean value", JSON.stringify({ enabled: "true" })],
    ["an unexpected shape", JSON.stringify([true])],
  ])("falls back to off when the file is %s", (_label, contents) => {
    const dataDir = scratchDir();
    if (contents !== null) {
      writeFileSync(agentCpuPriorityFilePath(dataDir), contents);
    }
    expect(readAgentCpuPriority(dataDir)).toBe(false);
  });

  it("does not throw when the data directory cannot be written", () => {
    const missingDir = join(scratchDir(), "missing");
    expect(() => writeAgentCpuPriority(missingDir, true)).not.toThrow();
    expect(readAgentCpuPriority(missingDir)).toBe(false);
  });
});
