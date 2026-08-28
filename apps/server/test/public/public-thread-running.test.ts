import { archiveThread } from "@bb/db";
import { threadRunningResponseSchema } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

async function running(harness: TestAppHarness) {
  const response = await harness.app.request("/api/v1/threads/running");
  expect(response.status).toBe(200);
  return threadRunningResponseSchema.parse(await readJson(response));
}

describe("GET /threads/running", () => {
  it("returns the occupying threads with the fields an admission policy acts on", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-thread-running",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/thread-running-source",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/thread-running-source",
      });
      const root = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        status: "active",
      });
      const child = seedThread(harness.deps, {
        environmentId: environment.id,
        parentThreadId: root.id,
        projectId: project.id,
        status: "active",
      });
      const spawned = seedThread(harness.deps, {
        environmentId: environment.id,
        originPluginId: "workflows",
        projectId: project.id,
        status: "active",
      });
      // Admitted but not yet provisioned: on no host, still occupying.
      const unplaced = seedThread(harness.deps, {
        environmentId: null,
        projectId: project.id,
        status: "starting",
      });
      // Neither of these occupies anything.
      seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        status: "idle",
      });
      const archived = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        status: "active",
      });
      archiveThread(harness.db, harness.deps.hub, archived.id);

      const rows = await running(harness);
      expect(new Set(rows.map((row) => row.id))).toEqual(
        new Set([root.id, child.id, spawned.id, unplaced.id]),
      );
      const byId = new Map(rows.map((row) => [row.id, row]));
      expect(byId.get(root.id)).toEqual({
        id: root.id,
        hostId: host.id,
        projectId: project.id,
        parentThreadId: null,
        originPluginId: null,
      });
      // The exemption inputs a limiter filters on are carried, not applied:
      // the route reports facts and the policy lives in the gate.
      expect(byId.get(child.id)?.parentThreadId).toBe(root.id);
      expect(byId.get(spawned.id)?.originPluginId).toBe("workflows");
      expect(byId.get(unplaced.id)?.hostId).toBeNull();
    });
  });
});
