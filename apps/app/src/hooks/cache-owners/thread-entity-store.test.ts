import { jsonValueSchema } from "@bb/domain";
import { applyCoreReadChange } from "@/hooks/cache-owners/core-read-changes";
import type { ThreadListEntry } from "@bb/domain";
import {
  keyedStoreContract,
  type KeyedStoreSubject,
} from "@bb/query-changes/testing";
import type { SidebarBootstrapResponse } from "@bb/server-contract";
import { makeThreadListEntry as makeEntry } from "@bb/test-helpers/domain-fixtures";
import { describe, expect, it } from "vitest";
import {
  makeProjectWithThreadsResponse,
  makeSidebarBootstrapResponse,
} from "@/test/fixtures/projects";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  sidebarNavigationQueryKey,
  threadListQueryKey,
  threadQueryKey,
} from "../queries/query-keys";

import {
  beginThreadEntityPrediction,
  getThreadEntity,
} from "./thread-entity-store";
import {
  beginArchiveThreadAndChildrenTransaction,
  predictThreadPinState,
  beginUnarchiveThreadTransaction,
  rollbackArchiveThreadsTransaction,
  rollbackThreadListMutationTransaction,
  settleArchiveThreadsTransaction,
} from "./thread-state-cache-owner";

const entry = (id: string, overrides: Partial<ThreadListEntry> = {}) =>
  makeEntry({
    id,
    projectId: "project-1",
    status: "idle",
    pinnedAt: null,
    archivedAt: null,
    updatedAt: 10,
    ...overrides,
  });

function setup(rows: ThreadListEntry[]) {
  const { queryClient } = createQueryClientTestHarness();
  const sidebar = (threads: ThreadListEntry[]): SidebarBootstrapResponse =>
    makeSidebarBootstrapResponse({
      projects: [makeProjectWithThreadsResponse({ id: "project-1", threads })],
    });
  queryClient.setQueryData(sidebarNavigationQueryKey(), sidebar(rows));
  const listKey = threadListQueryKey({
    projectId: "project-1",
    archived: false,
  });
  const lateKey = threadListQueryKey({ archived: false, limit: 50 });
  const sidebarRows = () =>
    queryClient.getQueryData<SidebarBootstrapResponse>(
      sidebarNavigationQueryKey(),
    )?.projects[0]?.threads ?? [];
  const listRows = (key = listKey) =>
    queryClient.getQueryData<ThreadListEntry[]>(key) ?? [];
  const describeRows = (rows: ThreadListEntry[]) =>
    rows.map((row) => `${row.id}:${row.pinnedAt}:${row.status}`);
  const fetchList = (key: typeof listKey, rows: () => ThreadListEntry[]) =>
    queryClient.fetchQuery({
      queryKey: key,
      queryFn: async () => structuredClone(rows()),
      staleTime: 0,
    });
  return {
    queryClient,
    listKey,
    lateKey,
    sidebarRows,
    listRows,
    describeRows,
    fetchList,
  };
}

describe("thread entity store", () => {
  it("keeps a pin and a mid-save status patch in every view, including a list that loads while pending, and rolls back only the pin", async () => {
    const server = [entry("t1"), entry("t2")];
    const s = setup(server);
    await s.fetchList(s.listKey, () => server);
    s.queryClient.setQueryData(threadQueryKey("t1"), {
      ...server[0],
      queuedMessageCount: 0,
    });
    const pin = predictThreadPinState(s.queryClient, {
      pinnedAt: 5,
      threadId: "t1",
    });
    applyCoreReadChange(s.queryClient, {
      entity: "thread",
      id: "t1",
      changes: ["status-changed"],
      value: jsonValueSchema.parse({
        status: "active",
        runtime: { displayStatus: "active" },
        activity: server[0]!.activity,
        latestAttentionAt: 20,
        updatedAt: 11,
      }),
    });
    await s.fetchList(s.lateKey, () => server);

    expect(s.describeRows(s.sidebarRows())).toEqual([
      "t1:5:active",
      "t2:null:idle",
    ]);
    expect(s.describeRows(s.listRows(s.lateKey))).toEqual([
      "t1:5:active",
      "t2:null:idle",
    ]);
    expect(
      s.queryClient.getQueryData<ThreadListEntry>(threadQueryKey("t1")),
    ).toMatchObject({ pinnedAt: 5, status: "active" });

    pin.fail();
    for (const rows of [s.sidebarRows(), s.listRows(), s.listRows(s.lateKey)])
      expect(s.describeRows(rows)).toEqual(["t1:null:active", "t2:null:idle"]);
    expect(
      s.queryClient.getQueryData<ThreadListEntry>(threadQueryKey("t1")),
    ).toMatchObject({ pinnedAt: null, status: "active" });
  });

  it("does not leak a failed prediction through a write that both adds a row and edits the predicted one", async () => {
    const s = setup([]);
    await s.fetchList(s.listKey, () => [entry("t1")]);
    const pin = predictThreadPinState(s.queryClient, {
      pinnedAt: 5,
      threadId: "t1",
    });
    const visible = s.listRows();
    s.queryClient.setQueryData(s.listKey, [
      entry("t0"),
      ...visible.map((row) => ({ ...row, status: "active" as const })),
    ]);
    pin.fail();
    expect(s.describeRows(s.listRows())).toEqual([
      "t0:null:idle",
      "t1:null:active",
    ]);
  });

  it("ignores a read that started before the write was acknowledged and accepts one that started after", async () => {
    const server = [entry("t1")];
    const s = setup(server);
    await s.fetchList(s.listKey, () => server);
    const pin = predictThreadPinState(s.queryClient, {
      pinnedAt: 5,
      threadId: "t1",
    });
    let releaseStale!: () => void;
    const stale = s.queryClient.fetchQuery({
      queryKey: s.lateKey,
      queryFn: async () => {
        const rows = structuredClone(server);
        await new Promise<void>((resolve) => {
          releaseStale = resolve;
        });
        return rows;
      },
    });
    pin.succeed({ ...server[0]!, pinnedAt: 7 });
    releaseStale();
    await stale;
    expect(s.describeRows(s.listRows(s.lateKey))).toEqual(["t1:7:idle"]);

    await s.fetchList(s.lateKey, () => [entry("t1", { pinnedAt: 9 })]);
    expect(s.describeRows(s.sidebarRows())).toEqual(["t1:9:idle"]);
  });

  it("hides an archived family from every active view and restores it in place on failure", async () => {
    const server = [
      entry("root"),
      entry("child", { parentThreadId: "root" }),
      entry("other"),
    ];
    const s = setup(server);
    await s.fetchList(s.listKey, () => server);
    const transaction = await beginArchiveThreadAndChildrenTransaction({
      queryClient: s.queryClient,
      threadId: "root",
    });
    await s.fetchList(s.lateKey, () => server);
    const ids = (rows: ThreadListEntry[]) => rows.map((row) => row.id);
    expect(ids(s.sidebarRows())).toEqual(["other"]);
    expect(ids(s.listRows(s.lateKey))).toEqual(["other"]);

    rollbackArchiveThreadsTransaction({
      queryClient: s.queryClient,
      transaction,
    });
    settleArchiveThreadsTransaction({
      queryClient: s.queryClient,
      response: undefined,
      transaction,
    });
    expect(ids(s.sidebarRows())).toEqual(["root", "child", "other"]);
    expect(ids(s.listRows())).toEqual(["root", "child", "other"]);
    expect(ids(s.listRows(s.lateKey))).toEqual(["root", "child", "other"]);
  });

  it("applies a status update to a thread hidden by a pending archive, so rollback shows the latest status", async () => {
    const server = [entry("t1"), entry("t2")];
    const s = setup(server);
    const transaction = await beginArchiveThreadAndChildrenTransaction({
      queryClient: s.queryClient,
      threadId: "t1",
    });
    for (const [status, updatedAt] of [
      ["active", 11],
      ["idle", 12],
    ] as const)
      applyCoreReadChange(s.queryClient, {
        entity: "thread",
        id: "t1",
        changes: ["status-changed"],
        value: jsonValueSchema.parse({
          status,
          runtime: { displayStatus: status },
          activity: server[0]!.activity,
          latestAttentionAt: updatedAt,
          updatedAt,
        }),
      });
    expect(s.describeRows(s.sidebarRows())).toEqual(["t2:null:idle"]);
    rollbackArchiveThreadsTransaction({
      queryClient: s.queryClient,
      transaction,
    });
    expect(
      s.sidebarRows().map((row) => [row.id, row.status, row.updatedAt]),
    ).toEqual([
      ["t1", "idle", 12],
      ["t2", "idle", 10],
    ]);
  });

  it("keeps an unarchived thread in the sidebar through a sidebar read that started before the unarchive", async () => {
    const live = [entry("t2")];
    const s = setup(live);
    const archivedKey = threadListQueryKey({
      projectId: "project-1",
      archived: true,
    });
    await s.fetchList(archivedKey, () => [
      entry("t1", { archivedAt: 5, updatedAt: 11 }),
    ]);
    const sidebar = (threads: ThreadListEntry[]) =>
      makeSidebarBootstrapResponse({
        projects: [
          makeProjectWithThreadsResponse({ id: "project-1", threads }),
        ],
      });
    let releaseStale!: () => void;
    const stale = s.queryClient.fetchQuery({
      queryKey: sidebarNavigationQueryKey(),
      queryFn: async () => {
        await new Promise<void>((resolve) => {
          releaseStale = resolve;
        });
        return sidebar(live);
      },
      staleTime: 0,
    });
    const transaction = await beginUnarchiveThreadTransaction({
      queryClient: s.queryClient,
      threadId: "t1",
    });
    expect(s.sidebarRows().map((row) => row.id)).toEqual(["t2", "t1"]);
    releaseStale();
    await stale;
    expect(s.sidebarRows().map((row) => row.id)).toEqual(["t2", "t1"]);

    rollbackThreadListMutationTransaction({
      queryClient: s.queryClient,
      threadId: "t1",
      transaction,
    });
    expect(s.sidebarRows().map((row) => row.id)).toEqual(["t2"]);
    await s.queryClient.fetchQuery({
      queryKey: sidebarNavigationQueryKey(),
      queryFn: async () => sidebar(live),
      staleTime: 0,
    });
    expect(s.sidebarRows().map((row) => row.id)).toEqual(["t2"]);
  });

  it("keeps a thread unarchived from the sidebar it was archived in through an older sidebar read", async () => {
    const live = [entry("t1"), entry("t2")];
    const s = setup(live);
    const archive = await beginArchiveThreadAndChildrenTransaction({
      queryClient: s.queryClient,
      threadId: "t1",
    });
    settleArchiveThreadsTransaction({
      queryClient: s.queryClient,
      response: { ok: true, archivedThreadIds: ["t1"] },
      transaction: archive,
    });
    let releaseStale!: () => void;
    const stale = s.queryClient.fetchQuery({
      queryKey: sidebarNavigationQueryKey(),
      queryFn: async () => {
        await new Promise<void>((resolve) => {
          releaseStale = resolve;
        });
        return makeSidebarBootstrapResponse({
          projects: [
            makeProjectWithThreadsResponse({
              id: "project-1",
              threads: [entry("t2")],
            }),
          ],
        });
      },
      staleTime: 0,
    });
    await beginUnarchiveThreadTransaction({
      queryClient: s.queryClient,
      threadId: "t1",
    });
    expect(s.sidebarRows().map((row) => row.id)).toEqual(["t1", "t2"]);
    releaseStale();
    await stale;
    expect(s.sidebarRows().map((row) => row.id)).toContain("t1");
  });

  it("drops an entity once no view holds it", async () => {
    const s = setup([]);
    await s.fetchList(s.listKey, () => [entry("t1")]);
    expect(getThreadEntity(s.queryClient, "t1")).toBeDefined();
    s.queryClient.removeQueries({ queryKey: s.listKey });
    expect(getThreadEntity(s.queryClient, "t1")).toBeUndefined();
  });
});

function threadSubject(): KeyedStoreSubject {
  const { queryClient } = createQueryClientTestHarness();
  const listKey = (key: string) =>
    threadListQueryKey({ projectId: key, archived: false });
  const fetchRow = (key: string, value: number, gate?: Promise<void>) =>
    queryClient.fetchQuery({
      queryKey: listKey(key),
      queryFn: async () => {
        await gate;
        return [entry(key, { projectId: key, title: `${value}` })];
      },
      staleTime: 0,
    });
  const fetchRows = (
    rows: Readonly<Record<string, number>>,
    gate?: Promise<void>,
  ) =>
    Promise.all(
      Object.entries(rows).map(([key, value]) => fetchRow(key, value, gate)),
    );
  return {
    async load(rows) {
      await fetchRows(rows);
    },
    visible(key) {
      const title = queryClient.getQueryData<ThreadListEntry[]>(
        listKey(key),
      )?.[0]?.title;
      return title === undefined ? undefined : Number(title);
    },
    async read(rows) {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const reading = fetchRows(rows, gate);
      return {
        async finish() {
          release();
          await reading;
        },
      };
    },
    async write(key, value) {
      const prediction = beginThreadEntityPrediction(queryClient, {
        threadIds: [key],
        update: (entity) => ({
          ...entity,
          thread: { ...entity.thread, title: `${value}` },
        }),
      });
      return {
        accept: async () => prediction.succeed(),
        reject: async () => prediction.fail(),
      };
    },
  };
}

it.each(keyedStoreContract)("thread entities: $name", async ({ run }) => {
  await run(threadSubject());
});
