import { afterEach, describe, expect, it } from "vitest";
import { turnScope, type ThreadEventType } from "@bb/domain";
import type { DbConnection } from "../../src/connection.js";
import { PROVIDER_UNHANDLED_EVENT_MAX_BYTES } from "../../src/data/event-storage-rules.js";
import {
  insertEvents,
  listAppendedEventRows,
  type InsertEventInput,
} from "../../src/data/events.js";
import { upsertHost } from "../../src/data/hosts.js";
import { createProject } from "../../src/data/projects.js";
import { createThread } from "../../src/data/threads.js";
import { noopNotifier } from "../../src/notifier.js";
import { createMigratedConnection } from "../../src/testing.js";

let db: DbConnection;

afterEach(() => {
  db.$client.close();
});

function setup(): string {
  db = createMigratedConnection();
  const host = upsertHost(db, noopNotifier, { name: "rules-host" });
  const { project } = createProject(db, noopNotifier, {
    name: "rules-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/rules" },
  });
  return createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "codex",
  }).id;
}

function event(
  threadId: string,
  sequence: number,
  type: ThreadEventType,
  data: Record<string, unknown>,
  item: { id: string; kind: "fileChange" } | null = null,
): InsertEventInput {
  return {
    data: JSON.stringify(data),
    itemId: item?.id ?? null,
    itemKind: item?.kind ?? null,
    parentToolCallId: null,
    scope: turnScope("turn-1"),
    sequence,
    threadId,
    type,
  };
}

function unhandled(
  threadId: string,
  sequence: number,
  rawType: string,
  params: unknown,
): InsertEventInput {
  return event(threadId, sequence, "provider/unhandled", {
    providerThreadId: "prov-1",
    providerId: "pi",
    rawType,
    rawEvent: { jsonrpc: "2.0", method: "sdk/message", params },
  });
}

function fileChange(
  threadId: string,
  sequence: number,
  type: "item/started" | "item/completed",
  changes: { path: string; diff?: string }[],
): InsertEventInput {
  return event(
    threadId,
    sequence,
    type,
    {
      providerThreadId: "prov-1",
      item: {
        type: "fileChange",
        id: "edit-1",
        status: type === "item/started" ? "pending" : "completed",
        approvalStatus: null,
        changes: changes.map((change) => ({ kind: "update", ...change })),
      },
    },
    { id: "edit-1", kind: "fileChange" },
  );
}

function rows(threadId: string) {
  return listAppendedEventRows(db, {
    afterSequence: 0,
    limit: 100,
    maxInlineOutputChars: null,
    threadId,
    throughSequence: 100,
  });
}

function storedData(threadId: string, sequence: number): unknown {
  const row = db.$client
    .prepare("SELECT data FROM events WHERE thread_id = ? AND sequence = ?")
    .get(threadId, sequence) as { data: string };
  return JSON.parse(row.data);
}

describe("provider/unhandled cap", () => {
  it("stores a row at the cap unchanged", () => {
    const threadId = setup();
    const small = unhandled(threadId, 1, "sdk/message_end", { note: "" });
    const padding = PROVIDER_UNHANDLED_EVENT_MAX_BYTES - Buffer.byteLength(small.data);
    const atCap = unhandled(threadId, 1, "sdk/message_end", {
      note: "x".repeat(padding),
    });
    expect(Buffer.byteLength(atCap.data)).toBe(PROVIDER_UNHANDLED_EVENT_MAX_BYTES);
    insertEvents(db, noopNotifier, [atCap]);
    expect(storedData(threadId, 1)).toEqual(JSON.parse(atCap.data));
  });

  it("omits the largest params fields of an oversized row and keeps the rest", () => {
    const threadId = setup();
    const params = {
      kind: "system",
      message: { role: "system", sections: "s".repeat(200 * 1024) },
      tools: "t".repeat(40 * 1024),
      reason: "r".repeat(4 * 1024),
    };
    insertEvents(db, noopNotifier, [
      unhandled(threadId, 1, "sdk/message_start", params),
    ]);
    const stored = storedData(threadId, 1) as {
      rawType: string;
      rawEvent: { method: string; params: Record<string, unknown> };
    };
    expect(stored.rawType).toBe("sdk/message_start");
    expect(stored.rawEvent.method).toBe("sdk/message");
    expect(stored.rawEvent.params).toEqual({
      kind: "system",
      tools: params.tools,
      reason: params.reason,
      payloadOmitted: true,
      payloadBytes: Buffer.byteLength(JSON.stringify(params)),
    });
    expect(Buffer.byteLength(JSON.stringify(stored))).toBeLessThanOrEqual(
      PROVIDER_UNHANDLED_EVENT_MAX_BYTES,
    );
  });

  it("bounds the row when its labels alone exceed the cap", () => {
    const threadId = setup();
    insertEvents(db, noopNotifier, [
      unhandled(threadId, 1, "x".repeat(100 * 1024), ["a".repeat(10)]),
    ]);
    const stored = storedData(threadId, 1) as {
      rawType: string;
      rawEvent: { params: unknown };
    };
    expect(stored.rawType).toBe("x".repeat(1024));
    expect(stored.rawEvent.params).toEqual({
      payloadOmitted: true,
      payloadBytes: Buffer.byteLength(JSON.stringify(["a".repeat(10)])),
    });
  });
});

const SAME_DIFF = `@@ -1 +1 @@\n-${"a".repeat(40)}\n+${"b".repeat(40)}\n`;
const PROPOSED_DIFF = `@@ -1 +1 @@\n-${"a".repeat(40)}\n+${"c".repeat(40)}\n`;
const APPLIED_DIFF = `@@ -1 +1 @@\n-${"a".repeat(40)}\n+${"d".repeat(40)}\n`;

function itemEvent(
  threadId: string,
  sequence: number,
  type: "item/started" | "item/completed",
  item: Record<string, unknown>,
): InsertEventInput {
  return event(
    threadId,
    sequence,
    type,
    { providerThreadId: "prov-1", item },
    { id: String(item.id), kind: item.type as "fileChange" },
  );
}

describe("settled started fields", () => {
  it("strips the started diffs a completion repeats verbatim, keeps a set that differs, and reads see the stripped row", () => {
    const threadId = setup();
    insertEvents(db, noopNotifier, [
      fileChange(threadId, 1, "item/started", [
        { path: "a.ts", diff: SAME_DIFF },
        { path: "b.ts", diff: PROPOSED_DIFF },
        { path: "c.ts", diff: SAME_DIFF },
      ]),
    ]);
    expect(rows(threadId)).toHaveLength(1);
    insertEvents(db, noopNotifier, [
      fileChange(threadId, 2, "item/completed", [
        { path: "a.ts", diff: SAME_DIFF },
        { path: "b.ts", diff: PROPOSED_DIFF },
        { path: "c.ts", diff: SAME_DIFF },
      ]),
    ]);
    const started = JSON.parse(rows(threadId)[0]!.data) as {
      item: { changes: { path: string; diff?: string }[] };
    };
    expect(started.item.changes).toEqual([
      { kind: "update", path: "a.ts" },
      { kind: "update", path: "b.ts" },
      { kind: "update", path: "c.ts" },
    ]);
    insertEvents(db, noopNotifier, [
      { ...fileChange(threadId, 3, "item/started", [
        { path: "a.ts", diff: SAME_DIFF },
        { path: "b.ts", diff: PROPOSED_DIFF },
      ]), itemId: "edit-2" },
      { ...fileChange(threadId, 4, "item/completed", [
        { path: "a.ts", diff: SAME_DIFF },
        { path: "b.ts", diff: APPLIED_DIFF },
      ]), itemId: "edit-2" },
    ]);
    expect(storedData(threadId, 3)).toMatchObject({
      item: {
        changes: [
          { path: "a.ts", diff: SAME_DIFF },
          { path: "b.ts", diff: PROPOSED_DIFF },
        ],
      },
    });
    expect(storedData(threadId, 1)).toEqual(started);
  });

  it("keeps the started diff when the completion carries no diff", () => {
    const threadId = setup();
    insertEvents(db, noopNotifier, [
      fileChange(threadId, 1, "item/started", [
        { path: "a.ts", diff: SAME_DIFF },
      ]),
      fileChange(threadId, 2, "item/completed", []),
    ]);
    expect(storedData(threadId, 1)).toMatchObject({
      item: { changes: [{ path: "a.ts", diff: SAME_DIFF }] },
    });
  });

  it("strips repeated tool arguments, keeps differing ones, and keeps required and per-event fields", () => {
    const threadId = setup();
    const presentation = {
      label: { pending: "Running the build", completed: "Ran the build" },
      icon: { glyph: "Terminal" },
    };
    const toolArguments = { query: "q".repeat(80), limit: 10 };
    const command = `bash -lc '${"x".repeat(120)}'`;
    const commandItem = {
      type: "commandExecution",
      id: "cmd-1",
      command,
      cwd: "/tmp/rules",
      approvalStatus: null,
      presentation,
    };
    const toolItem = (id: string, args: Record<string, unknown>) => ({
      type: "toolCall",
      id,
      tool: "search",
      arguments: args,
    });
    insertEvents(db, noopNotifier, [
      itemEvent(threadId, 1, "item/started", { ...commandItem, status: "pending" }),
      itemEvent(threadId, 2, "item/started", {
        ...toolItem("tool-same", toolArguments),
        status: "pending",
      }),
      itemEvent(threadId, 3, "item/started", {
        ...toolItem("tool-changed", toolArguments),
        status: "pending",
      }),
      itemEvent(threadId, 4, "item/completed", {
        ...commandItem,
        status: "completed",
        aggregatedOutput: "ok",
      }),
      itemEvent(threadId, 5, "item/completed", {
        ...toolItem("tool-same", toolArguments),
        status: "completed",
      }),
      itemEvent(threadId, 6, "item/completed", {
        ...toolItem("tool-changed", { ...toolArguments, limit: 20 }),
        status: "completed",
      }),
    ]);
    expect(storedData(threadId, 1)).toEqual({
      providerThreadId: "prov-1",
      item: { ...commandItem, status: "pending" },
    });
    expect(storedData(threadId, 2)).toEqual({
      providerThreadId: "prov-1",
      item: { type: "toolCall", id: "tool-same", tool: "search", status: "pending" },
    });
    expect(storedData(threadId, 3)).toMatchObject({
      item: { arguments: toolArguments },
    });
  });
});
