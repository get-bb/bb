import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createProject,
  createThread,
  getLatestThreadSequence,
  insertEvents,
  listStoredEventRows,
  noopNotifier,
  upsertHost,
  type DbConnection,
} from "@bb/db";
import { createMigratedConnection } from "@bb/db/testing";
import {
  encodeClientTurnRequestIdNumber,
  threadScope,
  turnScope,
} from "@bb/domain";
import { copyForkSourceHistory } from "../../../src/services/threads/thread-fork-history.js";
import { NotificationHub } from "../../../src/ws/hub.js";

const TURN_COUNT = 60;

function seedSource(db: DbConnection) {
  const host = upsertHost(db, noopNotifier, { name: "fork-history-host" });
  const { project } = createProject(db, noopNotifier, {
    name: "fork-history-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/fork-history" },
  });
  const source = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "codex",
  });
  const fork = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "codex",
  });
  let sequence = 0;
  const event = (
    type: Parameters<typeof insertEvents>[2][number]["type"],
    turnId: string | null,
    data: Record<string, unknown>,
    item: { id: string; kind: "agentMessage" } | null = null,
  ) => ({
    createdAt: 1_800_000_000_000 + sequence,
    data: JSON.stringify(data),
    itemId: item?.id ?? null,
    itemKind: item?.kind ?? null,
    parentToolCallId: null,
    providerThreadId: turnId === null ? null : "provider-fork-history",
    scope: turnId === null ? threadScope() : turnScope(turnId),
    sequence: ++sequence,
    threadId: source.id,
    type,
  });
  insertEvents(
    db,
    noopNotifier,
    Array.from({ length: TURN_COUNT }, (_, index) => {
      const turnId = `turn-${index}`;
      const requestId = encodeClientTurnRequestIdNumber({ value: index + 1 });
      return [
        event("client/turn/requested", null, {
          direction: "outbound",
          requestId,
          source: "tell",
          initiator: "user",
          senderThreadId: null,
          input: [{ type: "text", text: `Request ${index}` }],
          target: { kind: "new-turn" },
          request: { method: "turn/start", params: {} },
          execution: {
            model: "gpt-5",
            reasoningLevel: "medium",
            permissionMode: "workspace-write",
            source: "client/turn/requested",
            serviceTier: "auto",
          },
        }),
        event("turn/started", turnId, {}),
        event("turn/input/accepted", turnId, { clientRequestId: requestId }),
        event(
          "item/completed",
          turnId,
          {
            item: {
              id: `message-${index}`,
              type: "agentMessage",
              text: `Answer ${index}`,
            },
          },
          { id: `message-${index}`, kind: "agentMessage" },
        ),
        event("turn/completed", turnId, { status: "completed" }),
      ];
    }).flat(),
  );
  return { fork, historyEndSequence: sequence, source };
}

function sliceEveryBatch(): void {
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => (now += 1_000));
}

function observeForkSequences(db: DbConnection, forkId: string) {
  const seen: number[] = [];
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    seen.push(getLatestThreadSequence(db, { threadId: forkId }));
    setImmediate(tick);
  };
  setImmediate(tick);
  return {
    seen,
    stop: () => {
      stopped = true;
    },
  };
}

describe("fork history copy", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("copies a long history in slices that let the event loop run", async () => {
    const db = createMigratedConnection();
    const { fork, historyEndSequence, source } = seedSource(db);
    sliceEveryBatch();
    const observer = observeForkSequences(db, fork.id);

    await copyForkSourceHistory(
      { db, hub: new NotificationHub() },
      { fork, historyEndSequence, sourceThreadId: source.id },
    );
    observer.stop();

    const sourceRows = listStoredEventRows(db, { threadId: source.id });
    const forkRows = listStoredEventRows(db, { threadId: fork.id });
    expect(
      observer.seen.some(
        (sequence) => sequence > 0 && sequence < forkRows.length,
      ),
    ).toBe(true);
    expect(
      forkRows.map(({ id: _id, threadId: _threadId, ...row }) => row),
    ).toEqual(
      sourceRows.map(({ id: _id, threadId: _threadId, ...row }) => ({
        ...row,
        providerThreadId: null,
      })),
    );
    db.$client.close();
  });

  it("fails when the fork receives other events while its history is copied", async () => {
    const db = createMigratedConnection();
    const { fork, historyEndSequence, source } = seedSource(db);
    sliceEveryBatch();
    let intruded = false;
    const intrude = () => {
      const sequence = getLatestThreadSequence(db, { threadId: fork.id });
      if (sequence === 0) {
        setImmediate(intrude);
        return;
      }
      insertEvents(db, noopNotifier, [
        {
          createdAt: 1,
          data: JSON.stringify({ message: "intruder" }),
          itemId: null,
          itemKind: null,
          parentToolCallId: null,
          scope: threadScope(),
          sequence: sequence + 1,
          threadId: fork.id,
          type: "system/error",
        },
      ]);
      intruded = true;
    };
    setImmediate(intrude);

    await expect(
      copyForkSourceHistory(
        { db, hub: new NotificationHub() },
        { fork, historyEndSequence, sourceThreadId: source.id },
      ),
    ).rejects.toMatchObject({
      body: { code: "fork_history_changed" },
    });
    expect(intruded).toBe(true);
    db.$client.close();
  });
});
