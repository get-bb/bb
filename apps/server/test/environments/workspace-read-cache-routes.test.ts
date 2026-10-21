import { updateHost } from "@bb/db";
import { describe, expect, it } from "vitest";
import type { GitHostPullRequest } from "@bb/domain";
import {
  listQueuedCommands,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
  waitForQueuedCommandAfter,
} from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

function rawPullRequest(
  overrides: Partial<GitHostPullRequest> = {},
): GitHostPullRequest {
  return {
    number: 42,
    title: "Cache the PR probe",
    state: "OPEN",
    url: "https://github.com/acme/bb/pull/42",
    isDraft: false,
    baseRefName: "main",
    headRefName: "bb/pr-cache",
    updatedAt: "2026-06-16T12:30:00Z",
    autoMerge: false,
    inMergeQueue: false,
    checks: [],
    reviewDecision: null,
    reviewRequestCount: 0,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    ...overrides,
  };
}

function seedGitEnvironment(harness: TestAppHarness, suffix: string) {
  const { host } = seedHostSession(harness.deps, {
    id: `host-workspace-read-cache-${suffix}`,
  });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    branchName: "bb/pr-cache",
    defaultBranch: "main",
    path: `/tmp/workspace-read-cache-${suffix}`,
    environmentProviderId: "git-worktree",
  });
  return { host, environment };
}

describe("workspace read caches on the environment routes", () => {
  it("serves repeated pull request reads from one gh probe until git-refs-changed", async () => {
    await withTestHarness(async (harness) => {
      const { environment } = seedGitEnvironment(harness, "pull-request");
      const url = `/api/v1/environments/${environment.id}/pull-request`;

      const first = harness.app.request(url);
      const second = harness.app.request(url);
      const pullRequestCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.pull_request" &&
          command.environmentId === environment.id,
      );
      await reportQueuedCommandSuccess(harness, pullRequestCommand, {
        outcome: "available",
        pullRequest: rawPullRequest({ isDraft: true }),
      });
      for (const response of await Promise.all([first, second])) {
        expect(response.status).toBe(200);
        await expect(readJson(response)).resolves.toMatchObject({
          outcome: "available",
          pullRequest: { number: 42, state: "draft" },
        });
      }

      const third = await harness.app.request(url);
      expect(third.status).toBe(200);
      await expect(readJson(third)).resolves.toMatchObject({
        pullRequest: { number: 42, state: "draft" },
      });
      expect(
        listQueuedCommands(harness, "workspace.pull_request"),
      ).toHaveLength(0);

      harness.hub.notifyEnvironment(environment.id, ["git-refs-changed"]);
      const fourth = harness.app.request(url);
      const refreshedCommand = await waitForQueuedCommandAfter(
        harness,
        pullRequestCommand.row.cursor,
        ({ command }) =>
          command.type === "workspace.pull_request" &&
          command.environmentId === environment.id,
      );
      await reportQueuedCommandSuccess(harness, refreshedCommand, {
        outcome: "available",
        pullRequest: rawPullRequest({ isDraft: false }),
      });
      const fourthResponse = await fourth;
      expect(fourthResponse.status).toBe(200);
      await expect(readJson(fourthResponse)).resolves.toMatchObject({
        pullRequest: { number: 42, state: "open" },
      });
    });
  });
});

it.each(["suspended", "suspending"] as const)(
  "does not send passive status or PR RPCs to a %s machine",
  async (phase) => {
    await withTestHarness(async (h) => {
      const { host, environment } = seedGitEnvironment(h, phase);
      updateHost(h.db, h.hub, host.id, {
        phase,
        machineProviderId: "test-paused-provider",
        suspendedAt: phase === "suspended" ? Date.now() : null,
      });
      for (const path of ["pull-request"]) {
        const response = await h.app.request(
          `/api/v1/environments/${environment.id}/${path}`,
        );
        expect(response.status).not.toBe(404);
        expect(listQueuedCommands(h, "workspace.pull_request")).toHaveLength(0);
      }
    });
  },
);
