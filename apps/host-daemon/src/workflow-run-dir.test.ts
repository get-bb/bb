import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearWorkflowRunnerPidFile,
  isProcessAlive,
  isWorkflowRunHeartbeatFresh,
  listWorkflowRunIds,
  readWorkflowRunnerPidFile,
  removeWorkflowRunHeartbeat,
  workflowRunDirPath,
  workflowRunHeartbeatPath,
  writeWorkflowRunnerPidFile,
} from "./workflow-run-dir.js";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "bb-wf-run-dir-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("runner pid file", () => {
  it("round-trips and clears", async () => {
    const runDir = await makeTempDir();
    expect(await readWorkflowRunnerPidFile(runDir)).toBeNull();
    await writeWorkflowRunnerPidFile(runDir, 12345);
    expect(await readWorkflowRunnerPidFile(runDir)).toBe(12345);
    await clearWorkflowRunnerPidFile(runDir);
    expect(await readWorkflowRunnerPidFile(runDir)).toBeNull();
    // Clearing an already-missing file is a no-op, not an error.
    await clearWorkflowRunnerPidFile(runDir);
  });

  it("treats malformed pid files as missing", async () => {
    const runDir = await makeTempDir();
    await writeFile(join(runDir, "runner.pid"), "not json");
    expect(await readWorkflowRunnerPidFile(runDir)).toBeNull();
    await writeFile(join(runDir, "runner.pid"), JSON.stringify({ pid: -4 }));
    expect(await readWorkflowRunnerPidFile(runDir)).toBeNull();
  });
});

describe("heartbeat freshness", () => {
  it("is fresh within staleMs of the last touch and stale past it", async () => {
    const runDir = await makeTempDir();
    const heartbeatPath = workflowRunHeartbeatPath(runDir);
    await writeFile(heartbeatPath, String(Date.now()));
    const nowMs = Date.now();
    expect(
      await isWorkflowRunHeartbeatFresh({ runDir, staleMs: 20_000, nowMs }),
    ).toBe(true);

    const past = new Date(nowMs - 60_000);
    await utimes(heartbeatPath, past, past);
    expect(
      await isWorkflowRunHeartbeatFresh({ runDir, staleMs: 20_000, nowMs }),
    ).toBe(false);
  });

  it("is stale when the heartbeat file is missing or removed", async () => {
    const runDir = await makeTempDir();
    expect(
      await isWorkflowRunHeartbeatFresh({
        runDir,
        staleMs: 20_000,
        nowMs: Date.now(),
      }),
    ).toBe(false);
    await writeFile(workflowRunHeartbeatPath(runDir), String(Date.now()));
    await removeWorkflowRunHeartbeat(runDir);
    expect(
      await isWorkflowRunHeartbeatFresh({
        runDir,
        staleMs: 20_000,
        nowMs: Date.now(),
      }),
    ).toBe(false);
  });
});

describe("run dir listing", () => {
  it("returns [] when no run ever started and run dirs otherwise", async () => {
    const dataDir = await makeTempDir();
    expect(await listWorkflowRunIds(dataDir)).toEqual([]);
    await mkdir(workflowRunDirPath(dataDir, "wfr_a"), { recursive: true });
    await mkdir(workflowRunDirPath(dataDir, "wfr_b"), { recursive: true });
    // Stray files in the root are not run dirs.
    await writeFile(join(dataDir, "workflow-runs", "stray.txt"), "x");
    expect((await listWorkflowRunIds(dataDir)).sort()).toEqual([
      "wfr_a",
      "wfr_b",
    ]);
  });
});

describe("isProcessAlive", () => {
  it("sees the current process as alive and an unused pid as dead", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    // Max pid on macOS is 99998 and Linux defaults to 2^15/2^22; an absurdly
    // large pid is structurally unoccupied.
    expect(isProcessAlive(2 ** 30)).toBe(false);
  });
});
