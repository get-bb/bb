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
           const grandchild = require("node:child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
           process.stdout.write(String(grandchild.pid) + "\\n");
           process.stdin.once("data", () => {
             grandchild.kill();
             process.exit(0);
           });
         });`,
      ],
    });
    try {
      deprioritizeAgentWorkload(child.pid);
      expect(getPriority(child.pid)).toBe(AGENT_WORKLOAD_NICE);
      const grandchildPid = new Promise<number>((resolve) => {
        let output = "";
        child.stdout.on("data", (chunk: Buffer) => {
          output += chunk.toString();
          if (output.includes("\n")) resolve(Number(output.trim()));
        });
      });
      child.stdin.write("go\n");
      expect(getPriority(await grandchildPid)).toBe(AGENT_WORKLOAD_NICE);
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.stdin.write("done\n");
      await exited;
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
