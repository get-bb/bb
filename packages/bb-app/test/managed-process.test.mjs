import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createManagedProcessStop } from "../scripts/managed-process.mjs";

const describeProcessGroups =
  process.platform === "win32" ? describe.skip : describe;

describeProcessGroups("managed process cleanup", () => {
  it("waits for descendants after the process-group leader exits", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "bb-managed-process-test-"));
    const markerPath = join(tempRoot, "descendant-finished");
    const descendantScript = [
      'const { writeFileSync } = require("node:fs");',
      `const markerPath = ${JSON.stringify(markerPath)};`,
      'process.on("SIGINT", () => {',
      "  setTimeout(() => {",
      '    writeFileSync(markerPath, "finished");',
      "    process.exit(0);",
      "  }, 200);",
      "});",
      'process.stdout.write("ready\\n");',
      "setInterval(() => {}, 1_000);",
    ].join("\n");
    const leaderScript = [
      'const { spawn } = require("node:child_process");',
      `const child = spawn(process.execPath, ["-e", ${JSON.stringify(descendantScript)}], { stdio: ["ignore", "pipe", "inherit"] });`,
      "child.stdout.pipe(process.stdout);",
      "setInterval(() => {}, 1_000);",
    ].join("\n");
    const leader = spawn(process.execPath, ["-e", leaderScript], {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    leader.stderr.resume();

    try {
      await new Promise((resolvePromise, reject) => {
        leader.once("error", reject);
        leader.stdout.once("data", resolvePromise);
      });
      const stopManagedProcess = createManagedProcessStop(2_000);
      await stopManagedProcess({ childProcess: leader, detached: true });
      await expect(readFile(markerPath, "utf8")).resolves.toBe("finished");
    } finally {
      try {
        process.kill(-leader.pid, "SIGKILL");
      } catch (error) {
        if (
          !(
            error instanceof Error &&
            "code" in error &&
            (error.code === "ESRCH" || error.code === "EPERM")
          )
        ) {
          throw error;
        }
      }
      await rm(tempRoot, { force: true, recursive: true });
    }
  });
});
