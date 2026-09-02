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

function setup() {
  const db = createMigratedConnection();
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

  it("copies a retained output without losing the full value", () => {
    const now = 1_800_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const { db, source, target } = setup();
    const output = "copy-" + "y".repeat(50_000);
    insertEvents(db, noopNotifier, [
      {
        createdAt: now,
        data: JSON.stringify({
          item: {
            id: "tool-1",
            result: output,
            status: "completed",
            tool: "read_many",
            type: "toolCall",
          },
        }),
        itemId: "tool-1",
        itemKind: "toolCall",
        parentToolCallId: null,
        scope: turnScope("turn-1"),
        sequence: 1,
        threadId: source.id,
        type: "item/completed",
      },
    ]);
    const sourceRows = listStoredEventRows(db, { threadId: source.id });

    db.transaction(
      (tx) =>
        copyStoredThreadEventsInTransaction(tx, {
          rows: sourceRows,
          targetEnvironmentId: null,
          targetThreadId: target.id,
        }),
      { behavior: "immediate" },
    );

    const targetRows = listStoredEventRows(db, { threadId: target.id });
    const [hydratedTarget] = hydrateRetainedEventOutputRows(
      db,
      targetRows,
      now,
    );
    expect(hydratedTarget && readOutput(hydratedTarget.data, "result")).toBe(
      output,
    );
    expect(targetRows[0]?.data).not.toContain(output);
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
    ).toEqual({ deleted: 1 });
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
