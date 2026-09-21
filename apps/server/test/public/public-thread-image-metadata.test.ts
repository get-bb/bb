import { markThreadDeleted, saveThreadImageMetadata } from "@bb/db";
import { threadTimelineResponseSchema } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import {
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const image = {
  source: "https://example.com/portrait.png?v=1",
  width: 780,
  height: 1688,
  etag: '"first"',
};

describe("thread image metadata", () => {
  it("returns persisted dimensions with cached timelines, replaces changed versions, and isolates threads", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/image-metadata",
      });
      const thread = seedThread(harness.deps, { projectId: project.id });
      const other = seedThread(harness.deps, { projectId: project.id });
      const timeline = async (id: string) =>
        threadTimelineResponseSchema.parse(
          await (
            await harness.app.request(`/api/v1/threads/${id}/timeline`)
          ).json(),
        );
      const save = (id: string, metadata: unknown) =>
        harness.app.request(`/api/v1/threads/${id}/timeline/image-metadata`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(metadata),
        });
      expect((await timeline(thread.id)).imageMetadata).toEqual([]);
      expect((await save(thread.id, image)).status).toBe(200);
      for (let index = 0; index < 300; index++) {
        saveThreadImageMetadata(harness.db, {
          threadId: thread.id,
          ...image,
          source: `${image.source}&other=${index}`,
        });
      }
      expect((await timeline(thread.id)).imageMetadata).toHaveLength(301);
      expect((await timeline(thread.id)).imageMetadata).toContainEqual(image);
      expect((await timeline(other.id)).imageMetadata).toEqual([]);
      const changed = { ...image, width: 1440, height: 900, etag: '"second"' };
      expect((await save(thread.id, changed)).status).toBe(200);
      expect((await timeline(thread.id)).imageMetadata).toContainEqual(changed);
      expect((await timeline(thread.id)).imageMetadata).not.toContainEqual(
        image,
      );
      expect((await save(thread.id, { ...image, width: 0 })).status).toBe(400);
      expect(
        (
          await save(thread.id, {
            ...image,
            source: "data:image/png;base64,abc",
          })
        ).status,
      ).toBe(400);
      markThreadDeleted(harness.db, harness.deps.hub, { threadId: thread.id });
      expect((await save(thread.id, image)).status).toBe(404);
      expect(
        (await harness.app.request(`/api/v1/threads/${thread.id}/timeline`))
          .status,
      ).toBe(404);
    });
  });
});
