import { countThreads } from "@bb/db";
import { describe, expect, it } from "vitest";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("thread provider validation", () => {
  it("rejects an unregistered provider before creating a thread", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        status: "ready",
      });
      const response = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          origin: "sdk",
          projectId: project.id,
          providerId: "unregistered-provider",
          model: "test-model",
          input: [{ type: "text", text: "ok" }],
          environment: { type: "reuse", environmentId: environment.id },
        }),
      });

      expect(response.status).toBe(400);
      expect(await readJson(response)).toMatchObject({
        code: "invalid_request",
        message: expect.stringMatching(
          /Unknown provider "unregistered-provider".*codex.*claude-code/u,
        ),
      });
      expect(countThreads(harness.db, { projectId: project.id }).total).toBe(0);
    });
  });
});
