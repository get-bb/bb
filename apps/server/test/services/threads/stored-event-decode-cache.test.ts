import { describe, expect, it } from "vitest";
import {
  encodeClientTurnRequestIdNumber,
  LOCAL_WORKFLOW_TASK_TYPE,
  THREAD_CONTEXT_CLEAR_OPERATION,
  threadScope,
  turnScope,
} from "@bb/domain";
import {
  createConnection,
  createProject,
  createThread,
  insertEvents,
  listStoredEventRows,
  migrate,
  noopNotifier,
  upsertHost,
  type DbConnection,
  type StoredEventRow,
} from "@bb/db";
import {
  clearStoredEventDecodeCache,
  decodeStoredEventRowCached,
  readStoredEventDecodeCacheSize,
  setStoredEventDecodeCacheFreezeForTesting,
  STORED_EVENT_DECODE_CACHE_MAX_DATA_CHARS,
  STORED_EVENT_DECODE_CACHE_MAX_ENTRIES,
} from "../../../src/services/threads/stored-event-decode-cache.js";
import { parseStoredEvent } from "../../../src/services/threads/thread-data.js";

type EventInput = Parameters<typeof insertEvents>[2][number];

interface TestDb {
  db: DbConnection;
  projectId: string;
  threadId: string;
}

const providerThreadId = "provider-decode";

function setup(): TestDb {
  const db = createConnection(":memory:");
  migrate(db);
  const host = upsertHost(db, noopNotifier, { name: "decode-host" });
  const { project } = createProject(db, noopNotifier, {
    name: "decode-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/decode" },
  });
  const thread = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "codex",
  });
  return { db, projectId: project.id, threadId: thread.id };
}

function storedShapes(threadId: string): EventInput[] {
  const requestId = encodeClientTurnRequestIdNumber({ value: 1 });
  const turn = turnScope("turn-1");
  const shapes: Omit<EventInput, "sequence" | "threadId">[] = [
    {
      type: "client/turn/requested",
      scope: threadScope(),
      itemId: null,
      itemKind: null,
      parentToolCallId: null,
      data: JSON.stringify({
        direction: "outbound",
        source: "tell",
        initiator: "user",
        request: { method: "turn/start", params: {} },
        requestId,
        senderThreadId: null,
        input: [{ type: "text", text: "Hello", mentions: [] }],
        target: { kind: "thread-start" },
        execution: {
          model: "gpt-5",
          serviceTier: "default",
          reasoningLevel: "medium",
          permissionMode: "full",
          source: "client/turn/requested",
        },
      }),
    },
    {
      type: "turn/started",
      scope: turn,
      providerThreadId,
      itemId: null,
      itemKind: null,
      parentToolCallId: null,
      data: JSON.stringify({}),
    },
    {
      type: "turn/input/accepted",
      scope: turn,
      providerThreadId,
      itemId: null,
      itemKind: null,
      parentToolCallId: null,
      data: JSON.stringify({ clientRequestId: requestId }),
    },
    {
      type: "item/agentMessage/delta",
      scope: turn,
      providerThreadId,
      itemId: "message-1",
      itemKind: null,
      parentToolCallId: null,
      data: JSON.stringify({ itemId: "message-1", delta: "Hel" }),
    },
    {
      type: "item/reasoning/textDelta",
      scope: turn,
      providerThreadId,
      itemId: "reasoning-1",
      itemKind: null,
      parentToolCallId: null,
      data: JSON.stringify({
        itemId: "reasoning-1",
        contentIndex: 0,
        delta: "Thinking",
      }),
    },
    {
      type: "item/completed",
      scope: turn,
      providerThreadId,
      itemId: "message-1",
      itemKind: "agentMessage",
      parentToolCallId: null,
      data: JSON.stringify({
        item: { type: "agentMessage", id: "message-1", text: "Hello" },
      }),
    },
    {
      type: "item/started",
      scope: turn,
      providerThreadId,
      itemId: "command-1",
      itemKind: "commandExecution",
      parentToolCallId: null,
      data: JSON.stringify({
        item: {
          type: "commandExecution",
          id: "command-1",
          command: "pnpm test",
          cwd: "/tmp/decode",
          status: "pending",
          approvalStatus: null,
        },
      }),
    },
    {
      type: "item/commandExecution/outputDelta",
      scope: turn,
      providerThreadId,
      itemId: "command-1",
      itemKind: null,
      parentToolCallId: null,
      data: JSON.stringify({ itemId: "command-1", delta: "ok\n" }),
    },
    {
      type: "item/completed",
      scope: turn,
      providerThreadId,
      itemId: "command-1",
      itemKind: "commandExecution",
      parentToolCallId: null,
      data: JSON.stringify({
        item: {
          type: "commandExecution",
          id: "command-1",
          command: "pnpm test",
          cwd: "/tmp/decode",
          status: "completed",
          approvalStatus: null,
          exitCode: 0,
          aggregatedOutput: "ok\n",
        },
      }),
    },
    {
      type: "item/started",
      scope: turn,
      providerThreadId,
      itemId: "delegate-1",
      itemKind: "toolCall",
      parentToolCallId: null,
      data: JSON.stringify({
        item: {
          type: "toolCall",
          id: "delegate-1",
          tool: "Agent",
          arguments: { prompt: "Investigate" },
          status: "pending",
        },
      }),
    },
    {
      type: "item/started",
      scope: turnScope("nested-1"),
      providerThreadId,
      itemId: "nested-message",
      itemKind: "agentMessage",
      parentToolCallId: "delegate-1",
      data: JSON.stringify({
        item: {
          type: "agentMessage",
          id: "nested-message",
          text: "",
          parentToolCallId: "delegate-1",
        },
      }),
    },
    {
      type: "item/started",
      scope: turn,
      providerThreadId,
      itemId: "task:wf-1",
      itemKind: "backgroundTask",
      parentToolCallId: null,
      data: JSON.stringify({
        providerThreadId,
        item: {
          type: "backgroundTask",
          id: "task:wf-1",
          taskType: LOCAL_WORKFLOW_TASK_TYPE,
          description: "workflow",
          status: "pending",
          taskStatus: "running",
          skipTranscript: false,
          workflowName: "workflow",
        },
      }),
    },
    {
      type: "turn/plan/updated",
      scope: turn,
      providerThreadId,
      itemId: null,
      itemKind: null,
      parentToolCallId: null,
      data: JSON.stringify({
        explanation: "Plan",
        plan: [{ step: "Write tests", status: "active" }],
      }),
    },
    {
      type: "thread/contextWindowUsage/updated",
      scope: turn,
      providerThreadId,
      itemId: null,
      itemKind: null,
      parentToolCallId: null,
      data: JSON.stringify({
        contextWindowUsage: {
          estimated: false,
          modelContextWindow: 200_000,
          usedTokens: 42,
        },
      }),
    },
    {
      type: "turn/completed",
      scope: turn,
      providerThreadId,
      itemId: null,
      itemKind: null,
      parentToolCallId: null,
      data: JSON.stringify({ status: "completed" }),
    },
    {
      type: "system/operation",
      scope: threadScope(),
      itemId: null,
      itemKind: null,
      parentToolCallId: null,
      data: JSON.stringify({
        operation: THREAD_CONTEXT_CLEAR_OPERATION,
        operationId: "clear",
        status: "completed",
        message: "Fresh context",
      }),
    },
    {
      type: "system/manager/user_message",
      scope: threadScope(),
      itemId: null,
      itemKind: null,
      parentToolCallId: null,
      data: JSON.stringify({ text: "manager note" }),
    },
  ];
  return shapes.map((shape, index) => ({
    ...shape,
    sequence: index + 1,
    threadId,
  }));
}

function seedShapes(testDb: TestDb): StoredEventRow[] {
  insertEvents(testDb.db, noopNotifier, storedShapes(testDb.threadId));
  return listStoredEventRows(testDb.db, { threadId: testDb.threadId });
}

describe("stored event decode cache", () => {
  it("decodes every stored shape equal to parseStoredEvent and reuses the decode", () => {
    const testDb = setup();
    try {
      const rows = seedShapes(testDb);
      expect(rows).toHaveLength(storedShapes(testDb.threadId).length);
      for (const row of rows) {
        const decoded = decodeStoredEventRowCached(testDb.db, row);
        expect(decoded).toEqual(parseStoredEvent(row));
        expect(decodeStoredEventRowCached(testDb.db, row)).toBe(decoded);
        expect(decodeStoredEventRowCached(testDb.db, { ...row })).toBe(decoded);
      }
      expect(readStoredEventDecodeCacheSize(testDb.db).entryCount).toBe(
        rows.length,
      );
    } finally {
      testDb.db.$client.close();
    }
  });

  it("decodes again when any parse input of a row changes", () => {
    const testDb = setup();
    try {
      const rows = seedShapes(testDb);
      const row = rows.find(
        (candidate) =>
          candidate.type === "item/completed" &&
          candidate.itemKind === "agentMessage",
      );
      if (row === undefined) {
        throw new Error("Expected an agent message completion row");
      }
      const original = decodeStoredEventRowCached(testDb.db, row);
      const variants: StoredEventRow[] = [
        {
          ...row,
          data: JSON.stringify({
            item: { type: "agentMessage", id: "message-1", text: "Changed" },
          }),
        },
        { ...row, providerThreadId: "provider-other" },
        { ...row, turnId: "turn-other" },
        { ...row, threadId: "thr_other" },
        { ...row, type: "item/started" },
      ];
      for (const variant of variants) {
        const decoded = decodeStoredEventRowCached(testDb.db, variant);
        expect(decoded).not.toBe(original);
        expect(decoded).toEqual(parseStoredEvent(variant));
        expect(decodeStoredEventRowCached(testDb.db, row)).toEqual(original);
      }
      expect(decodeStoredEventRowCached(testDb.db, { ...row })).toEqual(
        original,
      );

      const operation = rows.find(
        (candidate) => candidate.type === "system/operation",
      );
      if (operation === undefined) {
        throw new Error("Expected a system operation row");
      }
      const threadScoped = decodeStoredEventRowCached(testDb.db, operation);
      const turnScoped: StoredEventRow = {
        ...operation,
        scopeKind: "turn",
        turnId: "turn-1",
      };
      const decodedTurnScoped = decodeStoredEventRowCached(
        testDb.db,
        turnScoped,
      );
      expect(decodedTurnScoped).not.toBe(threadScoped);
      expect(decodedTurnScoped).toEqual(parseStoredEvent(turnScoped));
    } finally {
      testDb.db.$client.close();
    }
  });

  it("throws for a row that does not parse and caches nothing", () => {
    const testDb = setup();
    try {
      const [row] = seedShapes(testDb);
      if (row === undefined) {
        throw new Error("Expected a seeded row");
      }
      const invalid = { ...row, id: "evt_invalid", data: "{not json" };
      const before = readStoredEventDecodeCacheSize(testDb.db);
      expect(() => decodeStoredEventRowCached(testDb.db, invalid)).toThrow(
        /is not valid JSON/u,
      );
      expect(() => decodeStoredEventRowCached(testDb.db, invalid)).toThrow(
        /is not valid JSON/u,
      );
      expect(readStoredEventDecodeCacheSize(testDb.db)).toEqual(before);
    } finally {
      testDb.db.$client.close();
    }
  });

  it("freezes cached events while the server suite enables the test seam", () => {
    const testDb = setup();
    try {
      const rows = seedShapes(testDb);
      const row = rows.find((candidate) => candidate.type === "turn/completed");
      if (row === undefined) {
        throw new Error("Expected a turn completion row");
      }
      const frozen = decodeStoredEventRowCached(testDb.db, row);
      expect(Object.isFrozen(frozen)).toBe(true);
      expect(() => {
        Object.assign(frozen, { threadId: "mutated" });
      }).toThrow(TypeError);

      setStoredEventDecodeCacheFreezeForTesting(false);
      try {
        clearStoredEventDecodeCache(testDb.db);
        const unfrozen = decodeStoredEventRowCached(testDb.db, row);
        expect(Object.isFrozen(unfrozen)).toBe(false);
        expect(() => {
          Object.assign(unfrozen, { threadId: "mutated" });
        }).not.toThrow();
      } finally {
        setStoredEventDecodeCacheFreezeForTesting(true);
      }
    } finally {
      testDb.db.$client.close();
    }
  });

  it("keeps entries and data characters under the caps across many threads", () => {
    const testDb = setup();
    try {
      const rowChars = 20_000;
      const rowsPerThread = 40;
      const threadCount = 20;
      const latestRows: StoredEventRow[] = [];
      for (let threadIndex = 0; threadIndex < threadCount; threadIndex += 1) {
        const thread = createThread(testDb.db, noopNotifier, {
          projectId: testDb.projectId,
          providerId: "codex",
        });
        const inputs: EventInput[] = [];
        for (let index = 0; index < rowsPerThread; index += 1) {
          inputs.push({
            data: JSON.stringify({ text: "x".repeat(rowChars) }),
            itemId: null,
            itemKind: null,
            parentToolCallId: null,
            scope: threadScope(),
            sequence: index + 1,
            threadId: thread.id,
            type: "system/manager/user_message",
          });
        }
        insertEvents(testDb.db, noopNotifier, inputs);
        const rows = listStoredEventRows(testDb.db, { threadId: thread.id });
        for (const row of rows) {
          decodeStoredEventRowCached(testDb.db, row);
          const size = readStoredEventDecodeCacheSize(testDb.db);
          expect(size.dataChars).toBeLessThanOrEqual(
            STORED_EVENT_DECODE_CACHE_MAX_DATA_CHARS,
          );
          expect(size.entryCount).toBeLessThanOrEqual(
            STORED_EVENT_DECODE_CACHE_MAX_ENTRIES,
          );
        }
        latestRows.splice(0, latestRows.length, ...rows);
      }
      const total = rowChars * rowsPerThread * threadCount;
      expect(total).toBeGreaterThan(STORED_EVENT_DECODE_CACHE_MAX_DATA_CHARS);
      const size = readStoredEventDecodeCacheSize(testDb.db);
      expect(size.dataChars).toBeGreaterThan(
        STORED_EVENT_DECODE_CACHE_MAX_DATA_CHARS / 4,
      );
      for (const row of latestRows) {
        const decoded = decodeStoredEventRowCached(testDb.db, { ...row });
        expect(decodeStoredEventRowCached(testDb.db, { ...row })).toBe(decoded);
      }
    } finally {
      testDb.db.$client.close();
    }
  }, 60_000);
});
