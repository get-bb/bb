import { archiveThread } from "@bb/db";
import {
  threadHandoffResponseSchema,
  threadHandoffStatusSchema,
} from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("public thread handoff routes", () => {
  it("creates a handoff and exposes its durable status", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const source = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
      });
      const response = await harness.app.request("/api/v1/threads/handoff", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceThreadId: source.id,
          providerId: "codex",
          model: "test-provider-default",
          reasoningLevel: "medium",
          serviceTier: "default",
          permissionMode: "full",
          archiveSource: false,
          idempotencyKey: "public-handoff-key-0001",
          origin: "sdk",
        }),
      });

      expect(response.status).toBe(201);
      const created = threadHandoffResponseSchema.parse(
        await readJson(response),
      );
      const statusResponse = await harness.app.request(
        `/api/v1/threads/handoffs/${created.replacementThreadId}`,
      );
      expect(statusResponse.status).toBe(200);
      expect(
        threadHandoffStatusSchema.parse(await readJson(statusResponse)),
      ).toEqual(created);
    });
  });

  it("rejects a deleted or archived source before creating work", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const archived = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
      });
      archiveThread(harness.db, harness.hub, archived.id);
      const response = await harness.app.request("/api/v1/threads/handoff", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceThreadId: archived.id,
          providerId: "codex",
          model: "test-provider-default",
          reasoningLevel: "medium",
          serviceTier: "default",
          permissionMode: "full",
          archiveSource: false,
          idempotencyKey: "public-handoff-key-0002",
          origin: "app",
        }),
      });
      expect(response.status).toBe(409);
      expect(await readJson(response)).toMatchObject({
        code: "thread_not_live",
      });
    });
  });
});
