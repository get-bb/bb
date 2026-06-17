import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { buildInheritedScriptEnv, runScriptProcess } from "./run-script.js";

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

  it("enforces the byte cap while streaming many chunks (drops excess)", async () => {
    // Emit ~5 MiB across many separate writes (one per line). The cap must hold
    // regardless of how much was streamed, proving excess is dropped as chunks
    // arrive rather than buffered then trimmed on close.
    const result = await runScriptProcess({
      command: "bash",
      args: [
        "-c",
        "for i in $(seq 1 5000); do printf '%01024d\\n' 0; done",
      ],
      cwd: os.tmpdir(),
      env: { PATH: process.env.PATH ?? "" },
      timeoutMs: 10_000,
    });

    expect(result.timedOut).toBe(false);
    expect(result.output).toContain("[output truncated]");
    // Capped output is the 64 KiB head + the short truncation marker, never the
    // full ~5 MiB stream.
    expect(Buffer.byteLength(result.output, "utf8")).toBeLessThan(70_000);
  });

  it("inherits the daemon PATH under the server-provided command env", () => {
    const env = buildInheritedScriptEnv({
      BB_SERVER_URL: "http://127.0.0.1:38886",
      BB_AUTOMATION_ID: "auto_test",
    });
    // The daemon's own PATH (for resolving `bb`/`node`) is the base.
    expect(env.PATH).toBe(process.env.PATH);
    // Server-injected vars are present and win on conflict.
    expect(env.BB_SERVER_URL).toBe("http://127.0.0.1:38886");
    expect(env.BB_AUTOMATION_ID).toBe("auto_test");
  });

  it("lets command env override an inherited value", () => {
    const key = "BB_RUN_SCRIPT_TEST_OVERRIDE";
    process.env[key] = "from-daemon";
    try {
      const env = buildInheritedScriptEnv({ [key]: "from-server" });
      expect(env[key]).toBe("from-server");
    } finally {
      delete process.env[key];
    }
  });

  it("kills descendant processes on timeout (process group)", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bb-run-script-pg-"));
    const marker = path.join(dir, "child-alive");
    try {
      // Parent spawns a background child that, after the parent's timeout, would
      // create a marker file unless the whole process group is killed.
      const result = await runScriptProcess({
        command: "bash",
        args: [
          "-c",
          `( sleep 2; touch "${marker}" ) & echo started; sleep 5`,
        ],
        cwd: dir,
        env: { PATH: process.env.PATH ?? "" },
        timeoutMs: 200,
      });

      expect(result.timedOut).toBe(true);
      // Wait past the child's would-be write window; the group kill should have
      // reaped it, so the marker must never appear.
      await new Promise((resolve) => setTimeout(resolve, 2500));
      await expect(fs.access(marker)).rejects.toThrow();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
