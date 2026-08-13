import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runBuild, runBuildAction } from "./runner.js";
import { createFixture, type AuthoringFixture } from "./test-fixture.js";

const fixtures: AuthoringFixture[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
});

async function fixture(input: Parameters<typeof createFixture>[0] = {}) {
  const value = await createFixture(input);
  fixtures.push(value);
  return value;
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForFile(path: string): Promise<string> {
  const deadline = Date.now() + 2_000;
  while (true) {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
}

describe("build runner", () => {
  it("runs in the verified root, persists complete logs, and hashes the primary artifact bytes", async () => {
    const fx = await fixture({
      buildScript: "/bin/mkdir -p build; printf 'subject-bytes' > build/app.bin; echo stdout-one; echo stderr-two >&2",
    });
    const run = await runBuild(fx.ctx, { target: "fixture-target" });
    expect(run.status).toBe("succeeded");
    expect(run.artifact).toBe("build/app.bin");
    expect(run.digest).toBe(createHash("sha256").update("subject-bytes").digest("hex"));
    const log = await readFile(run.logPath, "utf8");
    expect(log).toContain("stdout-one");
    expect(log).toContain("stderr-two");
  });

  it("stores failure and shapes only the first file/line diagnostic", async () => {
    const fx = await fixture({
      buildScript: "echo 'src/main.c:42:7: error: broken register' >&2; echo 'huge log line'; exit 2",
    });
    const result = await runBuildAction(fx.ctx, {});
    expect(result).toMatchObject({
      status: "failed",
      digest: null,
      diagnostic: "src/main.c:42:7: error: broken register",
    });
    expect(result.runId).toMatch(/^build-/u);
    expect(JSON.stringify(result)).not.toContain("huge log line");
  });

  it("times out and cancels hanging process groups coherently", async () => {
    const timed = await fixture({ buildScript: "/bin/sleep 10", buildTimeoutMs: 150 });
    await expect(runBuild(timed.ctx, {})).rejects.toMatchObject({
      code: "BUILD_FAILED",
      run: { status: "failed" },
    });

    const cancelled = await fixture({ buildScript: "/bin/sleep 10", buildTimeoutMs: 5_000 });
    setTimeout(() => cancelled.controller.abort(), 100);
    await expect(runBuild(cancelled.ctx, {})).rejects.toMatchObject({
      code: "BUILD_CANCELLED",
      run: { status: "cancelled" },
    });
  });

  it("kills a spawned grandchild when cancellation terminates the process group", async () => {
    const fx = await fixture({
      buildScript: "/bin/sleep 30 & echo $! > grandchild.pid; wait",
      buildTimeoutMs: 5_000,
    });
    const pending = runBuild(fx.ctx, {});
    const pid = Number((await waitForFile(join(fx.root, "grandchild.pid"))).trim());
    expect(Number.isInteger(pid)).toBe(true);
    expect(processExists(pid)).toBe(true);
    fx.controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "BUILD_CANCELLED" });
    await eventuallyDead(pid);
  });

  it("terminalizes a queued row when verified-root validation fails before spawn", async () => {
    const fx = await fixture();
    fx.ctx.execution.worktreeRoot = join(fx.root, "missing-worktree");
    const result = await runBuildAction(fx.ctx, {});
    expect(result).toMatchObject({ status: "failed", digest: null });
    const rows = fx.ctx.db
      .prepare<[], { status: string }>("SELECT status FROM build_run")
      .all();
    expect(rows).toEqual([{ status: "failed" }]);
  });

  it("does not expose configured argv values in the served run log", async () => {
    const fx = await fixture();
    fx.ctx.resolveBuildPlan = async () => ({
      command: ["fixture-build", "sensitive-probe-serial"],
      toolchain: "fixture-build",
      primaryArtifact: "build/app.bin",
      timeoutMs: 10_000,
      env: {},
    });
    const run = await runBuild(fx.ctx, {});
    expect(await readFile(run.logPath, "utf8")).not.toContain("sensitive-probe-serial");
  });

  it("converts a project-level domain scope once at the execution boundary", async () => {
    const fx = await fixture();
    fx.ctx.projectVersionId = null;
    const run = await runBuild(fx.ctx, {});
    const stored = fx.ctx.db
      .prepare<[string], { project_version_id: string }>(
        "SELECT project_version_id FROM build_run WHERE run_id = ?",
      )
      .get(run.runId);
    expect(stored?.project_version_id).toBe("@project");
  });

  it("fails a successful command whose configured primary artifact is absent", async () => {
    const fx = await fixture({ buildScript: "echo done", primaryArtifact: "build/missing.bin" });
    await expect(runBuild(fx.ctx, {})).rejects.toMatchObject({
      code: "BUILD_ARTIFACT_INVALID",
      run: { status: "failed", digest: null },
    });
  });
});

async function eventuallyDead(pid: number): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (processExists(pid)) {
    if (Date.now() >= deadline) throw new Error(`grandchild ${pid} survived cancellation`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
