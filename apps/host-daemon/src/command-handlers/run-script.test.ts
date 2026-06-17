import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { runScriptProcess } from "./run-script.js";

describe("runScriptProcess", () => {
  it("captures stdout and stderr and returns exit code 0", async () => {
    const result = await runScriptProcess({
      command: "bash",
      args: ["-c", "echo out; echo err 1>&2"],
      cwd: os.tmpdir(),
      env: { PATH: process.env.PATH ?? "" },
      timeoutMs: 5_000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.output).toContain("out");
    expect(result.output).toContain("err");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("returns the non-zero exit code without throwing", async () => {
    const result = await runScriptProcess({
      command: "bash",
      args: ["-c", "echo boom; exit 3"],
      cwd: os.tmpdir(),
      env: { PATH: process.env.PATH ?? "" },
      timeoutMs: 5_000,
    });

    expect(result.exitCode).toBe(3);
    expect(result.timedOut).toBe(false);
    expect(result.output).toContain("boom");
  });

  it("honors cwd and injected env", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bb-run-script-"));
    try {
      const result = await runScriptProcess({
        command: "bash",
        args: ["-c", 'echo "$PWD:$BB_AUTOMATION_ID"'],
        cwd: dir,
        env: { PATH: process.env.PATH ?? "", BB_AUTOMATION_ID: "auto_test" },
        timeoutMs: 5_000,
      });

      expect(result.exitCode).toBe(0);
      // macOS resolves /var -> /private/var; assert the trailing dir + env var.
      expect(result.output).toContain(path.basename(dir));
      expect(result.output).toContain("auto_test");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("SIGKILLs and marks timedOut on overrun", async () => {
    const result = await runScriptProcess({
      command: "bash",
      args: ["-c", "sleep 5; echo done"],
      cwd: os.tmpdir(),
      env: { PATH: process.env.PATH ?? "" },
      timeoutMs: 100,
    });

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
    expect(result.output).not.toContain("done");
  });

  it("caps and marks truncated output", async () => {
    const result = await runScriptProcess({
      command: "bash",
      // Emit well over the 64 KiB cap.
      args: ["-c", "head -c 200000 /dev/zero | tr '\\0' 'a'"],
      cwd: os.tmpdir(),
      env: { PATH: process.env.PATH ?? "" },
      timeoutMs: 5_000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("[output truncated]");
    expect(Buffer.byteLength(result.output, "utf8")).toBeLessThan(70_000);
  });
});
