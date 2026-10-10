import { describe, expect, it } from "vitest";
import {
  buildLoadedTimelineState,
  mergeLoadedTimelineWithLatest,
  prependOlderTimelineRows,
  recoverLoadedTimelineAfterStaleCursor,
  resolveLoadedTimelineSurfaceKey,
  type LoadedTimelineState,
} from "@bb/client-core";
import { updateThread } from "@bb/db";
import {
  defaultFeatureFlags,
  encodeClientTurnRequestIdNumber,
  threadScope,
  turnScope,
} from "@bb/domain";
import {
  applyTimelineDelta,
  threadTimelineResponseSchema,
  threadTimelineSignalSchema,
  type ThreadTimelineResponse,
  type TimelinePaginationCursor,
  type TimelineRow,
} from "@bb/server-contract";
import { readJson } from "../helpers/json.js";
import { createMockHubSocket } from "../helpers/mock-hub-socket.js";
import { seedEvent, seedThreadFixture } from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

type SeedEventType = Parameters<typeof seedEvent>[1]["type"];

interface ThreadScript {
  threadId: string;
  append(
    type: SeedEventType,
    scope: ReturnType<typeof turnScope> | ReturnType<typeof threadScope>,
    data: Record<string, unknown>,
  ): void;
  startTurn(turn: number): string;
  finishedTurn(turn: number): void;
}

function createThreadScript(harness: TestAppHarness): ThreadScript {
  const { environment, thread } = seedThreadFixture(harness, {
    thread: { providerId: "codex" },
  });
  let sequence = 0;
  const script: ThreadScript = {
    threadId: thread.id,
    append(type, scope, data) {
      sequence += 1;
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "p1",
        scope,
        sequence,
        type,
        data,
      });
    },
    startTurn(turn) {
      const turnId = `turn-${turn}`;
      const clientRequestId = encodeClientTurnRequestIdNumber({ value: turn });
      script.append("client/turn/requested", threadScope(), {
        direction: "outbound",
        source: "tell",
        initiator: "user",
        request: { method: "turn/start", params: {} },
        requestId: clientRequestId,
        senderThreadId: null,
        input: [{ type: "text", text: `User message ${turn}`, mentions: [] }],
        target: turn === 1 ? { kind: "thread-start" } : { kind: "new-turn" },
        execution: {
          model: "gpt-5",
          serviceTier: "default",
          reasoningLevel: "medium",
          permissionMode: "full",
          source: "client/turn/requested",
        },
      });
      script.append("turn/started", turnScope(turnId), {});
      script.append("turn/input/accepted", turnScope(turnId), {
        clientRequestId,
      });
      return turnId;
    },
    finishedTurn(turn) {
      const turnId = script.startTurn(turn);
      script.append("item/completed", turnScope(turnId), {
        item: {
          type: "agentMessage",
          id: `${turnId}-narration`,
          text: `Checking turn ${turn}.`,
        },
      });
      script.append("item/completed", turnScope(turnId), {
        item: command(`${turnId}-command`, "completed", `turn ${turn} output`),
      });
      script.append("item/completed", turnScope(turnId), {
        item: {
          type: "agentMessage",
          id: `${turnId}-answer`,
          text: `Turn ${turn} is done.`,
        },
      });
      script.append("turn/completed", turnScope(turnId), {
        status: "completed",
      });
    },
  };
  return script;
}

function command(
  id: string,
  status: "pending" | "completed",
  output: string | null,
): Record<string, unknown> {
  return {
    type: "commandExecution",
    id,
    command: `run ${id}`,
    cwd: "/tmp",
    status,
    approvalStatus: null,
    ...(output === null
      ? {}
      : { aggregatedOutput: `${output}\n`, exitCode: 0, durationMs: 1 }),
  };
}

async function readPage(
  harness: TestAppHarness,
  threadId: string,
  cursor: TimelinePaginationCursor | null,
): Promise<{ status: number; timeline: ThreadTimelineResponse | null }> {
  const query = new URLSearchParams({ deferContent: "true" });
  if (cursor !== null) {
    query.set("beforeAnchorId", cursor.anchorId);
    query.set("beforeAnchorSeq", String(cursor.anchorSeq));
  }
  const response = await harness.app.request(
    `/api/v1/threads/${threadId}/timeline?${query}`,
  );
  return response.status === 200
    ? {
        status: 200,
        timeline: threadTimelineResponseSchema.parse(await readJson(response)),
      }
    : { status: response.status, timeline: null };
}

async function readLatest(
  harness: TestAppHarness,
  threadId: string,
): Promise<ThreadTimelineResponse> {
  const { timeline } = await readPage(harness, threadId, null);
  expect(timeline).not.toBeNull();
  return timeline!;
}

type TimelineDelivery = "refetch" | "push";

interface ScrollbackClient {
  latest: ThreadTimelineResponse;
  loaded: LoadedTimelineState;
  pushSocket: ReturnType<typeof createMockHubSocket> | null;
  staleCursorRecoveries: number;
}

function surfaceKeyFor(
  threadId: string,
  latest: ThreadTimelineResponse,
): string {
  return resolveLoadedTimelineSurfaceKey(threadId, latest);
}

async function openThread(
  harness: TestAppHarness,
  threadId: string,
  delivery: TimelineDelivery = "refetch",
): Promise<ScrollbackClient> {
  const latest = await readLatest(harness, threadId);
  const surfaceKey = surfaceKeyFor(threadId, latest);
  const pushSocket = delivery === "push" ? createMockHubSocket() : null;
  if (pushSocket !== null) {
    harness.deps.hub.subscribe(pushSocket, {
      kind: "thread-timeline",
      threadId,
      segmentLimit: null,
      deferContent: true,
    });
  }
  return {
    pushSocket,
    latest,
    loaded: mergeLoadedTimelineWithLatest({
      current: buildLoadedTimelineState({
        historySnapshot: null,
        latestRows: [],
        latestWindowEndSequence: null,
        olderCursor: null,
        surfaceKey,
      }),
      latestTimeline: latest,
      surfaceKey,
    }),
    staleCursorRecoveries: 0,
  };
}

function receiveLatest(
  client: ScrollbackClient,
  threadId: string,
  latest: ThreadTimelineResponse,
): void {
  client.latest = latest;
  client.loaded = mergeLoadedTimelineWithLatest({
    current: client.loaded,
    latestTimeline: latest,
    surfaceKey: surfaceKeyFor(threadId, latest),
  });
}

async function refetch(
  harness: TestAppHarness,
  client: ScrollbackClient,
  threadId: string,
): Promise<void> {
  receiveLatest(client, threadId, await readLatest(harness, threadId));
}

async function refresh(
  harness: TestAppHarness,
  client: ScrollbackClient,
  threadId: string,
): Promise<void> {
  const socket = client.pushSocket;
  if (socket === null) {
    await refetch(harness, client, threadId);
    return;
  }
  harness.deps.hub.notifyThread(threadId, ["events-appended"]);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const signals = socket.messages
    .splice(0)
    .map((message) => JSON.parse(message))
    .filter((message) => message.type === "thread-timeline")
    .map((message) => threadTimelineSignalSchema.parse(message));
  expect(signals.length).toBeGreaterThan(0);
  for (const { afterSequence, timeline } of signals) {
    const rows =
      timeline.delta === undefined
        ? timeline.rows
        : afterSequence !== null && afterSequence <= client.latest.maxSeq
          ? applyTimelineDelta(client.latest.rows, timeline.delta)
          : null;
    expect(rows).not.toBeNull();
    receiveLatest(client, threadId, {
      ...timeline,
      rows: rows!,
      delta: undefined,
    });
  }
}

async function loadOlder(
  harness: TestAppHarness,
  client: ScrollbackClient,
  threadId: string,
): Promise<void> {
  const cursor = client.loaded.olderCursor;
  if (cursor === null) {
    return;
  }
  const { status, timeline } = await readPage(harness, threadId, cursor);
  if (timeline !== null) {
    client.loaded = {
      ...client.loaded,
      olderCursor: timeline.timelinePage.olderCursor,
      rows: prependOlderTimelineRows({
        loadedRows: client.loaded.rows,
        olderRows: timeline.rows,
      }),
    };
    return;
  }
  expect(status).toBe(400);
  client.staleCursorRecoveries += 1;
  const latest = await readLatest(harness, threadId);
  const surfaceKey = surfaceKeyFor(threadId, latest);
  client.loaded = recoverLoadedTimelineAfterStaleCursor({
    current: client.loaded,
    latestTimeline: latest,
    surfaceKey,
  });
  receiveLatest(client, threadId, latest);
}

async function scrollBack(
  harness: TestAppHarness,
  client: ScrollbackClient,
  threadId: string,
  pages: number,
): Promise<void> {
  for (let page = 0; page < pages; page += 1) {
    await loadOlder(harness, client, threadId);
  }
}

async function walkToStart(
  harness: TestAppHarness,
  client: ScrollbackClient,
  threadId: string,
): Promise<number> {
  let pages = 0;
  while (client.loaded.olderCursor !== null) {
    await loadOlder(harness, client, threadId);
    pages += 1;
    expect(pages).toBeLessThan(200);
  }
  return pages;
}

async function freshWalk(
  harness: TestAppHarness,
  threadId: string,
): Promise<TimelineRow[]> {
  const client = await openThread(harness, threadId);
  await walkToStart(harness, client, threadId);
  return client.loaded.rows;
}

function comparableRows(rows: readonly TimelineRow[], threadId: string) {
  return JSON.parse(
    JSON.stringify(rows, (key, value: unknown) =>
      key === "createdAt" || key === "startedAt" || key === "completedAt"
        ? undefined
        : value,
    ).replaceAll(threadId, "<thread>"),
  );
}

function expectUniqueIds(rows: readonly TimelineRow[]): void {
  const ids = rows.map((row) => row.id);
  expect(ids).toEqual([...new Set(ids)]);
}

function expectEndsWithLatest(client: ScrollbackClient): void {
  const latestIds = client.latest.rows.map((row) => row.id);
  expect(
    client.loaded.rows.slice(-latestIds.length).map((row) => row.id),
  ).toEqual(latestIds);
}

const SMALL_WINDOW = {
  featureFlags: { ...defaultFeatureFlags, timelineWindowEventBudget: 6 },
};

describe.each(["refetch", "push"] as const)(
  "timeline scrollback against the server (%s)",
  (delivery) => {
    it("walks every page of a paged thread to the rows of one unpaged read", async () => {
      let paged: unknown = null;
      let pages = 0;
      await withTestHarness(SMALL_WINDOW, async (harness) => {
        const script = createThreadScript(harness);
        for (let turn = 1; turn <= 8; turn += 1) script.finishedTurn(turn);
        const client = await openThread(harness, script.threadId, delivery);
        pages = await walkToStart(harness, client, script.threadId);
        paged = comparableRows(client.loaded.rows, script.threadId);
      });
      await withTestHarness(async (harness) => {
        const script = createThreadScript(harness);
        for (let turn = 1; turn <= 8; turn += 1) script.finishedTurn(turn);
        const whole = await readLatest(harness, script.threadId);
        expect(whole.timelinePage.olderCursor).toBeNull();
        expect(pages).toBeGreaterThan(2);
        expect(paged).toEqual(comparableRows(whole.rows, script.threadId));
      });
    });

    it("streams into a scrolled-back view and ends equal to a fresh walk", async () => {
      await withTestHarness(SMALL_WINDOW, async (harness) => {
        const script = createThreadScript(harness);
        for (let turn = 1; turn <= 6; turn += 1) script.finishedTurn(turn);
        const turnId = script.startTurn(7);
        const client = await openThread(harness, script.threadId, delivery);
        await scrollBack(harness, client, script.threadId, 2);
        const scrolledBackIds = client.loaded.rows
          .slice(0, 3)
          .map((row) => row.id);

        const steps: (() => void)[] = [
          () =>
            script.append("item/agentMessage/delta", turnScope(turnId), {
              itemId: "turn-7-live",
              delta: "Reading the logs.\n",
            }),
          () =>
            script.append("item/started", turnScope(turnId), {
              item: command("turn-7-command", "pending", null),
            }),
          () =>
            script.append("item/completed", turnScope(turnId), {
              item: command("turn-7-command", "completed", "ok"),
            }),
          () =>
            script.append("item/completed", turnScope(turnId), {
              item: {
                type: "agentMessage",
                id: "turn-7-live",
                text: "Reading the logs.\nAll clear.",
              },
            }),
          () =>
            script.append("turn/completed", turnScope(turnId), {
              status: "completed",
            }),
          () => script.startTurn(8),
          () =>
            script.append("item/agentMessage/delta", turnScope("turn-8"), {
              itemId: "turn-8-live",
              delta: "Next.\n",
            }),
        ];
        for (const step of steps) {
          step();
          await refresh(harness, client, script.threadId);
          expectUniqueIds(client.loaded.rows);
          expectEndsWithLatest(client);
          expect(client.loaded.rows.slice(0, 3).map((row) => row.id)).toEqual(
            scrolledBackIds,
          );
        }

        await walkToStart(harness, client, script.threadId);
        expect(client.loaded.rows).toEqual(
          await freshWalk(harness, script.threadId),
        );
      });
    });

    it("keeps a scrolled-back view unchanged when a refetch finds no new events", async () => {
      await withTestHarness(SMALL_WINDOW, async (harness) => {
        const script = createThreadScript(harness);
        for (let turn = 1; turn <= 6; turn += 1) script.finishedTurn(turn);
        script.startTurn(7);
        const client = await openThread(harness, script.threadId, delivery);
        await scrollBack(harness, client, script.threadId, 2);
        const before = client.loaded;

        await refetch(harness, client, script.threadId);

        expect(client.latest.timelinePage.historySnapshot).toBe(
          before.historySnapshot,
        );
        expect(client.loaded.rows).toEqual(before.rows);
        expect(client.loaded.olderCursor).toEqual(before.olderCursor);
        await walkToStart(harness, client, script.threadId);
        expect(client.loaded.rows).toEqual(
          await freshWalk(harness, script.threadId),
        );
      });
    });

    it("streams a running turn larger than the window while scrolled back inside it", async () => {
      await withTestHarness(SMALL_WINDOW, async (harness) => {
        const script = createThreadScript(harness);
        script.finishedTurn(1);
        const turnId = script.startTurn(2);
        for (let index = 0; index < 12; index += 1) {
          script.append("item/completed", turnScope(turnId), {
            item: command(`turn-2-command-${index}`, "completed", `${index}`),
          });
        }
        const client = await openThread(harness, script.threadId, delivery);
        await scrollBack(harness, client, script.threadId, 1);

        for (let index = 12; index < 20; index += 1) {
          script.append("item/completed", turnScope(turnId), {
            item: command(`turn-2-command-${index}`, "completed", `${index}`),
          });
          await refresh(harness, client, script.threadId);
          expectUniqueIds(client.loaded.rows);
          expectEndsWithLatest(client);
        }
        script.append("turn/completed", turnScope(turnId), {
          status: "completed",
        });
        await refresh(harness, client, script.threadId);

        await walkToStart(harness, client, script.threadId);
        expect(client.loaded.rows).toEqual(
          await freshWalk(harness, script.threadId),
        );
      });
    });

    it.each([0, 1])(
      "drops in-turn rows a completed turn absorbed, scrolled back %i pages",
      async (pages) => {
        await withTestHarness(SMALL_WINDOW, async (harness) => {
          const script = createThreadScript(harness);
          script.finishedTurn(1);
          const turnId = script.startTurn(2);
          for (let index = 0; index < 12; index += 1) {
            script.append("item/completed", turnScope(turnId), {
              item: command(`turn-2-command-${index}`, "completed", `${index}`),
            });
          }
          script.append("item/agentMessage/delta", turnScope(turnId), {
            itemId: "turn-2-answer",
            delta: "Done.\n",
          });
          const client = await openThread(harness, script.threadId, delivery);
          await scrollBack(harness, client, script.threadId, pages);

          script.append("item/completed", turnScope(turnId), {
            item: {
              type: "agentMessage",
              id: "turn-2-answer",
              text: "Done.\n",
            },
          });
          script.append("turn/completed", turnScope(turnId), {
            status: "completed",
          });
          await refresh(harness, client, script.threadId);

          expect(client.loaded.rows).toEqual(client.latest.rows);
          expect(client.loaded.olderCursor).toEqual(
            client.latest.timelinePage.olderCursor,
          );
          await walkToStart(harness, client, script.threadId);
          expect(client.loaded.rows).toEqual(
            await freshWalk(harness, script.threadId),
          );
        });
      },
    );

    it("updates a scrolled-back item that completes in a later turn", async () => {
      await withTestHarness(SMALL_WINDOW, async (harness) => {
        const script = createThreadScript(harness);
        script.finishedTurn(1);
        const turnId = script.startTurn(2);
        script.append("item/started", turnScope(turnId), {
          item: command("dev-server", "pending", null),
        });
        script.append("turn/completed", turnScope(turnId), {
          status: "completed",
        });
        for (let turn = 3; turn <= 6; turn += 1) script.finishedTurn(turn);
        const client = await openThread(harness, script.threadId, delivery);
        await walkToStart(harness, client, script.threadId);

        script.append("item/completed", turnScope(turnId), {
          item: command("dev-server", "completed", "dev server exited"),
        });
        await refresh(harness, client, script.threadId);
        expectUniqueIds(client.loaded.rows);

        await walkToStart(harness, client, script.threadId);
        expect(client.loaded.rows).toEqual(
          await freshWalk(harness, script.threadId),
        );
      });
    });

    it("recovers a scrolled-back view whose cursor went stale on rename", async () => {
      await withTestHarness(SMALL_WINDOW, async (harness) => {
        const script = createThreadScript(harness);
        for (let turn = 1; turn <= 6; turn += 1) script.finishedTurn(turn);
        const client = await openThread(harness, script.threadId, delivery);
        await scrollBack(harness, client, script.threadId, 1);
        expect(client.loaded.olderCursor).not.toBeNull();

        updateThread(harness.db, harness.hub, script.threadId, {
          title: "Renamed while scrolled back",
        });
        script.startTurn(7);
        await loadOlder(harness, client, script.threadId);

        expect(client.staleCursorRecoveries).toBe(1);
        expect(client.loaded.rows).toEqual(client.latest.rows);
        expect(client.loaded.olderCursor).toEqual(
          client.latest.timelinePage.olderCursor,
        );
        await walkToStart(harness, client, script.threadId);
        expect(client.loaded.rows).toEqual(
          await freshWalk(harness, script.threadId),
        );
      });
    });
  },
);
