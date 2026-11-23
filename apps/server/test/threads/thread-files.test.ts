import { chmod, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import zlib from "node:zlib";
import { eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquireProjectAttachmentOwnership,
  getThread,
  getThreadPurge,
  insertHiddenThreadRow,
  requestThreadPurge,
  threads,
} from "@bb/db";
import { readThreadTableRows } from "@bb/db/testing";
import { turnScope } from "@bb/domain";
import type {
  PluginHookName,
  ThreadDeleteFinalizeHookDecision,
} from "@get-bb/plugin-sdk";
import { createBbSdk } from "@bb/sdk/core";
import { createHttpTransport } from "@bb/sdk/node";
import {
  invokePluginInline,
  setPluginHookProvider,
  type PluginHookRegistration,
} from "../../src/services/plugins/plugin-hook-registry.js";
import { storeAttachment } from "../../src/services/projects/attachments.js";
import { holdThreadPurge } from "../../src/services/threads/thread-purge.js";
import { ThreadFileWriter } from "../../src/services/threads/thread-files/thread-file.js";
import { readJson } from "../helpers/json.js";
import {
  seedEvent,
  seedThreadFixture,
  seedThread,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";
import { runThreadPurges } from "../helpers/thread-purges.js";

const zstdDecompress = promisify(zlib.zstdDecompress);
const DAY_MS = 86_400_000;

interface StoredRow {
  id: string;
  sequence: number;
  type: string;
  data: string;
}

function allRows(harness: TestAppHarness, threadId: string): StoredRow[] {
  return harness.db.all<StoredRow>(
    sql`SELECT * FROM events WHERE thread_id = ${threadId} ORDER BY sequence`,
  );
}

function addConversation(
  harness: TestAppHarness,
  args: { archive?: boolean; environmentId: string; threadId: string },
) {
  seedThreadRuntimeState(harness.deps, {
    environmentId: args.environmentId,
    inputText: "Summarise the logs",
    providerThreadId: `provider-${args.threadId}`,
    threadId: args.threadId,
  });
  const turn = {
    threadId: args.threadId,
    environmentId: args.environmentId,
    providerThreadId: `provider-${args.threadId}`,
    scope: turnScope("turn-1"),
  };
  let sequence = 3;
  const next = () => sequence++;
  seedEvent(harness.deps, {
    ...turn,
    sequence: next(),
    type: "turn/started",
    data: {},
  });
  seedEvent(harness.deps, {
    ...turn,
    sequence: next(),
    type: "item/completed",
    data: {
      item: {
        type: "commandExecution",
        id: "command-1",
        command: "cat app.log",
        cwd: "/tmp/test",
        status: "completed",
        approvalStatus: null,
        aggregatedOutput: "line\n".repeat(400),
        exitCode: 0,
        truncation: {
          aggregatedOutput: {
            originalLength: 2000,
            retainedHeadLength: 2048,
            retainedTailLength: 2048,
            truncatedAt: 1,
          },
        },
      },
    },
  });
  seedEvent(harness.deps, {
    ...turn,
    sequence: next(),
    type: "item/completed",
    data: {
      item: {
        type: "agentMessage",
        id: "message-1",
        text: "The logs are clean.",
      },
    },
  });
  seedEvent(harness.deps, {
    ...turn,
    sequence: next(),
    type: "turn/completed",
    data: { status: "completed" },
  });
  harness.db.run(sql`
    UPDATE events
    SET data = replace(data, '"retainedHeadLength":2048', '"retainedHeadLength":2048.0')
    WHERE thread_id = ${args.threadId} AND item_id = 'command-1'
  `);
  if (args.archive ?? true) {
    harness.db
      .update(threads)
      .set({ archivedAt: Date.now() - 10 * DAY_MS })
      .where(eq(threads.id, args.threadId))
      .run();
  }
  harness.db.run(sql`DELETE FROM thread_pruning_work`);
}

function seedArchivedConversation(
  harness: TestAppHarness,
  options: { archive?: boolean } = {},
) {
  const fixture = seedThreadFixture(harness);
  addConversation(harness, {
    archive: options.archive,
    environmentId: fixture.environment.id,
    threadId: fixture.thread.id,
  });
  return fixture;
}

function countRows(
  harness: TestAppHarness,
  table: string,
  threadId: string,
): number {
  return (
    harness.db.get<{ n: number }>(
      sql`SELECT count(*) AS n FROM ${sql.identifier(table)} WHERE thread_id = ${threadId}`,
    )?.n ?? 0
  );
}

async function decodeThreadFile(bytes: Buffer): Promise<string[]> {
  const size = bytes.length;
  const tableLength = bytes.readUInt32LE(size - 12);
  const table = JSON.parse(
    bytes.subarray(size - 12 - tableLength, size - 12).toString(),
  ) as {
    frames: Array<{ compressedBytes: number; offset: number }>;
    headerBytes: number;
  };
  const regions = [
    bytes.subarray(0, table.headerBytes),
    ...table.frames.map((frame) =>
      bytes.subarray(frame.offset, frame.offset + frame.compressedBytes),
    ),
  ];
  const text = (
    await Promise.all(regions.map((region) => zstdDecompress(region)))
  )
    .map((buffer) => buffer.toString())
    .join("");
  return text.split("\n").filter((line) => line.length > 0);
}

interface SeekTableJson {
  formatVersion: number;
  frames: Array<{ offset: number }>;
}

function withSeekTable(
  bytes: Buffer,
  change: (table: SeekTableJson) => SeekTableJson,
): Buffer {
  const size = bytes.length;
  const tableLength = bytes.readUInt32LE(size - 12);
  const tableStart = size - 12 - tableLength;
  const table = JSON.parse(
    bytes.subarray(tableStart, size - 12).toString(),
  ) as SeekTableJson;
  const tableBytes = Buffer.from(JSON.stringify(change(table)));
  const trailer = Buffer.alloc(12);
  trailer.writeUInt32LE(tableBytes.length, 0);
  trailer.write("BBHSEEK1", 4, "ascii");
  const payload = Buffer.concat([tableBytes, trailer]);
  const frameHeader = Buffer.alloc(8);
  frameHeader.writeUInt32LE(0x184d2a5e, 0);
  frameHeader.writeUInt32LE(payload.length, 4);
  return Buffer.concat([
    bytes.subarray(0, tableStart - 8),
    frameHeader,
    payload,
  ]);
}

function sdkFor(harness: TestAppHarness) {
  return createBbSdk({
    transport: createHttpTransport({
      baseUrl: "http://localhost",
      runtime: "node",
      fetch: async (input, init) => harness.app.fetch(new Request(input, init)),
    }),
  });
}

function importThread(
  harness: TestAppHarness,
  bytes: Buffer,
): Promise<Response> {
  const form = new FormData();
  form.set("file", new Blob([Uint8Array.from(bytes)]), "thread.jsonl.zst");
  return Promise.resolve(
    harness.app.request("/api/v1/threads/import", {
      body: form,
      method: "POST",
    }),
  );
}

function hideAndRequestPurge(harness: TestAppHarness, threadId: string): void {
  const now = Date.now();
  harness.db
    .update(threads)
    .set({ deletedAt: now })
    .where(eq(threads.id, threadId))
    .run();
  requestThreadPurge(harness.db, { now, threadId });
}

function installPurgeHook(
  decide: (
    threadId: string,
  ) =>
    | ThreadDeleteFinalizeHookDecision
    | Promise<ThreadDeleteFinalizeHookDecision>,
  options: { loading?: () => boolean } = {},
): string[] {
  const asked: string[] = [];
  const registry: {
    [K in PluginHookName]: PluginHookRegistration<K>[];
  } = {
    "message.dispatch": [],
    "thread.delete_finalize": [
      {
        pluginId: "cold-storage-test",
        handler: async (context) => {
          asked.push(context.threadId);
          return decide(context.threadId);
        },
      },
    ],
  };
  setPluginHookProvider({
    listHooks: (hook) => registry[hook],
    invokeHook: (_registration, _label, run) => invokePluginInline(run),
    decisionTimeoutMs: 1_000,
    isLoadingPlugins: options.loading ?? (() => false),
  });
  return asked;
}

afterEach(() => {
  setPluginHookProvider(undefined);
});

async function exportBytes(
  harness: TestAppHarness,
  threadId: string,
): Promise<Buffer> {
  return Buffer.from(
    await sdkFor(harness).threads.experimental_export({ threadId }),
  );
}

describe("thread files", () => {
  it("writes the whole thread, its metadata and attachments to the file", async () => {
    await withTestHarness(async (harness) => {
      const { project, thread } = seedArchivedConversation(harness);
      const before = allRows(harness, thread.id);
      harness.db.run(sql`
        INSERT INTO thread_plugin_metadata (thread_id, plugin_id, metadata_json)
        VALUES (${thread.id}, 'example', '{"pr":42}')
      `);
      const attachment = await storeAttachment(
        harness.db,
        harness.config.dataDir,
        project.id,
        new File(["hello attachment"], "note.txt", { type: "text/plain" }),
      );
      acquireProjectAttachmentOwnership(harness.db, thread.id, [
        attachment.path,
      ]);

      const lines = await decodeThreadFile(
        await exportBytes(harness, thread.id),
      );

      expect(JSON.parse(lines[0] ?? "")).toMatchObject({
        kind: "header",
        format: "bb.thread",
        formatVersion: 1,
        threadId: thread.id,
        title: "Test Thread",
      });
      const kinds = lines.map(
        (line) => (JSON.parse(line) as { kind: string }).kind,
      );
      expect(kinds.filter((kind) => kind === "event")).toHaveLength(
        before.length,
      );
      expect(lines.join("\n")).toContain('"table":"threads"');
      expect(lines.join("\n")).toContain('"table":"thread_plugin_metadata"');
      expect(lines.join("\n")).toContain('"kind":"attachment"');
    });
  });

  it("brings a purged thread back byte-for-byte with its metadata and attachments", async () => {
    await withTestHarness(async (harness) => {
      const { project, thread } = seedArchivedConversation(harness);
      const before = allRows(harness, thread.id);
      const threadBefore = getThread(harness.db, thread.id);
      harness.db.run(sql`
        INSERT INTO thread_plugin_metadata (thread_id, plugin_id, metadata_json)
        VALUES (${thread.id}, 'example', '{"pr":42}')
      `);
      const attachment = await storeAttachment(
        harness.db,
        harness.config.dataDir,
        project.id,
        new File(["hello attachment"], "note.txt", { type: "text/plain" }),
      );
      acquireProjectAttachmentOwnership(harness.db, thread.id, [
        attachment.path,
      ]);
      harness.db.run(sql`
        INSERT INTO thread_dynamic_context_file_states
          (thread_id, file_key, content_status, content_hash, shown_at, created_at, updated_at)
        VALUES (${thread.id}, 'AGENTS.md', 'present', 'hash-1', 1, 1, 1)
      `);
      harness.db
        .update(threads)
        .set({ storageDeletedAt: Date.now() })
        .where(eq(threads.id, thread.id))
        .run();
      const bytes = await exportBytes(harness, thread.id);
      hideAndRequestPurge(harness, thread.id);
      await runThreadPurges(harness.deps);
      expect(getThread(harness.db, thread.id)).toBeNull();
      harness.db.run(sql`DELETE FROM project_attachments`);

      expect(
        await sdkFor(harness).threads.experimental_import({ file: bytes }),
      ).toEqual({
        threadId: thread.id,
        rows: before.length,
      });
      expect(allRows(harness, thread.id)).toEqual(before);
      expect(getThread(harness.db, thread.id)).toMatchObject({
        title: threadBefore?.title,
        deletedAt: null,
        storageDeletedAt: null,
      });
      expect(
        countRows(harness, "thread_dynamic_context_file_states", thread.id),
      ).toBe(1);
      expect(countRows(harness, "thread_pruning_work", thread.id)).toBe(1);
      expect(getThread(harness.db, thread.id)?.archivedAt).toBeGreaterThan(
        threadBefore?.archivedAt ?? Number.POSITIVE_INFINITY,
      );
      expect(getThreadPurge(harness.db, thread.id)).toBeNull();
      expect(
        harness.db.get<{ metadata: string }>(
          sql`SELECT metadata_json AS metadata FROM thread_plugin_metadata WHERE thread_id = ${thread.id}`,
        )?.metadata,
      ).toBe('{"pr":42}');
      expect(countRows(harness, "project_attachment_threads", thread.id)).toBe(
        1,
      );
    });
  });

  it("serves an imported thread's timeline the same as before it was purged", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedArchivedConversation(harness);
      const path = `/api/v1/threads/${thread.id}/timeline`;
      const before = await readJson(await harness.app.request(path));
      const bytes = await exportBytes(harness, thread.id);
      hideAndRequestPurge(harness, thread.id);
      await runThreadPurges(harness.deps);
      expect((await harness.app.request(path)).status).toBe(404);
      expect((await importThread(harness, bytes)).status).toBe(200);
      expect(await readJson(await harness.app.request(path))).toEqual(before);
    });
  });

  it("refuses to import a thread that still exists and leaves it untouched", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedArchivedConversation(harness);
      const bytes = await exportBytes(harness, thread.id);
      harness.db.run(
        sql`DELETE FROM events WHERE thread_id = ${thread.id} AND type = 'item/completed'`,
      );
      const remaining = allRows(harness, thread.id);
      const response = await importThread(harness, bytes);
      expect(response.status).toBe(409);
      expect(JSON.stringify(await readJson(response))).toContain(
        "thread_exists",
      );
      expect(allRows(harness, thread.id)).toEqual(remaining);
    });
  });

  it("rejects an unknown format version, a file that isn't a thread file, and a missing project", async () => {
    await withTestHarness(async (harness) => {
      const { project, thread } = seedArchivedConversation(harness);
      const bytes = await exportBytes(harness, thread.id);
      const newer = await importThread(
        harness,
        withSeekTable(bytes, (table) => ({ ...table, formatVersion: 2 })),
      );
      expect(newer.status).toBe(400);
      expect(JSON.stringify(await readJson(newer))).toContain(
        "format version 2",
      );
      expect(
        (await importThread(harness, Buffer.from("not a thread file"))).status,
      ).toBe(400);

      harness.db.delete(threads).where(eq(threads.id, thread.id)).run();
      harness.db.run(
        sql`UPDATE projects SET deleted_at = 1 WHERE id = ${project.id}`,
      );
      const missing = await importThread(harness, bytes);
      expect(missing.status).toBe(404);
      expect(JSON.stringify(await readJson(missing))).toContain(
        "another server",
      );
    });
  });

  it("rejects damaged files and rows from another project with 400, recreating nothing", async () => {
    await withTestHarness(async (harness) => {
      const { project, thread } = seedArchivedConversation(harness);
      const bytes = await exportBytes(harness, thread.id);
      const [threadRow] = readThreadTableRows(harness.db, thread.id).filter(
        (row) => row.table === "threads",
      );
      if (threadRow === undefined) throw new Error("no thread row");
      harness.db.delete(threads).where(eq(threads.id, thread.id)).run();

      const craft = async (
        fill: (writer: ThreadFileWriter) => void,
      ): Promise<Buffer> => {
        const path = join(harness.config.dataDir, `crafted-${Date.now()}`);
        const writer = await ThreadFileWriter.create({
          header: {
            archivedAt: null,
            createdAt: 1,
            exportedAt: 1,
            projectId: project.id,
            projectName: null,
            providerId: "codex",
            threadId: thread.id,
            title: null,
          },
          path,
        });
        fill(writer);
        await writer.seal();
        return readFile(path);
      };
      const sparseParts = await craft((writer) => {
        writer.addTableRows([threadRow]);
        writer.addAttachment({
          mimeType: null,
          originalName: "a.txt",
          parts: 2,
          sizeBytes: 1,
          storedPath: "a.txt",
        });
        writer.addAttachmentPart({
          data: Buffer.from("x"),
          index: 1,
          storedPath: "a.txt",
        });
      });
      const otherProject = await craft((writer) => {
        writer.addTableRows([
          {
            ...threadRow,
            values: { ...threadRow.values, project_id: "proj_other" },
          },
        ]);
      });
      const outOfBounds = withSeekTable(bytes, (table) => ({
        ...table,
        frames: table.frames.map((frame) => ({
          ...frame,
          offset: frame.offset + 1_000_000_000,
        })),
      }));

      for (const [file, message] of [
        [sparseParts, "missing parts of a.txt"],
        [otherProject, "from a project other than"],
        [outOfBounds, "invalid seek table"],
      ] as const) {
        const response = await importThread(harness, file);
        expect(response.status).toBe(400);
        expect(JSON.stringify(await readJson(response))).toContain(message);
        await runThreadPurges(harness.deps);
        expect(getThread(harness.db, thread.id)).toBeNull();
      }
    });
  });

  it("refuses to import into a thread that is still being deleted, then recreates it once purged", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedArchivedConversation(harness);
      const before = allRows(harness, thread.id);
      const bytes = await exportBytes(harness, thread.id);
      hideAndRequestPurge(harness, thread.id);

      const refused = await importThread(harness, bytes);
      expect(refused.status).toBe(409);
      expect(JSON.stringify(await readJson(refused))).toContain(
        "still being deleted",
      );

      await runThreadPurges(harness.deps);
      expect((await importThread(harness, bytes)).status).toBe(200);
      expect(allRows(harness, thread.id)).toEqual(before);
      expect(getThread(harness.db, thread.id)?.deletedAt).toBeNull();
    });
  });

  it("drops links to threads still being deleted, so their purge can finish", async () => {
    await withTestHarness(async (harness) => {
      const {
        project,
        environment,
        thread: owner,
      } = seedThreadFixture(harness);
      const owned = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });
      harness.db
        .update(threads)
        .set({
          lifecycleOwnerThreadId: owner.id,
          parentThreadId: owner.id,
          sourceThreadId: owner.id,
        })
        .where(eq(threads.id, owned.id))
        .run();
      const bytes = await exportBytes(harness, owned.id);
      hideAndRequestPurge(harness, owned.id);
      await runThreadPurges(harness.deps);
      hideAndRequestPurge(harness, owner.id);

      expect((await importThread(harness, bytes)).status).toBe(200);
      expect(getThread(harness.db, owned.id)).toMatchObject({
        deletedAt: null,
        lifecycleOwnerThreadId: null,
        parentThreadId: null,
        sourceThreadId: null,
      });
      await runThreadPurges(harness.deps);
      expect(getThread(harness.db, owner.id)).toBeNull();
    });
  });

  it("refuses a second import of the same thread while the first is running", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedArchivedConversation(harness);
      const before = allRows(harness, thread.id);
      const bytes = await exportBytes(harness, thread.id);
      harness.db.delete(threads).where(eq(threads.id, thread.id)).run();
      const statuses = (
        await Promise.all([
          importThread(harness, bytes),
          importThread(harness, bytes),
        ])
      )
        .map((response) => response.status)
        .sort();
      expect(statuses).toEqual([200, 409]);
      await runThreadPurges(harness.deps);
      expect(allRows(harness, thread.id)).toEqual(before);
      expect(getThread(harness.db, thread.id)?.deletedAt).toBeNull();
    });
  });

  it("keeps a recreated thread hidden until all of its rows are back", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedArchivedConversation(harness);
      const eventCount = allRows(harness, thread.id).length;
      const bytes = await exportBytes(harness, thread.id);
      harness.db.delete(threads).where(eq(threads.id, thread.id)).run();
      const seen: string[] = [];
      let done = false;
      const imported = sdkFor(harness)
        .threads.experimental_import({ file: bytes })
        .finally(() => {
          done = true;
        });
      while (!done) {
        const row = getThread(harness.db, thread.id);
        const complete = allRows(harness, thread.id).length === eventCount;
        seen.push(
          row === null
            ? "absent"
            : row.deletedAt !== null
              ? "hidden"
              : complete
                ? "visible"
                : "visible with missing events",
        );
        await new Promise((resolve) => setImmediate(resolve));
      }
      await imported;
      expect(seen).toContain("hidden");
      expect(seen).not.toContain("visible with missing events");
      expect(getThread(harness.db, thread.id)?.deletedAt).toBeNull();
    });
  });

  it("purges a half-imported thread once its import is gone", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedArchivedConversation(harness);
      const threadRow = readThreadTableRows(harness.db, thread.id).find(
        (row) => row.table === "threads",
      );
      if (threadRow === undefined) throw new Error("expected a thread row");
      harness.db.delete(threads).where(eq(threads.id, thread.id)).run();
      const release = holdThreadPurge(thread.id, "exclusive");
      const now = Date.now();
      insertHiddenThreadRow(harness.db, threadRow, now);
      requestThreadPurge(harness.db, { now, threadId: thread.id });

      await runThreadPurges(harness.deps);
      expect(getThread(harness.db, thread.id)?.deletedAt).toBe(now);

      release();
      await runThreadPurges(harness.deps);
      expect(getThread(harness.db, thread.id)).toBeNull();
    });
  });

  it.skipIf(process.platform === "win32")(
    "fails an export whose attachment can't be read instead of dropping the attachment",
    async () => {
      await withTestHarness(async (harness) => {
        const { project, thread } = seedArchivedConversation(harness);
        const attachment = await storeAttachment(
          harness.db,
          harness.config.dataDir,
          project.id,
          new File(["hello attachment"], "note.txt", { type: "text/plain" }),
        );
        acquireProjectAttachmentOwnership(harness.db, thread.id, [
          attachment.path,
        ]);
        const path = join(
          harness.config.dataDir,
          "attachments",
          project.id,
          attachment.path,
        );
        await chmod(path, 0o000);
        try {
          const response = await harness.app.request(
            `/api/v1/threads/${thread.id}/export`,
          );
          expect(response.status).toBe(500);
        } finally {
          await chmod(path, 0o644);
        }
      });
    },
  );
});

describe("thread purge hook", () => {
  it("keeps a deleted thread exportable while a plugin waits, then purges it once it proceeds", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedArchivedConversation(harness);
      const before = allRows(harness, thread.id);
      let copied: Buffer | null = null;
      const asked = installPurgeHook(() =>
        copied === null ? { action: "wait" } : { action: "proceed" },
      );
      hideAndRequestPurge(harness, thread.id);

      await runThreadPurges(harness.deps);
      expect(asked).toEqual([thread.id]);
      expect(allRows(harness, thread.id)).toEqual(before);
      copied = await exportBytes(harness, thread.id);

      await runThreadPurges(harness.deps);
      expect(asked).toEqual([thread.id, thread.id]);
      expect(getThread(harness.db, thread.id)).toBeNull();

      expect((await importThread(harness, copied)).status).toBe(200);
      expect(allRows(harness, thread.id)).toEqual(before);
    });
  });

  it("treats a hook that throws or returns nonsense as wait", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedArchivedConversation(harness);
      let answer: () => ThreadDeleteFinalizeHookDecision = () => {
        throw new Error("storage is offline");
      };
      installPurgeHook(() => answer());
      hideAndRequestPurge(harness, thread.id);

      await runThreadPurges(harness.deps);
      expect(getThread(harness.db, thread.id)).not.toBeNull();
      answer = () =>
        ({ action: "later" }) as unknown as ThreadDeleteFinalizeHookDecision;
      await runThreadPurges(harness.deps);
      expect(getThread(harness.db, thread.id)).not.toBeNull();
      answer = () => ({ action: "proceed" });
      await runThreadPurges(harness.deps);
      expect(getThread(harness.db, thread.id)).toBeNull();
    });
  });

  it("purges the threads queued behind one a plugin is waiting on", async () => {
    await withTestHarness(async (harness) => {
      const first = seedArchivedConversation(harness);
      const second = seedArchivedConversation(harness);
      installPurgeHook((threadId) =>
        threadId === first.thread.id
          ? { action: "wait" }
          : { action: "proceed" },
      );
      hideAndRequestPurge(harness, first.thread.id);
      hideAndRequestPurge(harness, second.thread.id);

      await runThreadPurges(harness.deps);

      expect(getThread(harness.db, first.thread.id)).not.toBeNull();
      expect(getThread(harness.db, second.thread.id)).toBeNull();
    });
  });

  it("purges nothing while plugins are still loading", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedArchivedConversation(harness);
      let loading = true;
      const asked = installPurgeHook(() => ({ action: "proceed" }), {
        loading: () => loading,
      });
      hideAndRequestPurge(harness, thread.id);

      await runThreadPurges(harness.deps);
      expect(asked).toEqual([]);
      expect(getThread(harness.db, thread.id)).not.toBeNull();

      loading = false;
      await runThreadPurges(harness.deps);
      expect(getThread(harness.db, thread.id)).toBeNull();
    });
  });

  it("never asks again once a purge has started, and refuses to export the rest", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedArchivedConversation(harness);
      const asked = installPurgeHook(() => ({ action: "proceed" }));
      hideAndRequestPurge(harness, thread.id);
      harness.db.run(
        sql`UPDATE thread_purges SET started_at = 1 WHERE thread_id = ${thread.id}`,
      );

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/export`,
      );
      expect(response.status).toBe(409);
      await runThreadPurges(harness.deps);

      expect(asked).toEqual([]);
      expect(getThread(harness.db, thread.id)).toBeNull();
    });
  });

  it("does not start a purge while an export of the thread is running", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedArchivedConversation(harness);
      installPurgeHook(() => ({ action: "proceed" }));
      hideAndRequestPurge(harness, thread.id);
      const release = holdThreadPurge(thread.id, "shared");

      await runThreadPurges(harness.deps);
      expect(getThreadPurge(harness.db, thread.id)?.startedAt).toBeNull();
      expect(getThread(harness.db, thread.id)).not.toBeNull();

      release();
      await runThreadPurges(harness.deps);
      expect(getThread(harness.db, thread.id)).toBeNull();
    });
  });
});
