import {
  trackChildProcesses,
  type ChildProcessTracker,
} from "@bb/test-helpers";
import { afterEach, beforeEach, expect, it } from "vitest";
import { runCommand } from "../src/app-update/run-command.js";

let children: ChildProcessTracker;

beforeEach(() => {
  children = trackChildProcesses();
});

afterEach(async () => {
  children.dispose();
  children.killRunning();
  await children.waitForExit();
});

it.skipIf(process.platform === "win32")(
  "finishes cancellation when the command ignores SIGTERM",
  async () => {
    const controller = new AbortController();
    const result = await runCommand({
      args: [
        "-e",
        "process.on('SIGTERM', () => {}); console.log(process.pid); setInterval(() => {}, 1000);",
      ],
      command: process.execPath,
      cwd: process.cwd(),
      onLine: (line) => {
        expect(Number.isInteger(Number(line))).toBe(true);
        controller.abort();
      },
      signal: controller.signal,
    });

    expect(result.code).toBeNull();
    expect(result.signal).toBe("SIGKILL");
    expect(result.outputTail).toContain("Cancelled");
  },
);
