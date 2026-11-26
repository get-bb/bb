import {
  buildThreadHandoffCreateRequest,
  type ThreadHandoffCreateSeed,
} from "@bb/client-core";
import { createThread, createThreadSection } from "@bb/db";
import type { Thread, ThreadVisibility } from "@bb/domain";
import {
  threadCascadeListResponseSchema,
  threadResponseSchema,
} from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

function seedProject(harness: TestAppHarness) {
  const { host } = seedHostSession(harness.deps);
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: "/tmp/public-thread-handoff",
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    branchName: "bb/source",
  });
  const sectionId = createThreadSection(harness.db, harness.deps.hub, {
    name: "Work",
  }).section.id;
  return { environment, project, sectionId };
}

function handoffSeed(source: Thread): ThreadHandoffCreateSeed {
  return {
    environmentId: source.environmentId,
    parent:
      source.parentThreadId === null
        ? null
        : {
            threadId: source.parentThreadId,
            notifications: source.parentNotifications,
          },
    projectId: source.projectId,
    sectionId: source.sectionId,
    sourceThreadId: source.id,
    sourceThreadTitle: "Source thread",
  };
}

async function handOff(harness: TestAppHarness, source: Thread) {
  const request = buildThreadHandoffCreateRequest({
    draft: { text: "Keep going", mentions: [], attachments: [] },
    execution: {
      providerId: "codex",
      model: "gpt-5",
      reasoningLevel: "high",
      serviceTier: undefined,
      supportsServiceTier: false,
      permissionMode: "full",
    },
    seed: handoffSeed(source),
    sendAt: Date.now() + 3_600_000,
  });
  const response = await harness.app.request("/api/v1/threads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...request, origin: "app" }),
  });
  expect(response.status).toBe(201);
  return threadResponseSchema.parse(await readJson(response));
}

describe("thread handoff placement", () => {
  it.each<ThreadVisibility>(["visible", "hidden"])(
    "creates the continuation of a %s child thread next to its source",
    async (visibility) => {
      await withTestHarness(async (harness) => {
        const { environment, project, sectionId } = seedProject(harness);
        const coordinator = createThread(harness.db, harness.deps.hub, {
          projectId: project.id,
          providerId: "codex",
          environmentId: environment.id,
          sectionId,
          visibility,
        });
        const source = createThread(harness.db, harness.deps.hub, {
          projectId: project.id,
          providerId: "codex",
          environmentId: environment.id,
          parentThreadId: coordinator.id,
          parentNotifications: "stuck",
          sectionId,
          visibility,
        });

        const continuation = await handOff(harness, source);

        expect(continuation).toMatchObject({
          environmentId: source.environmentId,
          parentThreadId: coordinator.id,
          parentNotifications: "stuck",
          sectionId,
          visibility,
        });
      });
    },
  );

  it("archives the continuation with its source's parent", async () => {
    await withTestHarness(async (harness) => {
      const { environment, project } = seedProject(harness);
      const coordinator = createThread(harness.db, harness.deps.hub, {
        projectId: project.id,
        providerId: "codex",
        environmentId: environment.id,
      });
      const source = createThread(harness.db, harness.deps.hub, {
        projectId: project.id,
        providerId: "codex",
        environmentId: environment.id,
        parentThreadId: coordinator.id,
      });

      const continuation = await handOff(harness, source);

      const response = await harness.app.request("/api/v1/threads/cascade", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadIds: [coordinator.id],
          action: "archive",
        }),
      });
      expect(response.status).toBe(200);
      expect(
        threadCascadeListResponseSchema.parse(await readJson(response)).threads,
      ).toEqual([
        {
          threadId: coordinator.id,
          cascadeThreadIds: expect.arrayContaining([
            source.id,
            continuation.id,
          ]),
        },
      ]);
    });
  });

  it("keeps the continuation of a root thread a root thread in its section", async () => {
    await withTestHarness(async (harness) => {
      const { environment, project, sectionId } = seedProject(harness);
      const source = createThread(harness.db, harness.deps.hub, {
        projectId: project.id,
        providerId: "codex",
        environmentId: environment.id,
        sectionId,
      });

      const continuation = await handOff(harness, source);

      expect(continuation).toMatchObject({
        environmentId: source.environmentId,
        parentThreadId: null,
        sectionId,
        visibility: "visible",
      });
    });
  });
});
