import { markThreadDeleted } from "@bb/db";
import { threadAncestorsListResponseSchema } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { archiveThreadAndReleaseChildren } from "../../src/services/threads/thread-ownership.js";
import { readJson } from "../helpers/json.js";
import {
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

async function listAncestors(harness: TestAppHarness, body: unknown) {
  const response = await harness.app.request("/api/v1/threads/ancestors", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await readJson(response) };
}

async function ancestorsOf(harness: TestAppHarness, threadIds: string[]) {
  const { status, body } = await listAncestors(harness, { threadIds });
  expect(status).toBe(200);
  return Object.fromEntries(
    threadAncestorsListResponseSchema
      .parse(body)
      .threads.map(({ threadId, ancestorIds }) => [threadId, ancestorIds]),
  );
}

function seedTree(harness: TestAppHarness) {
  const { host } = seedHostSession(harness.deps);
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: "/tmp/public-thread-ancestors",
  });
  const seed = (parentThreadId: string | null = null) =>
    seedThread(harness.deps, { projectId: project.id, parentThreadId });
  const root = seed();
  const child = seed(root.id);
  const grandchild = seed(child.id);
  const other = seed();
  return { root, child, grandchild, other };
}

describe("POST /threads/ancestors", () => {
  it("returns each known thread's ancestors from the parent up, once per id", async () => {
    await withTestHarness(async (harness) => {
      const { root, child, grandchild, other } = seedTree(harness);
      markThreadDeleted(harness.db, harness.hub, { threadId: root.id });

      const { body } = await listAncestors(harness, {
        threadIds: [grandchild.id, other.id, "thr_missing", grandchild.id],
      });
      expect(threadAncestorsListResponseSchema.parse(body)).toEqual({
        threads: [
          { threadId: grandchild.id, ancestorIds: [child.id, root.id] },
          { threadId: other.id, ancestorIds: [] },
        ],
      });
    });
  });

  it("follows a thread nested under a new parent and children released by an archived parent", async () => {
    await withTestHarness(async (harness) => {
      const { root, child, grandchild, other } = seedTree(harness);

      const nest = await harness.app.request(`/api/v1/threads/${child.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ parentThreadId: other.id }),
      });
      expect(nest.status).toBe(200);
      await expect(ancestorsOf(harness, [grandchild.id])).resolves.toEqual({
        [grandchild.id]: [child.id, other.id],
      });

      archiveThreadAndReleaseChildren(harness.deps, { threadId: other.id });
      await expect(
        ancestorsOf(harness, [child.id, grandchild.id, root.id]),
      ).resolves.toEqual({
        [child.id]: [],
        [grandchild.id]: [child.id],
        [root.id]: [],
      });
    });
  });

  it("rejects an empty or oversized id list", async () => {
    await withTestHarness(async (harness) => {
      await expect(
        listAncestors(harness, { threadIds: [] }),
      ).resolves.toMatchObject({ status: 400 });
      await expect(
        listAncestors(harness, {
          threadIds: Array.from({ length: 201 }, (_, index) => `thr_${index}`),
        }),
      ).resolves.toMatchObject({ status: 400 });
    });
  });
});
