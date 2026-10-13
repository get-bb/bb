import { and, eq } from "drizzle-orm";
import { markThreadDeleted, threadPluginMetadata, threads } from "@bb/db";
import { jsonObjectSchema, PLUGIN_METADATA_MAX_BYTES } from "@bb/domain";
import { pluginThreadMetadataListResponseSchema } from "@bb/server-contract";
import { describe, expect, it, vi } from "vitest";
import { readJson } from "../helpers/json.js";
import {
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const PLUGIN_ID_MESSAGE =
  "Invalid string: must match pattern /^[a-z0-9][a-z0-9-]*$/u";
const TOO_LARGE_MESSAGE = "pluginMetadata exceeds 256 KiB";

function seedMetadataThread(harness: TestAppHarness) {
  const { host } = seedHostSession(harness.deps);
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: "/tmp/public-thread-plugin-metadata",
  });
  return seedThread(harness.deps, { projectId: project.id });
}

async function getMetadata(
  harness: TestAppHarness,
  threadId: string,
  pluginId: string,
) {
  const response = await harness.app.request(
    `/api/v1/threads/${threadId}/plugin-metadata?pluginId=${encodeURIComponent(pluginId)}`,
  );
  return { status: response.status, body: await readJson(response) };
}

async function patchMetadata(
  harness: TestAppHarness,
  threadId: string,
  body: unknown,
) {
  const response = await harness.app.request(
    `/api/v1/threads/${threadId}/plugin-metadata`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  return { status: response.status, body: await readJson(response) };
}

async function listMetadata(harness: TestAppHarness, body: unknown) {
  const response = await harness.app.request(
    "/api/v1/threads/plugin-metadata",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  return { status: response.status, body: await readJson(response) };
}

function readStoredMetadataJson(
  harness: TestAppHarness,
  threadId: string,
  pluginId: string,
): string | undefined {
  return harness.db
    .select({ metadataJson: threadPluginMetadata.metadataJson })
    .from(threadPluginMetadata)
    .where(
      and(
        eq(threadPluginMetadata.threadId, threadId),
        eq(threadPluginMetadata.pluginId, pluginId),
      ),
    )
    .get()?.metadataJson;
}

function namespaceShape(metadataJson: string | undefined) {
  if (metadataJson === undefined) return undefined;
  return {
    bytes: Buffer.byteLength(metadataJson, "utf8"),
    keys: Object.keys(jsonObjectSchema.parse(JSON.parse(metadataJson))),
  };
}

describe("public thread plugin metadata routes", () => {
  it("returns 413 when a patch pushes the namespace over 256 KiB and keeps the stored namespace", async () => {
    await withTestHarness(async (harness) => {
      const thread = seedMetadataThread(harness);
      const nearLimit = { big: "a".repeat(PLUGIN_METADATA_MAX_BYTES - 100) };
      const nearLimitShape = namespaceShape(JSON.stringify(nearLimit));

      const seeded = await patchMetadata(harness, thread.id, {
        pluginId: "linear",
        set: nearLimit,
      });
      expect(seeded.status).toBe(200);
      expect(namespaceShape(JSON.stringify(seeded.body))).toEqual(
        nearLimitShape,
      );

      expect(
        await patchMetadata(harness, thread.id, {
          pluginId: "linear",
          set: { more: "a".repeat(200) },
        }),
      ).toEqual({
        status: 413,
        body: { code: "invalid_request", message: TOO_LARGE_MESSAGE },
      });

      const stored = await getMetadata(harness, thread.id, "linear");
      expect(stored.status).toBe(200);
      expect(namespaceShape(JSON.stringify(stored.body))).toEqual(
        nearLimitShape,
      );
      expect(
        namespaceShape(readStoredMetadataJson(harness, thread.id, "linear")),
      ).toEqual(nearLimitShape);
    });
  });

  it("returns 400 for a single set over 256 KiB without writing a row", async () => {
    await withTestHarness(async (harness) => {
      const thread = seedMetadataThread(harness);

      expect(
        await patchMetadata(harness, thread.id, {
          pluginId: "linear",
          set: { big: "a".repeat(PLUGIN_METADATA_MAX_BYTES) },
        }),
      ).toEqual({
        status: 400,
        body: { code: "invalid_request", message: TOO_LARGE_MESSAGE },
      });
      expect(readStoredMetadataJson(harness, thread.id, "linear")).toBe(
        undefined,
      );
    });
  });

  it("returns 400 for a malformed pluginId in the patch body and the get query", async () => {
    await withTestHarness(async (harness) => {
      const thread = seedMetadataThread(harness);
      const invalidRequest = {
        status: 400,
        body: { code: "invalid_request", message: PLUGIN_ID_MESSAGE },
      };

      for (const pluginId of ["Linear ", "../x"]) {
        expect(
          await patchMetadata(harness, thread.id, { pluginId, set: { a: 1 } }),
        ).toEqual(invalidRequest);
        expect(await getMetadata(harness, thread.id, pluginId)).toEqual(
          invalidRequest,
        );
      }
      expect(
        harness.db
          .select()
          .from(threadPluginMetadata)
          .where(eq(threadPluginMetadata.threadId, thread.id))
          .all(),
      ).toEqual([]);
    });
  });

  it("round-trips toJSON as an ordinary data key", async () => {
    await withTestHarness(async (harness) => {
      const thread = seedMetadataThread(harness);
      const metadata = { toJSON: 1, nested: { toJSON: "value" } };

      expect(
        await patchMetadata(harness, thread.id, {
          pluginId: "linear",
          set: metadata,
        }),
      ).toEqual({ status: 200, body: metadata });
      expect(await getMetadata(harness, thread.id, "linear")).toEqual({
        status: 200,
        body: metadata,
      });
    });
  });

  it("reads a corrupt stored namespace as empty, replaces it on a remove-only patch, and logs both without its content", async () => {
    await withTestHarness(async (harness) => {
      const thread = seedMetadataThread(harness);
      await patchMetadata(harness, thread.id, {
        pluginId: "linear",
        set: { a: 1 },
      });
      harness.db
        .update(threadPluginMetadata)
        .set({ metadataJson: "sk-live-corrupt-secret" })
        .where(
          and(
            eq(threadPluginMetadata.threadId, thread.id),
            eq(threadPluginMetadata.pluginId, "linear"),
          ),
        )
        .run();
      const warn = vi.fn();
      const previousLogger = harness.deps.logger;
      harness.deps.logger = { ...previousLogger, warn };
      try {
        expect(await getMetadata(harness, thread.id, "linear")).toEqual({
          status: 200,
          body: {},
        });
        expect(
          await patchMetadata(harness, thread.id, {
            pluginId: "linear",
            remove: ["a"],
          }),
        ).toEqual({ status: 200, body: {} });
        expect(readStoredMetadataJson(harness, thread.id, "linear")).toBe(
          undefined,
        );
        expect(
          await patchMetadata(harness, thread.id, {
            pluginId: "linear",
            set: { b: 2 },
          }),
        ).toEqual({ status: 200, body: { b: 2 } });
        expect(await getMetadata(harness, thread.id, "linear")).toEqual({
          status: 200,
          body: { b: 2 },
        });
        expect(readStoredMetadataJson(harness, thread.id, "linear")).toBe(
          JSON.stringify({ b: 2 }),
        );
        expect(warn.mock.calls).toEqual([
          [
            `Ignoring corrupt plugin metadata for thread ${thread.id}, plugin linear`,
          ],
          [
            `Replaced corrupt plugin metadata for thread ${thread.id}, plugin linear`,
          ],
        ]);
        expect(JSON.stringify(warn.mock.calls)).not.toContain("sk-live");
      } finally {
        harness.deps.logger = previousLogger;
      }
    });
  });

  it("lists one plugin's metadata for the requested threads", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/public-thread-plugin-metadata-list",
      });
      const [live, archived, deleted, corrupt, unrequested, otherPlugin] = [
        1, 2, 3, 4, 5, 6,
      ].map(() => seedThread(harness.deps, { projectId: project.id }));
      for (const thread of [live, archived, deleted, corrupt, unrequested]) {
        await patchMetadata(harness, thread!.id, {
          pluginId: "linear",
          set: { thread: thread!.id },
        });
      }
      await patchMetadata(harness, otherPlugin!.id, {
        pluginId: "other",
        set: { a: 1 },
      });
      harness.db
        .update(threads)
        .set({ archivedAt: 1 })
        .where(eq(threads.id, archived!.id))
        .run();
      markThreadDeleted(harness.db, harness.hub, { threadId: deleted!.id });
      harness.db
        .update(threadPluginMetadata)
        .set({ metadataJson: "not json" })
        .where(eq(threadPluginMetadata.threadId, corrupt!.id))
        .run();
      const warn = vi.fn();
      const previousLogger = harness.deps.logger;
      harness.deps.logger = { ...previousLogger, warn };
      try {
        const requested = [live, archived, deleted, corrupt, otherPlugin].map(
          (thread) => thread!.id,
        );
        const listed = await listMetadata(harness, {
          pluginId: "linear",
          threadIds: [...requested, "thr_missing"],
        });
        expect(listed.status).toBe(200);
        const { threads: rows } = pluginThreadMetadataListResponseSchema.parse(
          listed.body,
        );
        expect(
          rows.sort((left, right) =>
            left.threadId.localeCompare(right.threadId),
          ),
        ).toEqual(
          [live, archived, deleted]
            .map((thread) => ({
              threadId: thread!.id,
              metadata: { thread: thread!.id },
            }))
            .sort((left, right) => left.threadId.localeCompare(right.threadId)),
        );
        expect(warn.mock.calls).toEqual([
          [
            `Ignoring corrupt plugin metadata for thread ${corrupt!.id}, plugin linear`,
          ],
        ]);
      } finally {
        harness.deps.logger = previousLogger;
      }
      for (const body of [
        { pluginId: "Bad", threadIds: [live!.id] },
        { pluginId: "linear", threadIds: [] },
        {
          pluginId: "linear",
          threadIds: Array.from({ length: 201 }, (_, index) => `thr_${index}`),
        },
      ]) {
        expect((await listMetadata(harness, body)).status).toBe(400);
      }
    });
  });

  it("returns 404 for a soft-deleted thread", async () => {
    await withTestHarness(async (harness) => {
      const thread = seedMetadataThread(harness);
      expect(
        markThreadDeleted(harness.db, harness.hub, { threadId: thread.id }),
      ).not.toBeNull();
      const notFound = {
        status: 404,
        body: { code: "thread_not_found", message: "Thread not found" },
      };

      expect(await getMetadata(harness, thread.id, "linear")).toEqual(notFound);
      expect(
        await patchMetadata(harness, thread.id, {
          pluginId: "linear",
          set: { a: 1 },
        }),
      ).toEqual(notFound);
      expect(readStoredMetadataJson(harness, thread.id, "linear")).toBe(
        undefined,
      );
    });
  });
});
