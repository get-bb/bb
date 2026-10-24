import { getPriority } from "node:os";
import { describe, expect, it } from "vitest";
import {
  AGENT_WORKLOAD_NICE,
  deprioritizeAgentWorkload,
  spawnManagedProcess,
} from "../src/index.js";

describe("deprioritizeAgentWorkload", () => {
  it("lowers a running process so the processes it starts later inherit the priority", async () => {
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

  it("ignores a process that has already exited", async () => {
    const { child } = spawnManagedProcess({
      command: process.execPath,
      args: ["-e", "process.exit(0)"],
    });
    await new Promise((resolve) => child.once("exit", resolve));
    expect(() => deprioritizeAgentWorkload(child.pid)).not.toThrow();
  });
});
