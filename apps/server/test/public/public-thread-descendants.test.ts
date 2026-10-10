import { archiveThread, markThreadDeleted } from "@bb/db";
import { threadDescendantsListResponseSchema } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { archiveThreadAndReleaseChildren } from "../../src/services/threads/thread-ownership.js";
import { readJson } from "../helpers/json.js";
import {
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

async function listDescendants(harness: TestAppHarness, body: unknown) {
  const response = await harness.app.request("/api/v1/threads/descendants", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await readJson(response) };
}

async function descendantsOf(
  harness: TestAppHarness,
  threadIds: string[],
  flags: { includeArchived?: boolean; includeHidden?: boolean } = {},
) {
  const { status, body } = await listDescendants(harness, {
    threadIds,
    ...flags,
  });
  expect(status).toBe(200);
  return Object.fromEntries(
    threadDescendantsListResponseSchema
      .parse(body)
      .threads.map(({ threadId, descendantIds }) => [threadId, descendantIds]),
  );
}

function seedTree(harness: TestAppHarness) {
  const { host } = seedHostSession(harness.deps);
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: "/tmp/public-thread-descendants",
  });
  const seed = (parentThreadId: string | null = null) =>
    seedThread(harness.deps, { projectId: project.id, parentThreadId });
  const root = seed();
  const child = seed(root.id);
  const grandchild = seed(child.id);
  const sibling = seed(root.id);
  const other = seed();
  return { root, child, grandchild, sibling, other };
}

describe("POST /threads/descendants", () => {
  it("returns each live thread's descendants children first, once per id", async () => {
    await withTestHarness(async (harness) => {
      const { root, child, grandchild, sibling, other } = seedTree(harness);
      const deletedChild = seedThread(harness.deps, {
        projectId: root.projectId,
        parentThreadId: other.id,
      });
      markThreadDeleted(harness.db, harness.hub, {
        threadId: deletedChild.id,
      });

      const { body } = await listDescendants(harness, {
        threadIds: [root.id, other.id, deletedChild.id, "thr_missing", root.id],
      });
      const { threads } = threadDescendantsListResponseSchema.parse(body);
      expect(threads).toHaveLength(2);
      expect(threads[0]?.threadId).toBe(root.id);
      expect(threads[0]?.descendantIds.slice(0, 2).sort()).toEqual(
        [child.id, sibling.id].sort(),
      );
      expect(threads[0]?.descendantIds[2]).toBe(grandchild.id);
      expect(threads[1]).toEqual({ threadId: other.id, descendantIds: [] });
    });
  });

  it("follows a subtree nested under a new parent and children released by an archived parent", async () => {
    await withTestHarness(async (harness) => {
      const { root, child, grandchild, sibling, other } = seedTree(harness);

      const nest = await harness.app.request(`/api/v1/threads/${child.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ parentThreadId: other.id }),
      });
      expect(nest.status).toBe(200);
      await expect(descendantsOf(harness, [root.id, other.id])).resolves.toEqual(
        {
          [root.id]: [sibling.id],
          [other.id]: [child.id, grandchild.id],
        },
      );

      archiveThreadAndReleaseChildren(harness.deps, { threadId: other.id });
      await expect(
        descendantsOf(harness, [other.id, child.id]),
      ).resolves.toEqual({
        [other.id]: [],
        [child.id]: [grandchild.id],
      });
    });
  });

  it("omits archived and hidden descendants unless asked, still walking through them", async () => {
    await withTestHarness(async (harness) => {
      const { root, child, grandchild, sibling } = seedTree(harness);
      const hidden = seedThread(harness.deps, {
        projectId: root.projectId,
        parentThreadId: root.id,
        visibility: "hidden",
      });
      archiveThread(harness.db, harness.hub, child.id);
      const sorted = async (flags: {
        includeArchived?: boolean;
        includeHidden?: boolean;
      }) => (await descendantsOf(harness, [root.id], flags))[root.id]?.sort();

      await expect(sorted({})).resolves.toEqual(
        [sibling.id, grandchild.id].sort(),
      );
      await expect(sorted({ includeArchived: true })).resolves.toEqual(
        [child.id, sibling.id, grandchild.id].sort(),
      );
      await expect(sorted({ includeHidden: true })).resolves.toEqual(
        [sibling.id, hidden.id, grandchild.id].sort(),
      );
      await expect(
        descendantsOf(harness, [child.id, hidden.id]),
      ).resolves.toEqual({ [child.id]: [grandchild.id], [hidden.id]: [] });
    });
  });

  it("rejects an empty or oversized id list", async () => {
    await withTestHarness(async (harness) => {
      await expect(
        listDescendants(harness, { threadIds: [] }),
      ).resolves.toMatchObject({ status: 400 });
      await expect(
        listDescendants(harness, {
          threadIds: Array.from({ length: 201 }, (_, index) => `thr_${index}`),
        }),
      ).resolves.toMatchObject({ status: 400 });
    });
  });
});
