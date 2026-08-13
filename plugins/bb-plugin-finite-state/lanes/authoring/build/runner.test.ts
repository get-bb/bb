import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
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

  it("fails a successful command whose configured primary artifact is absent", async () => {
    const fx = await fixture({ buildScript: "echo done", primaryArtifact: "build/missing.bin" });
    await expect(runBuild(fx.ctx, {})).rejects.toMatchObject({
      code: "BUILD_ARTIFACT_INVALID",
      run: { status: "failed", digest: null },
    });
  });
});
