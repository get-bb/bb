import { getPriority } from "node:os";
import { createInterface } from "node:readline";
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
        `const { spawn } = require("node:child_process");
         process.stdin.once("data", () => {
           const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
           process.stdout.write(String(grandchild.pid) + "\\n");
         });
         process.stdout.write("ready\\n");`,
      ],
    });
    try {
      const lines = createInterface({ input: child.stdout })[
        Symbol.asyncIterator
      ]();
      expect((await lines.next()).value).toBe("ready");
      const inheritedPriority = getPriority(child.pid);
      deprioritizeAgentWorkload(child.pid);
      const priority = getPriority(child.pid);
      expect(priority).toBeGreaterThanOrEqual(AGENT_WORKLOAD_NICE);
      expect(priority).toBeLessThanOrEqual(
        Math.max(inheritedPriority, AGENT_WORKLOAD_NICE),
      );
      child.stdin.write("go\n");
      const grandchildPid = Number((await lines.next()).value);
      expect(getPriority(grandchildPid)).toBe(priority);
    } finally {
      await stop();
    }
  }, 15_000);

  it("ignores a process that has already exited", async () => {
    const { child } = spawnManagedProcess({
      command: process.execPath,
      args: ["-e", "process.exit(0)"],
    });
    await new Promise((resolve) => child.once("exit", resolve));
    expect(() => deprioritizeAgentWorkload(child.pid)).not.toThrow();
  });
});
