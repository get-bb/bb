import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openStore } from "../../../lib/store/index.js";
import {
  createBuildRun,
  getBuildRun,
  listBuildRuns,
  recoverOrphanedBuildRuns,
  transitionBuildRun,
  type BuildRunChangedHint,
} from "./runs-store.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function fixture() {
  const host = createFakePluginHost({ pluginId: `fs-runs-${crypto.randomUUID()}` });
  const db = openStore(host.bb).db;
  const directory = await mkdtemp(join(tmpdir(), "fs-runs-"));
  const hints: BuildRunChangedHint[] = [];
  const store = { db, publish: (hint: BuildRunChangedHint) => hints.push(hint) };
  cleanups.push(async () => {
    await host.harness.lifecycle.dispose();
    await rm(directory, { recursive: true, force: true });
  });
  return { host, db, directory, hints, store };
}

async function insertRun(
  fx: Awaited<ReturnType<typeof fixture>>,
  input: { runId: string; kind?: "build" | "flash"; startedAt: string },
) {
  const logPath = join(fx.directory, `${input.runId}.log`);
  await writeFile(logPath, "evidence\n", "utf8");
  return await createBuildRun(fx.store, {
    projectId: "project-a",
    projectVersionId: "version-a",
    runId: input.runId,
    kind: input.kind ?? "build",
    target: null,
    toolchain: "fixture",
    artifact: null,
    digest: null,
    logPath,
    startedAt: input.startedAt,
  });
}

describe("build run store", () => {
  it("enforces transactional transitions and immutable historical digests", async () => {
    const fx = await fixture();
    await insertRun(fx, { runId: "run-a", startedAt: "2026-08-13T01:00:00.000Z" });
    await transitionBuildRun(fx.store, { projectId: "project-a", projectVersionId: "version-a" }, "run-a", "running", {
      artifact: null,
      digest: null,
    });
    const digest = "a".repeat(64);
    const succeeded = await transitionBuildRun(
      fx.store,
      { projectId: "project-a", projectVersionId: "version-a" },
      "run-a",
      "succeeded",
      { artifact: "build/app.bin", digest },
    );
    expect(succeeded.digest).toBe(digest);
    await expect(
      transitionBuildRun(
        fx.store,
        { projectId: "project-a", projectVersionId: "version-a" },
        "run-a",
        "succeeded",
        { artifact: "build/new.bin", digest: "b".repeat(64) },
      ),
    ).rejects.toThrow(/transition|immutable/u);
    expect(
      getBuildRun(fx.db, { projectId: "project-a", projectVersionId: "version-a" }, "run-a")?.digest,
    ).toBe(digest);
    expect(fx.hints.at(-1)).toMatchObject({ runId: "run-a", status: "succeeded" });
  });

  it("recovers persisted running rows as failed and preserves prior log evidence", async () => {
    const fx = await fixture();
    const queued = await insertRun(fx, { runId: "orphan", startedAt: "2026-08-13T02:00:00.000Z" });
    await transitionBuildRun(fx.store, { projectId: "project-a", projectVersionId: "version-a" }, queued.runId, "running", {
      artifact: null,
      digest: null,
    });
    expect(await recoverOrphanedBuildRuns(fx.store)).toBe(1);
    expect(
      getBuildRun(fx.db, { projectId: "project-a", projectVersionId: "version-a" }, queued.runId)?.status,
    ).toBe("failed");
    expect(await readFile(queued.logPath, "utf8")).toContain("evidence\n\n[finite-state] orphaned:");
  });

  it("pages newest first with kind/status filters and stable cursors", async () => {
    const fx = await fixture();
    await mkdir(fx.directory, { recursive: true });
    const first = await insertRun(fx, { runId: "build-old", startedAt: "2026-08-13T01:00:00.000Z" });
    await insertRun(fx, { runId: "flash-new", kind: "flash", startedAt: "2026-08-13T03:00:00.000Z" });
    await insertRun(fx, { runId: "build-new", startedAt: "2026-08-13T02:00:00.000Z" });
    await transitionBuildRun(fx.store, { projectId: "project-a", projectVersionId: "version-a" }, first.runId, "cancelled", {
      artifact: null,
      digest: null,
    });
    const query = {
      projectId: "project-a",
      projectVersionId: "version-a",
      pageSize: 1,
      kinds: ["build"] as const,
      statuses: [] as const,
    };
    const pageOne = listBuildRuns(fx.db, { ...query, cursor: null });
    expect(pageOne.items.map((run) => run.runId)).toEqual(["build-new"]);
    expect(pageOne.total).toBe(2);
    expect(pageOne.cursor).not.toBeNull();
    expect(listBuildRuns(fx.db, { ...query, cursor: pageOne.cursor }).items[0]?.runId).toBe("build-old");
    expect(
      listBuildRuns(fx.db, { ...query, cursor: null, statuses: ["cancelled"] }).items.map((run) => run.runId),
    ).toEqual(["build-old"]);
  });
});
