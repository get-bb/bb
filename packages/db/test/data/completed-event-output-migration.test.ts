import { turnScope } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { createConnection, type DbConnection } from "../../src/connection.js";
import { listStoredEventRows } from "../../src/data/events.js";
import { upsertHost } from "../../src/data/hosts.js";
import { createProject } from "../../src/data/projects.js";
import {
  hydrateRetainedEventOutputRows,
  RETAINED_EVENT_OUTPUT_TARGETS,
  type RetainedEventOutputTarget,
} from "../../src/data/retained-event-outputs.js";
import {
  COMPLETED_EVENT_OUTPUT_RETENTION_MS,
  COMPLETED_EVENT_OUTPUT_TRUNCATION_THRESHOLD_CHARS,
  migrateNextCompletedEventItemOutput,
} from "../../src/data/sweeps.js";
import { createThread } from "../../src/data/threads.js";
import { noopNotifier } from "../../src/notifier.js";
import {
  events,
  maintenanceScanCursors,
  retainedEventOutputs,
} from "../../src/schema.js";
import { createMigratedConnection } from "../helpers/migrated-connection.js";

function setup() {
  const db = createMigratedConnection();
  const host = upsertHost(db, noopNotifier, {
    name: "completed-output-migration-host",
    type: "persistent",
  });
  const { project } = createProject(db, noopNotifier, {
    name: "completed-output-migration-project",
    source: {
      hostId: host.id,
      path: "/tmp/completed-output-migration",
      type: "local_path",
    },
  });
  const thread = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "codex",
  });
  return { db, thread };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOutput(data: string, outputPath: string): string {
  const value: unknown = JSON.parse(data);
  if (
    !isRecord(value) ||
    !isRecord(value.item) ||
    typeof value.item[outputPath] !== "string"
  ) {
    throw new Error(`Expected string output at ${outputPath}`);
  }
  return value.item[outputPath];
}

interface InsertLegacyOutputArgs extends RetainedEventOutputTarget {
  createdAt: number;
  data?: string;
  db: DbConnection;
  eventId: string;
  itemType?: string;
  output: string;
  sequence: number;
  threadId: string;
  truncation?: Record<string, unknown>;
}

function insertLegacyOutput(args: InsertLegacyOutputArgs): void {
  const itemId = `${args.eventId}-item`;
  args.db
    .insert(events)
    .values({
      createdAt: args.createdAt,
      data:
        args.data ??
        JSON.stringify({
          item: {
            [args.outputPath]: args.output,
            id: itemId,
            truncation: args.truncation,
            type: args.itemType ?? args.itemKind,
          },
        }),
      id: args.eventId,
      itemId,
      itemKind: args.itemKind,
      parentToolCallId: null,
      providerThreadId: null,
      scopeKind: turnScope(`turn-${args.eventId}`).kind,
      sequence: args.sequence,
      threadId: args.threadId,
      turnId: `turn-${args.eventId}`,
      type: "item/completed",
    })
    .run();
}

function migrateCommandOutput(db: DbConnection, migratedAt: number) {
  return migrateNextCompletedEventItemOutput(db, {
    itemKind: "commandExecution",
    limit: 10,
    migratedAt,
    outputPath: "aggregatedOutput",
  });
}

describe("completed event output migration", () => {
  it("migrates one retained legacy inline output without changing raw reads", () => {
    const migratedAt = 1_800_000_000_000;
    const createdAt = migratedAt - 60_000;
    const output =
      "legacy-head-" +
      "x".repeat(COMPLETED_EVENT_OUTPUT_TRUNCATION_THRESHOLD_CHARS) +
      "-legacy-tail";
    const { db, thread } = setup();
    insertLegacyOutput({
      createdAt,
      db,
      eventId: "evt_legacy_command",
      itemKind: "commandExecution",
      output,
      outputPath: "aggregatedOutput",
      sequence: 1,
      threadId: thread.id,
    });

    expect(
      migrateNextCompletedEventItemOutput(db, {
        itemKind: "commandExecution",
        limit: 10,
        migratedAt,
        outputPath: "aggregatedOutput",
      }),
    ).toMatchObject({
      action: "migrated",
      eventId: "evt_legacy_command",
      migratedRows: 1,
      retained: true,
      threadId: thread.id,
    });

    const [stored] = listStoredEventRows(db, { threadId: thread.id });
    if (!stored) {
      throw new Error("Expected migrated event");
    }
    expect(readOutput(stored.data, "aggregatedOutput")).not.toBe(output);
    const [hydrated] = hydrateRetainedEventOutputRows(db, [stored], migratedAt);
    expect(hydrated && readOutput(hydrated.data, "aggregatedOutput")).toBe(
      output,
    );
    db.$client.close();
  });

  it("migrates every authoritative output path one row at a time", () => {
    const migratedAt = 1_800_000_000_000;
    const output = "p".repeat(
      COMPLETED_EVENT_OUTPUT_TRUNCATION_THRESHOLD_CHARS + 1,
    );
    const { db, thread } = setup();
    for (const [index, target] of RETAINED_EVENT_OUTPUT_TARGETS.entries()) {
      insertLegacyOutput({
        ...target,
        createdAt: migratedAt - 1,
        db,
        eventId: `evt_path_${index}`,
        output: `${target.itemKind}-${output}`,
        sequence: index + 1,
        threadId: thread.id,
      });
    }

    for (const [index, target] of RETAINED_EVENT_OUTPUT_TARGETS.entries()) {
      expect(
        migrateNextCompletedEventItemOutput(db, {
          ...target,
          limit: 10,
          migratedAt,
        }),
      ).toMatchObject({
        action: "migrated",
        eventId: `evt_path_${index}`,
        migratedRows: 1,
        retained: true,
      });
    }

    expect(db.select().from(retainedEventOutputs).all()).toHaveLength(4);
    const stored = listStoredEventRows(db, { threadId: thread.id });
    const hydrated = hydrateRetainedEventOutputRows(db, stored, migratedAt);
    for (const [index, target] of RETAINED_EVENT_OUTPUT_TARGETS.entries()) {
      const row = hydrated.find(
        (candidate) => candidate.id === `evt_path_${index}`,
      );
      expect(row && readOutput(row.data, target.outputPath)).toBe(
        `${target.itemKind}-${output}`,
      );
    }
    db.$client.close();
  });

  it("previews an already expired output without retaining a sidecar", () => {
    const migratedAt = 1_800_000_000_000;
    const createdAt = migratedAt - COMPLETED_EVENT_OUTPUT_RETENTION_MS;
    const output = "expired-" + "e".repeat(40_000);
    const { db, thread } = setup();
    insertLegacyOutput({
      createdAt,
      db,
      eventId: "evt_expired",
      itemKind: "commandExecution",
      output,
      outputPath: "aggregatedOutput",
      sequence: 1,
      threadId: thread.id,
    });

    expect(migrateCommandOutput(db, migratedAt)).toMatchObject({
      action: "migrated",
      migratedRows: 1,
      retained: false,
    });
    expect(db.select().from(retainedEventOutputs).all()).toEqual([]);
    const [stored] = listStoredEventRows(db, { threadId: thread.id });
    if (!stored) {
      throw new Error("Expected expired migrated event");
    }
    expect(readOutput(stored.data, "aggregatedOutput")).not.toBe(output);
    expect(
      hydrateRetainedEventOutputRows(db, [stored], migratedAt)[0]?.data,
    ).toBe(stored.data);
    expect(
      JSON.parse(stored.data).item.truncation.aggregatedOutput.truncatedAt,
    ).toBe(createdAt + COMPLETED_EVENT_OUTPUT_RETENTION_MS);
    db.$client.close();
  });

  it("skips malformed, extension, small, and already previewed rows", () => {
    const migratedAt = 1_800_000_000_000;
    const output = "s".repeat(40_000);
    const { db, thread } = setup();
    insertLegacyOutput({
      createdAt: migratedAt - 4,
      data: "{malformed",
      db,
      eventId: "evt_skip_1_malformed",
      itemKind: "commandExecution",
      output,
      outputPath: "aggregatedOutput",
      sequence: 1,
      threadId: thread.id,
    });
    insertLegacyOutput({
      createdAt: migratedAt - 3,
      db,
      eventId: "evt_skip_2_extension",
      itemKind: "commandExecution",
      itemType: "extensionItem",
      output,
      outputPath: "aggregatedOutput",
      sequence: 2,
      threadId: thread.id,
    });
    insertLegacyOutput({
      createdAt: migratedAt - 2,
      db,
      eventId: "evt_skip_3_small",
      itemKind: "commandExecution",
      output: "small",
      outputPath: "aggregatedOutput",
      sequence: 3,
      threadId: thread.id,
    });
    insertLegacyOutput({
      createdAt: migratedAt - 1,
      db,
      eventId: "evt_skip_4_previewed",
      itemKind: "commandExecution",
      output,
      outputPath: "aggregatedOutput",
      sequence: 4,
      threadId: thread.id,
      truncation: { aggregatedOutput: { originalLength: output.length } },
    });

    expect(migrateCommandOutput(db, migratedAt)).toEqual({
      action: "scanned",
      eventId: null,
      migratedBytes: 0,
      migratedRows: 0,
      retained: false,
      scanRows: 4,
      threadId: null,
    });
    expect(db.select().from(retainedEventOutputs).all()).toEqual([]);
    db.$client.close();
  });

  it("persists progress across an in-memory database restart", () => {
    const migratedAt = 1_800_000_000_000;
    const output = "r".repeat(40_000);
    const setupResult = setup();
    for (const sequence of [1, 2]) {
      insertLegacyOutput({
        createdAt: migratedAt - 1,
        db: setupResult.db,
        eventId: `evt_restart_${sequence}`,
        itemKind: "commandExecution",
        output: `${sequence}-${output}`,
        outputPath: "aggregatedOutput",
        sequence,
        threadId: setupResult.thread.id,
      });
    }
    expect(migrateCommandOutput(setupResult.db, migratedAt).eventId).toBe(
      "evt_restart_1",
    );
    const serialized = setupResult.db.$client.serialize();
    setupResult.db.$client.close();

    const restarted = createConnection(serialized);
    expect(migrateCommandOutput(restarted, migratedAt).eventId).toBe(
      "evt_restart_2",
    );
    expect(restarted.select().from(retainedEventOutputs).all()).toHaveLength(2);
    restarted.$client.close();
  });

  it("wraps the cursor and finds a row inserted behind it", () => {
    const migratedAt = 1_800_000_000_000;
    const output = "w".repeat(40_000);
    const { db, thread } = setup();
    insertLegacyOutput({
      createdAt: migratedAt - 1,
      db,
      eventId: "evt_wrap_later",
      itemKind: "commandExecution",
      output,
      outputPath: "aggregatedOutput",
      sequence: 1,
      threadId: thread.id,
    });
    expect(migrateCommandOutput(db, migratedAt).eventId).toBe("evt_wrap_later");
    expect(migrateCommandOutput(db, migratedAt).action).toBe("wrapped");
    insertLegacyOutput({
      createdAt: migratedAt - 2,
      db,
      eventId: "evt_wrap_earlier",
      itemKind: "commandExecution",
      output,
      outputPath: "aggregatedOutput",
      sequence: 2,
      threadId: thread.id,
    });
    expect(migrateCommandOutput(db, migratedAt).eventId).toBe(
      "evt_wrap_earlier",
    );
    db.$client.close();
  });

  it("does not reuse the superseded bulk truncation cursor", () => {
    const migratedAt = 1_800_000_000_000;
    const { db, thread } = setup();
    db.insert(maintenanceScanCursors)
      .values({
        id: "completed_event_output_truncation:v1:commandExecution:aggregatedOutput",
        itemKind: "commandExecution",
        lastCreatedAt: migratedAt,
        lastEventId: "z",
        outputPath: "aggregatedOutput",
        policy: "completed_event_output_truncation",
        updatedAt: migratedAt,
        version: 1,
      })
      .run();
    insertLegacyOutput({
      createdAt: migratedAt - 1,
      db,
      eventId: "evt_new_cursor",
      itemKind: "commandExecution",
      output: "c".repeat(40_000),
      outputPath: "aggregatedOutput",
      sequence: 1,
      threadId: thread.id,
    });

    expect(migrateCommandOutput(db, migratedAt).eventId).toBe("evt_new_cursor");
    expect(db.select().from(maintenanceScanCursors).all()).toHaveLength(2);
    db.$client.close();
  });
});
