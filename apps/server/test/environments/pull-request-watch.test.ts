import { afterEach, describe, expect, it, vi } from "vitest";
import type { GitHostPullRequest } from "@bb/domain";
import { environmentPullRequestTag } from "@bb/server-contract";
import {
  listQueuedCommands,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import { createMockHubSocket } from "../helpers/mock-hub-socket.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const ACTIVE_CHECK_MS = 30_000;

const pendingCheck = {
  name: "ci",
  status: "in_progress",
  conclusion: null,
  url: null,
  startedAt: "2026-06-16T12:30:00Z",
} as const;

function rawPullRequest(
  overrides: Partial<GitHostPullRequest> = {},
): GitHostPullRequest {
  return {
    number: 42,
    title: "Watch the PR",
    state: "OPEN",
    url: "https://github.com/acme/bb/pull/42",
    isDraft: false,
    baseRefName: "main",
    headRefName: "bb/pr-watch",
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

function seedGitEnvironment(harness: TestAppHarness) {
  const { host } = seedHostSession(harness.deps, { id: "host-pr-watch" });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
  });
  return seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    branchName: "bb/pr-watch",
    defaultBranch: "main",
    path: "/tmp/pr-watch",
    environmentProviderId: "git-worktree",
  });
}

function pullRequestCommand(harness: TestAppHarness, environmentId: string) {
  return waitForQueuedCommand(
    harness,
    ({ command }) =>
      command.type === "workspace.pull_request" &&
      command.environmentId === environmentId,
  );
}

async function readPullRequest(
  harness: TestAppHarness,
  environmentId: string,
): Promise<unknown> {
  const response = await harness.app.request(
    `/api/v1/environments/${environmentId}/pull-request`,
  );
  return readJson(response);
}

function tagMessages(socket: { messages: string[] }): unknown[] {
  return socket.messages
    .map((message) => JSON.parse(message))
    .filter((message) => message.entity === "tags");
}

describe("environment pull request watch", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("checks an active pull request only while watched and refreshes readers by tag on change", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout"],
      shouldAdvanceTime: true,
    });
    await withTestHarness(async (harness) => {
      const environment = seedGitEnvironment(harness);
      const target = {
        kind: "environment-pull-request",
        environmentId: environment.id,
      } as const;
      const first = createMockHubSocket();
      const second = createMockHubSocket();
      harness.hub.subscribe(first, target);
      harness.hub.subscribe(second, { ...target });

      const baseline = await pullRequestCommand(harness, environment.id);
      await reportQueuedCommandSuccess(harness, baseline, {
        outcome: "available",
        pullRequest: rawPullRequest({ checks: [pendingCheck] }),
      });
      await expect(
        readPullRequest(harness, environment.id),
      ).resolves.toMatchObject({
        pullRequest: { checks: { state: "pending" } },
      });
      expect(
        listQueuedCommands(harness, "workspace.pull_request"),
      ).toHaveLength(0);

      vi.advanceTimersByTime(ACTIVE_CHECK_MS);
      const unchanged = await pullRequestCommand(harness, environment.id);
      await reportQueuedCommandSuccess(harness, unchanged, {
        outcome: "available",
        pullRequest: rawPullRequest({ checks: [pendingCheck] }),
      });
      await readPullRequest(harness, environment.id);
      expect(tagMessages(first)).toEqual([]);

      vi.advanceTimersByTime(ACTIVE_CHECK_MS);
      const settled = await pullRequestCommand(harness, environment.id);
      await reportQueuedCommandSuccess(harness, settled, {
        outcome: "available",
        pullRequest: rawPullRequest({
          checks: [
            { ...pendingCheck, status: "completed", conclusion: "success" },
          ],
        }),
      });
      await readPullRequest(harness, environment.id);
      await vi.waitFor(() =>
        expect(tagMessages(first)).toEqual([
          {
            type: "changed",
            entity: "tags",
            tags: [environmentPullRequestTag(environment.id)],
          },
        ]),
      );

      vi.advanceTimersByTime(ACTIVE_CHECK_MS * 2);
      await new Promise((resolve) => setImmediate(resolve));
      expect(
        listQueuedCommands(harness, "workspace.pull_request"),
      ).toHaveLength(0);
      expect(tagMessages(first)).toHaveLength(1);
    });
  });

  it("stops checking when the last watcher leaves", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout"],
      shouldAdvanceTime: true,
    });
    await withTestHarness(async (harness) => {
      const environment = seedGitEnvironment(harness);
      const socket = createMockHubSocket();
      harness.hub.subscribe(socket, {
        kind: "environment-pull-request",
        environmentId: environment.id,
      });
      const baseline = await pullRequestCommand(harness, environment.id);
      await reportQueuedCommandSuccess(harness, baseline, {
        outcome: "available",
        pullRequest: rawPullRequest({ autoMerge: true }),
      });
      await readPullRequest(harness, environment.id);

      harness.hub.unregisterClient(socket);
      vi.advanceTimersByTime(ACTIVE_CHECK_MS * 2);
      await new Promise((resolve) => setImmediate(resolve));

      expect(
        listQueuedCommands(harness, "workspace.pull_request"),
      ).toHaveLength(0);
    });
  });
});
