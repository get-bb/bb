import { describe, expect, it } from "vitest";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { selectCandidates, type RetentionThread } from "./policy.js";
import plugin from "./server.js";

const DAY = 86400000;
const NOW = 100 * DAY;
function thread(
  id: string,
  overrides: Partial<RetentionThread> = {},
): RetentionThread {
  return {
    id,
    updatedAt: DAY,
    archivedAt: null,
    pinnedAt: null,
    deletedAt: null,
    parentThreadId: null,
    lifecycleOwnerThreadId: null,
    sourceThreadId: null,
    visibility: "visible",
    environmentId: "env_test",
    status: "idle",
    ...overrides,
  };
}

describe("retention eligibility", () => {
  it("keeps a whole archive group when a child, hidden source, or lifecycle dependent is recent or pinned", () => {
    for (const relationship of [
      "parentThreadId",
      "sourceThreadId",
      "lifecycleOwnerThreadId",
    ] as const) {
      for (const exemption of [{ updatedAt: NOW }, { pinnedAt: DAY }]) {
        const result = selectCandidates(
          [
            thread("root"),
            thread("child", {
              [relationship]: "root",
              visibility: "hidden",
              ...exemption,
            }),
            thread("independent"),
          ],
          { archiveAfterDays: 30, deleteAfterDays: null },
          NOW,
        );
        expect(result.archive.map((group) => group.rootId)).toEqual([
          "independent",
        ]);
      }
    }
  });
  it("deletes only fully old archived lifecycle groups, while ordinary children have independent deletion lifetimes", () => {
    const result = selectCandidates(
      [
        thread("live-dependent-root", { archivedAt: DAY }),
        thread("live-dependent", {
          lifecycleOwnerThreadId: "live-dependent-root",
        }),
        thread("recent-dependent-root", { archivedAt: DAY }),
        thread("recent-dependent", {
          lifecycleOwnerThreadId: "recent-dependent-root",
          archivedAt: NOW - DAY,
        }),
        thread("eligible", { archivedAt: DAY }),
        thread("ordinary-child", { parentThreadId: "eligible" }),
        thread("owned", {
          lifecycleOwnerThreadId: "eligible",
          archivedAt: DAY,
        }),
        thread("pinned", { archivedAt: DAY, pinnedAt: DAY }),
      ],
      { archiveAfterDays: null, deleteAfterDays: 30 },
      NOW,
    );
    expect(
      result.delete.map((group) => ({
        root: group.rootId,
        members: group.memberIds,
      })),
    ).toEqual([{ root: "eligible", members: ["eligible", "owned"] }]);
  });
  it("does not archive provisioning threads or count shared descendants twice in a group", () => {
    const result = selectCandidates(
      [
        thread("provisioning", { environmentId: null, status: "starting" }),
        thread("root"),
        thread("child", {
          parentThreadId: "root",
          lifecycleOwnerThreadId: "root",
        }),
        thread("deleted", { deletedAt: DAY }),
      ],
      { archiveAfterDays: 30, deleteAfterDays: null },
      NOW,
    );
    expect(result.archive.map((group) => group.memberIds)).toEqual([
      ["root", "child"],
    ]);
  });
});

describe("retention plugin", () => {
  it("defaults to Never, previews without mutation, and requires CLI confirmation", async () => {
    const host = createFakePluginHost({
      pluginId: "storage-retention",
      sdk: {
        threads: {
          list: async () => [
            makeThreadResponse({ id: "thr_old", updatedAt: 1 }),
          ],
          archive: async ({ threadId }) => ({ archivedThreadIds: [threadId] }),
        },
      },
    });
    try {
      plugin(host.bb);
      await host.harness.runSchedule("retention");
      expect(host.harness.sdk.callsTo("threads.list")).toHaveLength(0);
      const preview = await host.harness.callRpc("preview", {
        archiveAfterDays: 30,
        deleteAfterDays: null,
      });
      expect(preview).toEqual({ archiveCount: 1, deleteCount: 0 });
      expect(host.harness.sdk.callsTo("threads.archive")).toHaveLength(0);
      const refused = await host.harness.runCli([
        "retention",
        "--archive-after",
        "30",
        "--save",
      ]);
      expect(refused.exitCode).toBe(1);
      const saved = await host.harness.runCli([
        "retention",
        "--archive-after",
        "30",
        "--save",
        "--yes",
      ]);
      expect(saved.exitCode).toBe(0);
      await host.harness.runSchedule("retention");
      expect(host.harness.sdk.callsTo("threads.archive")).toHaveLength(1);
      expect(await host.harness.callRpc("state", null)).toMatchObject({
        policy: { archiveAfterDays: 30, deleteAfterDays: null },
        lastRun: { archivedCount: 1 },
      });
    } finally {
      await host.harness.dispose();
    }
  });
  it("reads beyond one page before acting and bounds each hourly action while continuing past failures", async () => {
    const rows = Array.from({ length: 501 }, (_, i) =>
      makeThreadResponse({
        id: `thr_${String(i).padStart(3, "0")}`,
        updatedAt: 1,
      }),
    );
    rows[500] = makeThreadResponse({
      id: "thr_recent_child",
      parentThreadId: "thr_000",
      updatedAt: Date.now(),
    });
    const host = createFakePluginHost({
      pluginId: "storage-retention",
      sdk: {
        threads: {
          list: async ({ offset = 0, limit = 500 } = {}) =>
            rows.slice(offset, offset + limit),
          archive: async ({ threadId }) => {
            if (threadId === "thr_001") throw new Error("offline");
            return { archivedThreadIds: ["thr_archived"] };
          },
        },
      },
    });
    try {
      plugin(host.bb);
      await host.harness.callRpc("configure", {
        archiveAfterDays: 30,
        deleteAfterDays: null,
      });
      await host.harness.runSchedule("retention");
      expect(host.harness.sdk.callsTo("threads.archive")).toHaveLength(50);
      expect(
        host.harness.sdk.callsTo("threads.archive").flat(),
      ).not.toContainEqual({ threadId: "thr_000" });
      expect(await host.harness.callRpc("state", null)).toMatchObject({
        lastRun: { archivedCount: 49, failedCount: 1 },
      });
    } finally {
      await host.harness.dispose();
    }
  });
  it("runs deletion through the SDK and persists its run summary", async () => {
    const host = createFakePluginHost({
      pluginId: "storage-retention",
      sdk: {
        threads: {
          list: async () => [
            makeThreadResponse({ id: "thr_old", archivedAt: 1 }),
            makeThreadResponse({
              id: "thr_owned",
              lifecycleOwnerThreadId: "thr_old",
              archivedAt: 1,
            }),
            makeThreadResponse({ id: "thr_keep", archivedAt: 1, pinnedAt: 1 }),
          ],
          delete: async () => ({ ok: true }),
        },
      },
    });
    try {
      plugin(host.bb);
      await host.harness.callRpc("configure", {
        archiveAfterDays: null,
        deleteAfterDays: 30,
      });
      await host.harness.runSchedule("retention");
      expect(host.harness.sdk.callsTo("threads.delete")).toEqual([
        [{ threadId: "thr_old", childThreadsConfirmed: true }],
      ]);
      expect(await host.harness.callRpc("state", null)).toMatchObject({
        lastRun: { deletedCount: 2, archivedCount: 0, failedCount: 0 },
      });
    } finally {
      await host.harness.dispose();
    }
  });

  it("stops a running batch after the plugin is disposed", async () => {
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const host = createFakePluginHost({
      pluginId: "storage-retention",
      sdk: {
        threads: {
          list: async () => [
            makeThreadResponse({ id: "thr_a", updatedAt: 1 }),
            makeThreadResponse({ id: "thr_b", updatedAt: 1 }),
          ],
          archive: async () => {
            entered();
            await blocked;
            return { archivedThreadIds: ["thr_archived"] };
          },
        },
      },
    });
    plugin(host.bb);
    await host.harness.callRpc("configure", {
      archiveAfterDays: 30,
      deleteAfterDays: null,
    });
    const run = host.harness.runSchedule("retention");
    await started;
    await host.harness.dispose();
    release();
    await run;
    expect(host.harness.sdk.callsTo("threads.archive")).toHaveLength(1);
  });
});
