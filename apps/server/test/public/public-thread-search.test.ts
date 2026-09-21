import { archiveThread, createQueuedThreadMessage } from "@bb/db";
import { threadSearchResponseSchema } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { readJson } from "../helpers/json.js";
import {
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("public thread search route", () => {
  it("finds saved first messages and follow-ups in the existing thread groups", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
      const first = seedThread(harness.deps, { projectId: project.id, status: "pending" });
      const followup = seedThread(harness.deps, { projectId: project.id });
      const archived = seedThread(harness.deps, { projectId: project.id });
      const hidden = seedThread(harness.deps, { projectId: project.id, visibility: "hidden" });
      for (const thread of [first, followup, archived, hidden]) {
        createQueuedThreadMessage(harness.db, harness.deps.hub, {
          threadId: thread.id,
          content: [{ type: "text", text: "Juniper saved message", mentions: [] }],
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
      const response = await harness.app.request("/api/v1/threads/search?query=Juniper");
      expect(response.status).toBe(200);
      const body = threadSearchResponseSchema.parse(await readJson(response));
      expect(Object.keys(body)).toEqual(["active", "archived"]);
      expect(new Set(body.active.results.map((result) => result.thread.id))).toEqual(new Set([first.id, followup.id]));
      expect(body.archived.results.map((result) => result.thread.id)).toEqual([archived.id]);
      for (const result of [...body.active.results, ...body.archived.results]) {
        expect(result.thread).not.toHaveProperty("lifecycle");
        expect(result.matches).toEqual(expect.arrayContaining([
          expect.objectContaining({ text: "Juniper saved message", sourceSeq: null }),
        ]));
      }
    });
  });

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
});
