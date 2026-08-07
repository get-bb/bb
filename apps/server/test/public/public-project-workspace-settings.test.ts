import { describe, expect, it } from "vitest";
import { PROJECT_WORKSPACE_SCRIPT_MAX_LENGTH } from "@bb/server-contract";
import { readJson } from "../helpers/json.js";
import {
  seedHost,
  seedPrimaryHost,
  seedProjectWithSource,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("public project workspace settings routes", () => {
  it("reads empty settings and stores setup and run scripts", async () => {
    await withTestHarness(async (harness) => {
      const host = seedHost(harness.deps, { id: "host-workspace-settings" });
      seedPrimaryHost(harness.deps, host.id);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/workspace-settings",
      });
      const url = `/api/v1/projects/${project.id}/workspace-settings`;

      const initialResponse = await harness.app.request(url);
      expect(initialResponse.status).toBe(200);
      await expect(readJson(initialResponse)).resolves.toEqual({
        runScript: null,
        setupScript: null,
      });

      const updateResponse = await harness.app.request(url, {
        body: JSON.stringify({
          runScript: "corepack pnpm dev",
          setupScript: "corepack pnpm install",
        }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      });
      expect(updateResponse.status).toBe(200);
      await expect(readJson(updateResponse)).resolves.toEqual({
        runScript: "corepack pnpm dev",
        setupScript: "corepack pnpm install",
      });

      const clearResponse = await harness.app.request(url, {
        body: JSON.stringify({ setupScript: "   " }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      });
      expect(clearResponse.status).toBe(200);
      await expect(readJson(clearResponse)).resolves.toEqual({
        runScript: "corepack pnpm dev",
        setupScript: null,
      });
    });
  });

  it("rejects an oversized script", async () => {
    await withTestHarness(async (harness) => {
      const host = seedHost(harness.deps, { id: "host-long-script" });
      seedPrimaryHost(harness.deps, host.id);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/long-script",
      });

      const response = await harness.app.request(
        `/api/v1/projects/${project.id}/workspace-settings`,
        {
          body: JSON.stringify({
            runScript: "x".repeat(PROJECT_WORKSPACE_SCRIPT_MAX_LENGTH + 1),
          }),
          headers: { "content-type": "application/json" },
          method: "PATCH",
        },
      );

      expect(response.status).toBe(400);
    });
  });
});
