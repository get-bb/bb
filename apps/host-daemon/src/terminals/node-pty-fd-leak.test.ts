import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { spawn } from "node-pty";
import { describe, expect, it, vi } from "vitest";
import { ensureNodePtySpawnHelpersExecutableInPackage } from "./terminal-manager.js";

const require = createRequire(import.meta.url);

function countPtmxFds(): number {
  const output = execFileSync("lsof", ["-n", "-p", String(process.pid)], {
    encoding: "utf8",
  });
  return output.split("\n").filter((line) => line.includes("/dev/ptmx")).length;
}

describe.runIf(process.platform === "darwin")("node-pty fd lifecycle", () => {
  it("releases the pty master fd after the child exits", async () => {
    ensureNodePtySpawnHelpersExecutableInPackage({
      logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
      packageDirectory: path.dirname(require.resolve("node-pty/package.json")),
    });
    const before = countPtmxFds();
    for (let i = 0; i < 5; i += 1) {
      await new Promise<void>((resolve) => {
        const pty = spawn("/bin/sh", ["-c", "exit 0"], {
          cols: 80,
          cwd: os.tmpdir(),
          env: { PATH: "/usr/bin:/bin" },
          name: "xterm-256color",
          rows: 24,
        });
        pty.onData(() => {});
        pty.onExit(() => resolve());
      });
    }
    const deadline = Date.now() + 5_000;
    let after = countPtmxFds();
    while (after > before && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      after = countPtmxFds();
    }
    expect(after).toBeLessThanOrEqual(before);
  });
});
