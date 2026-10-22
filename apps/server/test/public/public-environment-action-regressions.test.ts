import { describe, expect, it } from "vitest";
import { getEnvironment } from "@bb/db";
import { readJson } from "../helpers/json.js";
import {
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("public environment action regressions", () => {
  it("rejects the removed squash-merge action with a 400", async () => {
    await withTestHarness(async (harness) => {
      const squashMergeResponse = await harness.app.request(
        "/api/v1/environments/env_missing/actions",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "squash_merge",
            options: { mergeBaseBranch: "main" },
          }),
        },
      );
      expect(squashMergeResponse.status).toBe(400);
      await expect(readJson(squashMergeResponse)).resolves.toMatchObject({
        code: "invalid_request",
      });
    });
  });

  it("rejects legacy environment action payloads that still send threadId", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-thread-target",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        environmentProviderId: "git-worktree",
        path: "/tmp/thread-target",
      });

      const mismatchedResponse = await harness.app.request(
        `/api/v1/environments/${environment.id}/actions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "commit",
            threadId: "thread-legacy",
          }),
        },
      );
      expect(mismatchedResponse.status).toBe(400);
      await expect(readJson(mismatchedResponse)).resolves.toMatchObject({
        code: "invalid_request",
      });
    });
  });

  it("preserves daemon branch metadata during commit action status preflight", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-commit-observed-branch",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        branchName: "feature/observed",
        defaultBranch: "main",
        path: "/tmp/commit-observed-branch-env",
      });

      const responsePromise = harness.app.request(
        `/api/v1/environments/${environment.id}/actions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "commit" }),
        },
      );

      const statusCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.status" &&
          command.environmentId === environment.id,
      );
      await reportQueuedCommandSuccess(harness, statusCommand, {
        outcome: "available",
        workspaceStatus: {
          workingTree: {
            insertions: 0,
            deletions: 0,
            lineStatsComplete: true,
            fileCount: 0,
            files: [],
            hasUncommittedChanges: false,
            state: "clean",
          },
          branch: {
            currentBranch: "feature/current",
            defaultBranch: "trunk",
          },
          checkout: {
            kind: "branch",
            branchName: "feature/current",
            headSha: null,
          },
          mergeBase: null,
        },
      });

      const diffCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.diff" &&
          command.environmentId === environment.id,
      );
      await reportQueuedCommandSuccess(harness, diffCommand, {
        outcome: "available",
        diff: {
          diff: "",
          files: "",
          mergeBaseRef: null,
          shortstat: "",
          truncated: false,
        },
      });

      const response = await responsePromise;
      expect(response.status).toBe(409);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "no_changes",
      });
      expect(getEnvironment(harness.db, environment.id)).toMatchObject({
        branchName: "feature/observed",
        defaultBranch: "main",
      });
    });
  });
});
