import { archiveThread, createQueuedThreadMessage } from "@bb/db";
import {
  threadListResponseSchema,
  threadSearchResponseSchema,
} from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { readJson } from "../helpers/json.js";
import {
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("public thread search route", () => {
  it("returns active and archived search result groups", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const activeThread = seedThread(harness.deps, {
        projectId: project.id,
        title: "routeactive",
        titleFallback: "routeactive",
      });
      const archivedThread = seedThread(harness.deps, {
        projectId: project.id,
        title: "routearchived",
        titleFallback: "routearchived",
      });
      archiveThread(harness.deps.db, harness.deps.hub, archivedThread.id);
      const hiddenThread = seedThread(harness.deps, {
        projectId: project.id,
        title: "routehidden",
        titleFallback: "routehidden",
        visibility: "hidden",
      });
      const hiddenArchivedThread = seedThread(harness.deps, {
        projectId: project.id,
        title: "routehiddenarchived",
        titleFallback: "routehiddenarchived",
        visibility: "hidden",
      });
      archiveThread(harness.deps.db, harness.deps.hub, hiddenArchivedThread.id);

      const response = await harness.app.request(
        "/api/v1/threads/search?query=route&limitPerGroup=10",
      );

      expect(response.status).toBe(200);
      const body = threadSearchResponseSchema.parse(await readJson(response));
      expect(body.active.results.map((result) => result.thread.id)).toContain(
        activeThread.id,
      );
      expect(body.archived.results.map((result) => result.thread.id)).toContain(
        archivedThread.id,
      );
      expect(
        [...body.active.results, ...body.archived.results].map(
          (result) => result.thread.id,
        ),
      ).not.toContain(hiddenThread.id);
      expect(
        [...body.active.results, ...body.archived.results].map(
          (result) => result.thread.id,
        ),
      ).not.toContain(hiddenArchivedThread.id);
    });
  });

  it("validates required query and limit parameters before the thread-id route", async () => {
    await withTestHarness(async (harness) => {
      const missingQueryResponse = await harness.app.request(
        "/api/v1/threads/search",
      );
      expect(missingQueryResponse.status).toBe(400);

      const shortQueryResponse = await harness.app.request(
        "/api/v1/threads/search?query=x",
      );
      expect(shortQueryResponse.status).toBe(400);

      const badLimitResponse = await harness.app.request(
        "/api/v1/threads/search?query=valid&limitPerGroup=bad",
      );
      expect(badLimitResponse.status).toBe(400);
    });
  });

  it("opts into lifecycle list filters and a separate draft search group", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const draft = seedThread(harness.deps, {
        projectId: project.id,
        status: "pending",
        title: "lifecycleroute draft",
      });
      const active = seedThread(harness.deps, {
        projectId: project.id,
        title: "lifecycleroute active",
      });
      const archived = seedThread(harness.deps, {
        projectId: project.id,
        title: "lifecycleroute archived",
      });
      const hidden = seedThread(harness.deps, {
        projectId: project.id,
        status: "pending",
        title: "lifecycleroute hidden",
        visibility: "hidden",
      });
      for (const thread of [draft, hidden]) {
        createQueuedThreadMessage(harness.db, harness.deps.hub, {
          threadId: thread.id,
          content: [{ type: "text", text: "Saved draft", mentions: [] }],
          model: "gpt-5",
          reasoningLevel: "medium",
          permissionMode: "full",
          serviceTier: "default",
          waitingOn: { kind: "plugin", pluginId: "drafts", reason: "Draft" },
          sendAt: null,
          payload: { kind: "inline" },
          systemNotice: null,
        });
      }
      archiveThread(harness.db, harness.deps.hub, archived.id);
      const legacyResponse = await harness.app.request(
        "/api/v1/threads/search?query=lifecycleroute",
      );
      const legacy = threadSearchResponseSchema.parse(
        await readJson(legacyResponse),
      );
      expect(Object.keys(legacy)).toEqual(["active", "archived"]);
      expect(
        new Set(legacy.active.results.map((result) => result.thread.id)),
      ).toEqual(new Set([draft.id, active.id]));
      const response = await harness.app.request(
        "/api/v1/threads/search?query=lifecycleroute&lifecycles=draft,archived",
      );
      const body = threadSearchResponseSchema.parse(await readJson(response));
      expect(response.status).toBe(200);
      expect(body.active).toEqual({ total: 0, results: [] });
      expect(
        body.draft?.results.map((result) => [
          result.thread.id,
          result.thread.lifecycle,
        ]),
      ).toEqual([[draft.id, "draft"]]);
      expect(body.archived.results.map((result) => result.thread.id)).toEqual([
        archived.id,
      ]);
      const listResponse = await harness.app.request(
        `/api/v1/threads?projectId=${project.id}&lifecycles=draft&limit=1`,
      );
      expect(listResponse.status).toBe(200);
      expect(
        threadListResponseSchema
          .parse(await readJson(listResponse))
          .map((thread) => thread.id),
      ).toEqual([draft.id]);
      const intersection = await harness.app.request(
        `/api/v1/threads?projectId=${project.id}&lifecycles=draft&archived=true`,
      );
      expect(await readJson(intersection)).toEqual([]);
      for (const lifecycles of ["", "unknown", "draft,", "draft,unknown"]) {
        expect(
          (
            await harness.app.request(
              `/api/v1/threads?lifecycles=${lifecycles}`,
            )
          ).status,
        ).toBe(400);
        expect(
          (
            await harness.app.request(
              `/api/v1/threads/search?query=lifecycleroute&lifecycles=${lifecycles}`,
            )
          ).status,
        ).toBe(400);
      }
    });
  });
});
