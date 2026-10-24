import { archiveThread, getThread, markThreadDeleted } from "@bb/db";
import {
  threadCascadeListResponseSchema,
  threadChildSummaryResponseSchema,
} from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { readJson } from "../helpers/json.js";
import {
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

async function request(
  harness: TestAppHarness,
  path: string,
  method: string,
  body?: unknown,
) {
  const response = await harness.app.request(`/api/v1${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await readJson(response) };
}

async function cascadeOf(
  harness: TestAppHarness,
  threadIds: string[],
  action: "archive" | "delete",
) {
  const { status, body } = await request(harness, "/threads/cascade", "POST", {
    threadIds,
    action,
  });
  expect(status).toBe(200);
  return Object.fromEntries(
    threadCascadeListResponseSchema
      .parse(body)
      .threads.map(({ threadId, cascadeThreadIds }) => [
        threadId,
        [...cascadeThreadIds].sort(),
      ]),
  );
}

function seedTree(harness: TestAppHarness) {
  const { host } = seedHostSession(harness.deps);
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: "/tmp/public-thread-cascade",
  });
  const seed = (
    options: {
      parentThreadId?: string;
      lifecycleOwnerThreadId?: string;
      visibility?: "visible" | "hidden";
    } = {},
  ) => seedThread(harness.deps, { projectId: project.id, ...options });
  const root = seed();
  const child = seed({ parentThreadId: root.id });
  const grandchild = seed({ parentThreadId: child.id });
  const archivedChild = seed({ parentThreadId: root.id });
  const hiddenChild = seed({ parentThreadId: root.id, visibility: "hidden" });
  const helper = seed({ lifecycleOwnerThreadId: root.id });
  const other = seed();
  archiveThread(harness.db, harness.hub, archivedChild.id);
  return {
    root,
    child,
    grandchild,
    archivedChild,
    hiddenChild,
    helper,
    other,
  };
}

describe("POST /threads/cascade", () => {
  it("lists the visible threads archive and delete would also take, including lifecycle dependents", async () => {
    await withTestHarness(async (harness) => {
      const { root, child, grandchild, archivedChild, helper, other } =
        seedTree(harness);

      await expect(
        cascadeOf(harness, [root.id, other.id], "archive"),
      ).resolves.toEqual({
        [root.id]: [child.id, grandchild.id, helper.id].sort(),
        [other.id]: [],
      });
      await expect(
        cascadeOf(harness, [root.id, other.id], "delete"),
      ).resolves.toEqual({
        [root.id]: [
          child.id,
          grandchild.id,
          archivedChild.id,
          helper.id,
        ].sort(),
        [other.id]: [],
      });
    });
  });

  it("agrees with the archive confirmation count and with what archive-all archives", async () => {
    await withTestHarness(async (harness) => {
      const { root, hiddenChild } = seedTree(harness);
      const cascade = (await cascadeOf(harness, [root.id], "archive"))[root.id];

      const summary = await request(
        harness,
        `/threads/${root.id}/child-summary`,
        "GET",
      );
      expect(
        threadChildSummaryResponseSchema.parse(summary.body)
          .unarchivedDescendantCount,
      ).toBe(cascade?.length);

      const archived = await request(
        harness,
        `/threads/${root.id}/archive-all`,
        "POST",
      );
      expect(archived.status).toBe(200);
      const archivedIds = (
        archived.body as { archivedThreadIds: string[] }
      ).archivedThreadIds.filter(
        (id) => id !== root.id && id !== hiddenChild.id,
      );
      expect(archivedIds.sort()).toEqual(cascade);
    });
  });

  it("matches what delete removes", async () => {
    await withTestHarness(async (harness) => {
      const { root } = seedTree(harness);
      const cascade =
        (await cascadeOf(harness, [root.id], "delete"))[root.id] ?? [];

      const deleted = await request(harness, `/threads/${root.id}`, "DELETE", {
        childThreadsConfirmed: true,
      });
      expect(deleted.status).toBe(200);
      expect(cascade.length).toBeGreaterThan(0);
      for (const id of cascade) {
        expect(getThread(harness.db, id)?.deletedAt).not.toBeNull();
      }
    });
  });

  it("omits deleted and unknown threads and answers each id once", async () => {
    await withTestHarness(async (harness) => {
      const { root, other } = seedTree(harness);
      markThreadDeleted(harness.db, harness.hub, { threadId: other.id });

      const { body } = await request(harness, "/threads/cascade", "POST", {
        threadIds: [root.id, other.id, "thr_missing", root.id],
        action: "delete",
      });
      expect(
        threadCascadeListResponseSchema
          .parse(body)
          .threads.map((row) => row.threadId),
      ).toEqual([root.id]);
    });
  });

  it.each([
    ["no action", { threadIds: ["thr_a"] }],
    ["an unknown action", { threadIds: ["thr_a"], action: "pin" }],
    ["no ids", { threadIds: [], action: "archive" }],
    [
      "more than 200 ids",
      {
        threadIds: Array.from({ length: 201 }, (_, index) => `thr_${index}`),
        action: "archive",
      },
    ],
  ])("rejects a request with %s", async (_label, body) => {
    await withTestHarness(async (harness) => {
      const response = await request(harness, "/threads/cascade", "POST", body);
      expect(response.status).toBe(400);
    });
  });
});
