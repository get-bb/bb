import { describe, expect, it } from "vitest";
import {
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import {
  seedHostSession,
  seedPrimaryHost,
  seedProjectWithSource,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("GET /hosts/:id/discovered-repos", () => {
  it("asks the machine for recent repos and marks the ones that are already projects", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-repo-discovery",
      });
      seedPrimaryHost(harness.deps, host.id);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        name: "Known",
        path: "/home/user/code/known",
      });
      const { host: otherHost } = seedHostSession(harness.deps, {
        id: "host-repo-discovery-other",
      });
      seedProjectWithSource(harness.deps, {
        hostId: otherHost.id,
        name: "Elsewhere",
        path: "/home/user/code/fresh",
      });

      const responsePromise = harness.app.request(
        `/api/v1/hosts/${host.id}/discovered-repos`,
      );
      const command = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "host.discover_repos",
      );
      expect(command.command).toEqual({
        type: "host.discover_repos",
        maxDepth: 5,
        sinceDays: 30,
        limit: 10,
      });
      await reportQueuedCommandSuccess(harness, command, {
        repos: [
          {
            path: "/home/user/code/known",
            name: "known",
            lastActivityAt: "2026-10-06T10:00:00.000Z",
            originUrl: "git@github.com:example/known.git",
          },
          {
            path: "/home/user/code/fresh",
            name: "fresh",
            lastActivityAt: "2026-10-05T10:00:00.000Z",
            originUrl: null,
          },
        ],
        truncated: true,
      });

      const response = await responsePromise;
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        repos: [
          {
            path: "/home/user/code/known",
            name: "known",
            lastActivityAt: "2026-10-06T10:00:00.000Z",
            originUrl: "git@github.com:example/known.git",
            projectId: project.id,
          },
          {
            path: "/home/user/code/fresh",
            name: "fresh",
            lastActivityAt: "2026-10-05T10:00:00.000Z",
            originUrl: null,
            projectId: null,
          },
        ],
        truncated: true,
      });
    });
  });

  it("refuses when the machine is not connected", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request(
        "/api/v1/hosts/host-missing/discovered-repos",
      );

      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  });
});
