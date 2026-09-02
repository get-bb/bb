import { turnScope } from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  copyStoredThreadEventsInTransaction,
  insertEvents,
  listStoredEventRows,
} from "../../src/data/events.js";
import type { InsertEventInput } from "../../src/data/events.js";
import { upsertHost } from "../../src/data/hosts.js";
import { createProject } from "../../src/data/projects.js";
import {
  deleteExpiredRetainedEventOutputs,
  hydrateRetainedEventOutputRows,
  hydrateRetainedEventOutputRowsWithinDataByteLimit,
} from "../../src/data/retained-event-outputs.js";
import {
  COMPLETED_EVENT_OUTPUT_RETAINED_HEAD_CHARS,
  COMPLETED_EVENT_OUTPUT_RETAINED_TAIL_CHARS,
  COMPLETED_EVENT_OUTPUT_RETENTION_MS,
  COMPLETED_EVENT_OUTPUT_TRUNCATION_THRESHOLD_CHARS,
} from "../../src/data/sweeps.js";
import { createThread } from "../../src/data/threads.js";
import { noopNotifier } from "../../src/notifier.js";
import { createMigratedConnection } from "../helpers/migrated-connection.js";
import type {
  CreateConnectionOptions,
  SlowDbQueryLogFields,
} from "../../src/connection.js";

function setup(options: CreateConnectionOptions = {}) {
  const db = createMigratedConnection(options);
  const host = upsertHost(db, noopNotifier, {
    name: "retained-output-host",
    type: "persistent",
  });
  const { project } = createProject(db, noopNotifier, {
    name: "retained-output-project",
    source: {
      type: "local_path",
      hostId: host.id,
      path: "/tmp/retained-output",
    },
  });
  const source = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "codex",
  });
  const target = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "codex",
  });
  return { db, source, target };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOutput(data: string, path: string): string {
  const parsed: unknown = JSON.parse(data);
  if (!isRecord(parsed) || !isRecord(parsed.item)) {
    throw new Error(`Expected string output at ${path}`);
  }
  const output = parsed.item[path];
  if (typeof output !== "string") {
    throw new Error(`Expected string output at ${path}`);
  }
  return output;
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        return true;
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("retained completed-event outputs", () => {
  it("stores a bounded preview and hydrates the full output until expiry", () => {
    const now = 1_800_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const { db, source } = setup();
    const output =
      "head-" +
      "x".repeat(COMPLETED_EVENT_OUTPUT_TRUNCATION_THRESHOLD_CHARS) +
      "-tail";

    insertEvents(db, noopNotifier, [
      {
        createdAt: now,
        data: JSON.stringify({
          item: {
            aggregatedOutput: output,
            approvalStatus: null,
            command: "cat large",
            cwd: "/tmp/retained-output",
            exitCode: 0,
            id: "command-1",
            status: "completed",
            type: "commandExecution",
          },
        }),
        itemId: "command-1",
        itemKind: "commandExecution",
        parentToolCallId: null,
        scope: turnScope("turn-1"),
        sequence: 1,
        threadId: source.id,
        type: "item/completed",
      },
    ]);

    const [stored] = listStoredEventRows(db, { threadId: source.id });
    if (!stored) {
      throw new Error("Expected stored event");
    }
    const preview = readOutput(stored.data, "aggregatedOutput");
    expect(preview).not.toBe(output);
    expect(preview.startsWith(output.slice(0, 2_048))).toBe(true);
    expect(preview.endsWith(output.slice(-2_048))).toBe(true);
    expect(preview.length).toBe(
      COMPLETED_EVENT_OUTPUT_RETAINED_HEAD_CHARS +
        COMPLETED_EVENT_OUTPUT_RETAINED_TAIL_CHARS +
        77,
    );

    const [hydrated] = hydrateRetainedEventOutputRows(db, [stored], now);
    expect(hydrated && readOutput(hydrated.data, "aggregatedOutput")).toBe(
      output,
    );
    expect(JSON.parse(hydrated?.data ?? "{}").item.truncation).toBeUndefined();

    const [expired] = hydrateRetainedEventOutputRows(
      db,
      [stored],
      now + COMPLETED_EVENT_OUTPUT_RETENTION_MS,
    );
    expect(expired?.data).toBe(stored.data);
    db.$client.close();
  });

  it("keeps both preview boundaries on complete Unicode characters", () => {
    const now = 1_800_000_000_000;
    const { db, source } = setup();
    const headBoundaryOutput =
      "h".repeat(COMPLETED_EVENT_OUTPUT_RETAINED_HEAD_CHARS - 1) +
      "😀" +
      "m".repeat(COMPLETED_EVENT_OUTPUT_TRUNCATION_THRESHOLD_CHARS);
    const tailBoundaryOutput =
      "m".repeat(COMPLETED_EVENT_OUTPUT_TRUNCATION_THRESHOLD_CHARS) +
      "😀" +
      "t".repeat(COMPLETED_EVENT_OUTPUT_RETAINED_TAIL_CHARS - 1);

    insertEvents(
      db,
      noopNotifier,
      [headBoundaryOutput, tailBoundaryOutput].map((output, index) => ({
        createdAt: now,
        data: JSON.stringify({
          item: {
            aggregatedOutput: output,
            id: `unicode-command-${index}`,
            type: "commandExecution" as const,
          },
        }),
        itemId: `unicode-command-${index}`,
        itemKind: "commandExecution" as const,
        parentToolCallId: null,
        scope: turnScope("turn-unicode"),
        sequence: index + 1,
        threadId: source.id,
        type: "item/completed" as const,
      })),
    );

    const storedRows = listStoredEventRows(db, { threadId: source.id });
    const previews = storedRows.map((row) =>
      readOutput(row.data, "aggregatedOutput"),
    );
    expect(previews).toHaveLength(2);
    for (const preview of previews) {
      expect(hasUnpairedSurrogate(preview)).toBe(false);
      expect(Buffer.from(preview).toString()).not.toContain("�");
    }
    expect(
      storedRows.map(
        (row) =>
          JSON.parse(row.data).item.truncation.aggregatedOutput
            .retainedHeadLength,
      ),
    ).toEqual([COMPLETED_EVENT_OUTPUT_RETAINED_HEAD_CHARS - 1, 2_048]);
    expect(
      storedRows.map(
        (row) =>
          JSON.parse(row.data).item.truncation.aggregatedOutput
            .retainedTailLength,
      ),
    ).toEqual([2_048, COMPLETED_EVENT_OUTPUT_RETAINED_TAIL_CHARS - 1]);
    db.$client.close();
  });

  it("preserves lone high and low surrogates in retained values", () => {
    const now = 1_800_000_000_000;
    const { db, source } = setup();
    const output =
      "head-\ud800-middle-\udc00-" +
      "x".repeat(COMPLETED_EVENT_OUTPUT_TRUNCATION_THRESHOLD_CHARS);
    insertEvents(db, noopNotifier, [
      {
        createdAt: now,
        data: JSON.stringify({
          item: {
            aggregatedOutput: output,
            id: "surrogate-command",
            type: "commandExecution",
          },
        }),
        itemId: "surrogate-command",
        itemKind: "commandExecution",
        parentToolCallId: null,
        scope: turnScope("turn-surrogate"),
        sequence: 1,
        threadId: source.id,
        type: "item/completed",
      },
    ]);

    const stored = listStoredEventRows(db, { threadId: source.id });
    const [hydrated] = hydrateRetainedEventOutputRows(db, stored, now);
    expect(hydrated && readOutput(hydrated.data, "aggregatedOutput")).toBe(
      output,
    );
    db.$client.close();
  });

  it("hydrates retained outputs only when they fit the data byte budget", () => {
    const now = 1_800_000_000_000;
    const { db, source } = setup();
    const output = "bounded-" + "b".repeat(5 * 1024 * 1024);
    insertEvents(db, noopNotifier, [
      {
        createdAt: now,
        data: JSON.stringify({
          item: {
            aggregatedOutput: output,
            id: "bounded-command",
            type: "commandExecution",
          },
        }),
        itemId: "bounded-command",
        itemKind: "commandExecution",
        parentToolCallId: null,
        scope: turnScope("turn-bounded"),
        sequence: 1,
        threadId: source.id,
        type: "item/completed",
      },
    ]);
    const stored = listStoredEventRows(db, { threadId: source.id });

    expect(
      hydrateRetainedEventOutputRowsWithinDataByteLimit(
        db,
        stored,
        4 * 1024 * 1024,
        now,
      ),
    ).toEqual(stored);
    const [hydrated] = hydrateRetainedEventOutputRowsWithinDataByteLimit(
      db,
      stored,
      8 * 1024 * 1024,
      now,
    );
    expect(hydrated && readOutput(hydrated.data, "aggregatedOutput")).toBe(
      output,
    );

    const exactHydratedRows = hydrateRetainedEventOutputRows(db, stored, now);
    const exactHydratedBytes = exactHydratedRows.reduce(
      (total, row) => total + Buffer.byteLength(row.data),
      0,
    );
    expect(
      hydrateRetainedEventOutputRowsWithinDataByteLimit(
        db,
        stored,
        exactHydratedBytes,
        now,
      ),
    ).toEqual(exactHydratedRows);
    expect(
      hydrateRetainedEventOutputRowsWithinDataByteLimit(
        db,
        stored,
        exactHydratedBytes - 1,
        now,
      ),
    ).toEqual(stored);
    db.$client.close();
  });

  it("rolls back the event when its retained output cannot be inserted", () => {
    const now = 1_800_000_000_000;
    const { db, source } = setup();
    const output = "atomic-" + "a".repeat(50_000);
    db.$client.exec(`
      CREATE TRIGGER fail_retained_output_insert
      BEFORE INSERT ON retained_event_outputs
      BEGIN
        SELECT RAISE(ABORT, 'forced retained output failure');
      END
    `);

    expect(() =>
      insertEvents(db, noopNotifier, [
        {
          createdAt: now,
          data: JSON.stringify({
            item: {
              aggregatedOutput: output,
              id: "atomic-command",
              type: "commandExecution",
            },
          }),
          itemId: "atomic-command",
          itemKind: "commandExecution",
          parentToolCallId: null,
          scope: turnScope("turn-atomic"),
          sequence: 1,
          threadId: source.id,
          type: "item/completed",
        },
      ]),
    ).toThrow("forced retained output failure");
    expect(listStoredEventRows(db, { threadId: source.id })).toEqual([]);
    db.$client.close();
  });

  it("copies many retained outputs without selecting their full values", () => {
    const now = 1_800_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const queries: SlowDbQueryLogFields[] = [];
    const { db, source, target } = setup({
      slowQueryLogger: {
        info(fields) {
          queries.push(fields);
        },
      },
      slowQueryThresholdMs: 0,
    });
    const outputs = Array.from(
      { length: 6 },
      (_, index) => `copy-${index}-` + "y".repeat(2 * 1024 * 1024),
    );
    insertEvents(
      db,
      noopNotifier,
      outputs.map((output, index) => ({
        createdAt: now,
        data: JSON.stringify({
          item: {
            id: `tool-${index}`,
            result: output,
            status: "completed",
            tool: "read_many",
            type: "toolCall",
          },
        }),
        itemId: `tool-${index}`,
        itemKind: "toolCall",
        parentToolCallId: null,
        scope: turnScope("turn-1"),
        sequence: index + 1,
        threadId: source.id,
        type: "item/completed",
      })),
    );
    const sourceRows = listStoredEventRows(db, { threadId: source.id });
    queries.length = 0;

    db.transaction(
      (tx) =>
        copyStoredThreadEventsInTransaction(tx, {
          rows: sourceRows,
          targetEnvironmentId: null,
          targetThreadId: target.id,
        }),
      { behavior: "immediate" },
    );

    expect(
      queries.some(
        (query) =>
          query.operation !== "run" &&
          query.sql.includes("retained_event_outputs") &&
          query.sql.includes("value"),
      ),
    ).toBe(false);
    const targetRows = listStoredEventRows(db, { threadId: target.id });
    expect(targetRows).toHaveLength(outputs.length);
    expect(targetRows.every((row) => row.data.length < 10_000)).toBe(true);
    const hydratedTargets = hydrateRetainedEventOutputRows(db, targetRows, now);
    expect(
      hydratedTargets.map((row) => readOutput(row.data, "result")),
    ).toEqual(outputs);
    expect(
      targetRows.every(
        (row, index) => !row.data.includes(outputs[index] ?? ""),
      ),
    ).toBe(true);
    db.$client.close();
  });

  it("deletes a bounded number of expired sidecars without deleting previews", () => {
    const now = 1_800_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const { db, source } = setup();
    const output = "z".repeat(50_000);
    const eventInputs: InsertEventInput[] = [1, 2].map((sequence) => ({
      createdAt: now,
      data: JSON.stringify({
        item: {
          aggregatedOutput: output,
          id: `command-${sequence}`,
          type: "commandExecution",
        },
      }),
      itemId: `command-${sequence}`,
      itemKind: "commandExecution",
      parentToolCallId: null,
      scope: turnScope("turn-1"),
      sequence,
      threadId: source.id,
      type: "item/completed",
    }));
    insertEvents(db, noopNotifier, eventInputs);
    const previews = listStoredEventRows(db, { threadId: source.id });

    expect(
      deleteExpiredRetainedEventOutputs(db, {
        expiredAtOrBefore: now + COMPLETED_EVENT_OUTPUT_RETENTION_MS,
        limit: 1,
      }),
    ).toEqual({ deleted: 1, threadIds: [source.id] });
    expect(listStoredEventRows(db, { threadId: source.id })).toEqual(previews);
    const hydrated = hydrateRetainedEventOutputRows(db, previews, now);
    expect(
      hydrated.filter(
        (row) => readOutput(row.data, "aggregatedOutput") === output,
      ),
    ).toHaveLength(1);
    db.$client.close();
  });
});
