import { afterEach, expect, it } from "vitest";
import { runCommand } from "../src/app-update/run-command.js";

const runningPids = new Set<number>();

afterEach(() => {
  for (const pid of runningPids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "ESRCH")
      ) {
        throw error;
      }
    }
  }
  runningPids.clear();
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
        const pid = Number(line);
        expect(Number.isInteger(pid)).toBe(true);
        runningPids.add(pid);
        controller.abort();
      },
      signal: controller.signal,
    });
    runningPids.clear();

    expect(result.code).toBeNull();
    expect(result.signal).toBe("SIGKILL");
    expect(result.outputTail).toContain("Cancelled");
  },
);
