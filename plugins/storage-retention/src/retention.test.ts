import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { selectCandidates, type RetentionThread } from "./policy.js";
import plugin from "./server.js";

const DAY = 86400000;
const NOW = 100 * DAY;
const emptyCascade = async ({
  threadIds,
}: {
  threadIds: readonly string[];
}) => ({
  threads: [{ threadId: threadIds[0], cascadeThreadIds: [] }],
});
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
          experimental_listCascade: emptyCascade,
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
          list: async ({
            offset = 0,
            limit = 500,
            threadIds,
          }: ListArgs = {}) =>
            threadIds === undefined
              ? rows.slice(offset, offset + limit)
              : rows.filter((row) => threadIds.includes(row.id)),
          archive: async ({ threadId }) => {
            if (threadId === "thr_001") throw new Error("offline");
            return { archivedThreadIds: ["thr_archived"] };
          },
          experimental_listCascade: emptyCascade,
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

  it("skips a group that was pinned or unarchived after the sweep selected it", async () => {
    let reads = 0;
    const host = createFakePluginHost({
      pluginId: "storage-retention",
      sdk: {
        threads: {
          list: async () => {
            reads++;
            return [
              makeThreadResponse({
                id: "thr_pinned",
                archivedAt: 1,
                pinnedAt: reads > 1 ? Date.now() : null,
              }),
              makeThreadResponse({
                id: "thr_unarchived",
                archivedAt: reads > 1 ? null : 1,
              }),
              makeThreadResponse({ id: "thr_old", archivedAt: 1 }),
            ];
          },
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
        lastRun: { deletedCount: 1, failedCount: 0 },
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
          experimental_listCascade: emptyCascade,
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

type Row = ReturnType<typeof makeThreadResponse>;
type ListArgs = NonNullable<
  Parameters<BbPluginApi["sdk"]["threads"]["list"]>[0]
>;
interface Scenario {
  full: Row[] | ((read: number) => Row[]);
  byId?: () => Row[];
  cascade?: (rootId: string) => string[];
  onFull?: (read: number) => void | Promise<void>;
  onById?: (call: number) => void | Promise<void>;
  onCascade?: (call: number) => void | Promise<void>;
}
const ARCHIVE_POLICY = { archiveAfterDays: 30, deleteAfterDays: null };
const DELETE_POLICY = { archiveAfterDays: null, deleteAfterDays: 30 };
const CLOCK_START = Date.UTC(2026, 10, 9, 12);
const stale = (id: string, overrides: Partial<Row> = {}) =>
  makeThreadResponse({ id, updatedAt: 1, ...overrides });
const archived = (id: string, overrides: Partial<Row> = {}) =>
  makeThreadResponse({ id, archivedAt: 1, ...overrides });
const advance = (ms: number) => vi.setSystemTime(Date.now() + ms);
const threadIdOf = ([args]: unknown[]) =>
  (args as { threadId: string }).threadId;

function scenarioHost(scenario: Scenario) {
  const calls = { fullReads: 0, byId: [] as string[][], cascades: 0 };
  let latest: Row[] = [];
  const host = createFakePluginHost({
    pluginId: "storage-retention",
    sdk: {
      threads: {
        list: async (args: ListArgs = {}) => {
          if (args.threadIds === undefined) {
            const offset = args.offset ?? 0;
            if (offset === 0) calls.fullReads++;
            await scenario.onFull?.(calls.fullReads);
            latest =
              typeof scenario.full === "function"
                ? scenario.full(calls.fullReads)
                : scenario.full;
            return latest.slice(offset, offset + (args.limit ?? 500));
          }
          const ids = [...args.threadIds];
          calls.byId.push([...ids].sort());
          await scenario.onById?.(calls.byId.length);
          return (scenario.byId?.() ?? latest).filter((row) =>
            ids.includes(row.id),
          );
        },
        experimental_listCascade: async ({ threadIds }) => {
          calls.cascades++;
          await scenario.onCascade?.(calls.cascades);
          return {
            threads: [
              {
                threadId: threadIds[0],
                cascadeThreadIds: scenario.cascade?.(threadIds[0]) ?? [],
              },
            ],
          };
        },
        archive: async ({ threadId }) => ({ archivedThreadIds: [threadId] }),
        delete: async () => ({ ok: true }),
      },
    },
  });
  return { host, calls };
}

async function runSweep(
  scenario: Scenario,
  policy: { archiveAfterDays: number | null; deleteAfterDays: number | null },
) {
  const { host, calls } = scenarioHost(scenario);
  try {
    plugin(host.bb);
    await host.harness.callRpc("configure", policy);
    await host.harness.runSchedule("retention");
    return {
      calls,
      archives: host.harness.sdk.callsTo("threads.archive").map(threadIdOf),
      deletes: host.harness.sdk.callsTo("threads.delete").map(threadIdOf),
      cascades: host.harness.sdk.callsTo("threads.experimental_listCascade"),
      state: await host.harness.callRpc("state", null),
      logs: host.harness.logEntries.map((entry) => entry.message),
    };
  } finally {
    await host.harness.dispose();
  }
}

describe("retention sweep safety re-check", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(CLOCK_START);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("skips an archive group whose member was pinned after selection when only the by-ID read shows it", async () => {
    const result = await runSweep(
      {
        full: [
          stale("thr_blocked"),
          stale("thr_child", { parentThreadId: "thr_blocked" }),
          stale("thr_other"),
        ],
        byId: () => [
          stale("thr_blocked"),
          stale("thr_child", {
            parentThreadId: "thr_blocked",
            pinnedAt: Date.now(),
          }),
          stale("thr_other"),
        ],
      },
      ARCHIVE_POLICY,
    );
    expect(result.calls.byId).toEqual([
      ["thr_blocked", "thr_child"],
      ["thr_other"],
    ]);
    expect(result.archives).toEqual(["thr_other"]);
    expect(result.cascades).toHaveLength(1);
    expect(result.state).toMatchObject({
      lastRun: { archivedCount: 1, failedCount: 0 },
    });
  });

  it("skips a delete group whose member was pinned after selection when only the by-ID read shows it", async () => {
    const result = await runSweep(
      {
        full: [
          archived("thr_blocked"),
          archived("thr_owned", { lifecycleOwnerThreadId: "thr_blocked" }),
          archived("thr_other"),
        ],
        byId: () => [
          archived("thr_blocked"),
          archived("thr_owned", {
            lifecycleOwnerThreadId: "thr_blocked",
            pinnedAt: 1,
          }),
          archived("thr_other"),
        ],
      },
      DELETE_POLICY,
    );
    expect(result.calls.byId).toEqual([
      ["thr_blocked", "thr_owned"],
      ["thr_other"],
    ]);
    expect(result.deletes).toEqual(["thr_other"]);
    expect(result.cascades).toHaveLength(0);
    expect(result.state).toMatchObject({
      lastRun: { deletedCount: 1, failedCount: 0 },
    });
  });

  it("skips a delete group whose member was unarchived after selection when only the by-ID read shows it", async () => {
    const result = await runSweep(
      {
        full: [
          archived("thr_blocked"),
          archived("thr_owned", { lifecycleOwnerThreadId: "thr_blocked" }),
          archived("thr_other"),
        ],
        byId: () => [
          archived("thr_blocked"),
          archived("thr_owned", {
            lifecycleOwnerThreadId: "thr_blocked",
            archivedAt: null,
          }),
          archived("thr_other"),
        ],
      },
      DELETE_POLICY,
    );
    expect(result.calls.byId).toEqual([
      ["thr_blocked", "thr_owned"],
      ["thr_other"],
    ]);
    expect(result.deletes).toEqual(["thr_other"]);
    expect(result.cascades).toHaveLength(0);
  });

  it("skips a group whose parent became active after selection when only the by-ID read shows it", async () => {
    const result = await runSweep(
      {
        full: [
          stale("thr_parent", { archivedAt: 1 }),
          stale("thr_blocked", { parentThreadId: "thr_parent" }),
          stale("thr_other"),
        ],
        byId: () => [
          stale("thr_parent"),
          stale("thr_blocked", { parentThreadId: "thr_parent" }),
          stale("thr_other"),
        ],
      },
      ARCHIVE_POLICY,
    );
    expect(result.calls.byId).toEqual([
      ["thr_blocked", "thr_parent"],
      ["thr_other"],
    ]);
    expect(result.archives).toEqual(["thr_other"]);
  });

  it("skips a hidden root whose source became active after selection when only the by-ID read shows it", async () => {
    const result = await runSweep(
      {
        full: [
          stale("thr_source", { archivedAt: 1 }),
          stale("thr_blocked", {
            visibility: "hidden",
            sourceThreadId: "thr_source",
          }),
          stale("thr_other"),
        ],
        byId: () => [
          stale("thr_source"),
          stale("thr_blocked", {
            visibility: "hidden",
            sourceThreadId: "thr_source",
          }),
          stale("thr_other"),
        ],
      },
      ARCHIVE_POLICY,
    );
    expect(result.calls.byId).toEqual([
      ["thr_blocked", "thr_source"],
      ["thr_other"],
    ]);
    expect(result.archives).toEqual(["thr_other"]);
  });

  it("does not archive a group when the cascade returns a new visible child, and counts no failure", async () => {
    const result = await runSweep(
      {
        full: [stale("thr_blocked"), stale("thr_other")],
        cascade: (rootId) =>
          rootId === "thr_blocked" ? ["thr_new_child"] : [],
      },
      ARCHIVE_POLICY,
    );
    expect(result.cascades).toEqual([
      [{ threadIds: ["thr_blocked"], action: "archive" }],
      [{ threadIds: ["thr_other"], action: "archive" }],
    ]);
    expect(result.archives).toEqual(["thr_other"]);
    expect(result.state).toMatchObject({
      lastRun: { archivedCount: 1, failedCount: 0 },
    });
    expect(
      result.logs.some(
        (line) =>
          line.includes("thr_blocked") && line.includes("thr_new_child"),
      ),
    ).toBe(true);
    expect(result.logs.some((line) => line.includes("1 cascade skips"))).toBe(
      true,
    );
  });

  it("does not archive a group when the cascade returns a descendant that was unarchived after selection", async () => {
    const result = await runSweep(
      {
        full: [
          stale("thr_blocked"),
          stale("thr_child", {
            parentThreadId: "thr_blocked",
            archivedAt: 1,
          }),
          stale("thr_other"),
        ],
        cascade: (rootId) => (rootId === "thr_blocked" ? ["thr_child"] : []),
      },
      ARCHIVE_POLICY,
    );
    expect(result.calls.byId[0]).toEqual(["thr_blocked"]);
    expect(result.archives).toEqual(["thr_other"]);
    expect(result.state).toMatchObject({ lastRun: { failedCount: 0 } });
  });

  it("does not archive a group when a new child appears only in a snapshot refreshed after expiry", async () => {
    const result = await runSweep(
      {
        full: (read) =>
          read === 1
            ? [stale("thr_blocked"), stale("thr_other")]
            : [
                stale("thr_blocked"),
                stale("thr_new_child", {
                  parentThreadId: "thr_blocked",
                  updatedAt: Date.now(),
                }),
                stale("thr_other"),
              ],
        onFull: (read) => {
          if (read === 1) advance(61_000);
        },
      },
      ARCHIVE_POLICY,
    );
    expect(result.calls.fullReads).toBe(2);
    expect(result.calls.byId).toEqual([["thr_other"]]);
    expect(result.archives).toEqual(["thr_other"]);
  });

  it("counts one failure when the snapshot refresh fails, acts on no group from the old snapshot, and continues", async () => {
    const result = await runSweep(
      {
        full: [stale("thr_a"), stale("thr_b", { updatedAt: 2 })],
        onFull: (read) => {
          if (read === 1) advance(61_000);
          if (read === 2) throw new Error("db busy");
        },
      },
      ARCHIVE_POLICY,
    );
    expect(result.calls.fullReads).toBe(3);
    expect(result.calls.byId).toEqual([["thr_b"]]);
    expect(result.archives).toEqual(["thr_b"]);
    expect(result.state).toMatchObject({
      lastRun: { archivedCount: 1, failedCount: 1 },
    });
  });

  it("counts one failure when the by-ID read fails, acts on that group no further, and continues", async () => {
    const result = await runSweep(
      {
        full: [stale("thr_a"), stale("thr_b", { updatedAt: 2 })],
        onById: (call) => {
          if (call === 1) throw new Error("db busy");
        },
      },
      ARCHIVE_POLICY,
    );
    expect(result.calls.byId).toEqual([["thr_a"], ["thr_b"]]);
    expect(result.cascades).toHaveLength(1);
    expect(result.archives).toEqual(["thr_b"]);
    expect(result.state).toMatchObject({
      lastRun: { archivedCount: 1, failedCount: 1 },
    });
  });

  it("counts one failure when the cascade call fails, acts on that group no further, and continues", async () => {
    const result = await runSweep(
      {
        full: [stale("thr_a"), stale("thr_b", { updatedAt: 2 })],
        onCascade: (call) => {
          if (call === 1) throw new Error("db busy");
        },
      },
      ARCHIVE_POLICY,
    );
    expect(result.cascades).toHaveLength(2);
    expect(result.archives).toEqual(["thr_b"]);
    expect(result.state).toMatchObject({
      lastRun: { archivedCount: 1, failedCount: 1 },
    });
  });

  it("does not archive after the plugin is disposed during the cascade call", async () => {
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { host } = scenarioHost({
      full: [stale("thr_a")],
      onCascade: async () => {
        entered();
        await blocked;
      },
    });
    plugin(host.bb);
    await host.harness.callRpc("configure", ARCHIVE_POLICY);
    const run = host.harness.runSchedule("retention");
    await started;
    await host.harness.dispose();
    release();
    await run;
    expect(host.harness.sdk.callsTo("threads.archive")).toHaveLength(0);
  });

  it("does not archive after the plugin is disposed during a snapshot read", async () => {
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { host, calls } = scenarioHost({
      full: [stale("thr_a")],
      onFull: async (read) => {
        if (read === 1) advance(61_000);
        if (read === 2) {
          entered();
          await blocked;
        }
      },
    });
    plugin(host.bb);
    await host.harness.callRpc("configure", ARCHIVE_POLICY);
    const run = host.harness.runSchedule("retention");
    await started;
    await host.harness.dispose();
    release();
    await run;
    expect(calls.fullReads).toBe(2);
    expect(calls.byId).toHaveLength(0);
    expect(host.harness.sdk.callsTo("threads.archive")).toHaveLength(0);
  });

  it("archives 50 groups on a frozen clock with one full read, one by-ID read and one cascade call per group", async () => {
    const rows = Array.from({ length: 50 }, (_, i) =>
      stale(`thr_${String(i).padStart(2, "0")}`, { updatedAt: i + 1 }),
    );
    const result = await runSweep({ full: rows }, ARCHIVE_POLICY);
    expect(result.calls.fullReads).toBe(1);
    expect(result.calls.byId).toEqual(rows.map((row) => [row.id]));
    expect(result.cascades).toHaveLength(50);
    expect(result.archives).toEqual(rows.map((row) => row.id));
    expect(result.state).toMatchObject({
      lastRun: { archivedCount: 50, failedCount: 0 },
    });
    expect(result.logs).toContain(
      "Retention sweep: 1 full reads in 0 ms, 50 by-ID reads, 50 cascade calls, 50 archive calls, 0 delete calls, 0 cascade skips.",
    );
  });

  it("archives a multi-member group whose cascade returns only its own children", async () => {
    const result = await runSweep(
      {
        full: [
          stale("thr_root"),
          stale("thr_child", { parentThreadId: "thr_root" }),
          stale("thr_grandchild", { parentThreadId: "thr_child" }),
        ],
        cascade: () => ["thr_child", "thr_grandchild"],
      },
      ARCHIVE_POLICY,
    );
    expect(result.calls.byId).toEqual([
      ["thr_child", "thr_grandchild", "thr_root"],
    ]);
    expect(result.archives).toEqual(["thr_root"]);
    expect(result.logs.some((line) => line.includes("0 cascade skips"))).toBe(
      true,
    );
  });

  it("refreshes once for the group and acts on it when a full read takes longer than 60 seconds", async () => {
    const result = await runSweep(
      {
        full: [stale("thr_old")],
        onFull: () => {
          advance(61_000);
        },
      },
      ARCHIVE_POLICY,
    );
    expect(result.calls.fullReads).toBe(2);
    expect(result.calls.byId).toEqual([["thr_old"]]);
    expect(result.archives).toEqual(["thr_old"]);
    expect(result.state).toMatchObject({ lastRun: { failedCount: 0 } });
    expect(
      result.logs.some((line) => line.includes("2 full reads in 122000 ms")),
    ).toBe(true);
  });

  it("measures snapshot age from before the first page, so a clock that advances during the read still expires it at 60 seconds", async () => {
    for (const [elapsed, fullReads] of [
      [59_999, 1],
      [60_000, 2],
    ] as const) {
      vi.setSystemTime(CLOCK_START);
      const result = await runSweep(
        {
          full: [stale("thr_a"), stale("thr_b", { updatedAt: 2 })],
          onFull: (read) => {
            if (read === 1) advance(elapsed);
          },
        },
        ARCHIVE_POLICY,
      );
      expect(result.calls.fullReads).toBe(fullReads);
      expect(result.archives).toEqual(["thr_a", "thr_b"]);
    }
  });

  it("treats a member missing from the by-ID read as gone", async () => {
    const result = await runSweep(
      {
        full: [
          archived("thr_root"),
          archived("thr_owned", { lifecycleOwnerThreadId: "thr_root" }),
        ],
        byId: () => [archived("thr_root")],
      },
      DELETE_POLICY,
    );
    expect(result.calls.byId).toEqual([["thr_owned", "thr_root"]]);
    expect(result.deletes).toEqual(["thr_root"]);
    expect(result.state).toMatchObject({ lastRun: { deletedCount: 1 } });
  });

  it("leaves a group eligible when its parent is missing from the by-ID read", async () => {
    const result = await runSweep(
      {
        full: [
          stale("thr_parent", { archivedAt: 1 }),
          stale("thr_root", { parentThreadId: "thr_parent" }),
        ],
        byId: () => [stale("thr_root", { parentThreadId: "thr_parent" })],
      },
      ARCHIVE_POLICY,
    );
    expect(result.calls.byId).toEqual([["thr_parent", "thr_root"]]);
    expect(result.archives).toEqual(["thr_root"]);
  });

  it("skips a group whose root is missing from the by-ID read", async () => {
    const result = await runSweep(
      {
        full: [stale("thr_blocked"), stale("thr_other")],
        byId: () => [stale("thr_other")],
      },
      ARCHIVE_POLICY,
    );
    expect(result.archives).toEqual(["thr_other"]);
    expect(result.state).toMatchObject({
      lastRun: { archivedCount: 1, failedCount: 0 },
    });
  });
});
