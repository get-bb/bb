import { getThreadCommandAdmission } from "@bb/db";
import {
  encodeClientTurnRequestIdNumber,
  type ActorStamp,
  type Environment,
  type Thread,
} from "@bb/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../../src/errors.js";
import { admitBranchPublish } from "../../../src/services/threads/admitted-publish.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../../helpers/test-app.js";

const runLiveCommandAndWait = vi.hoisted(() => vi.fn());
const callEnvironmentWorkspaceStatus = vi.hoisted(() => vi.fn());

vi.mock("../../../src/services/hosts/live-command-wait.js", () => ({
  runLiveCommandAndWait: (...args: unknown[]) => runLiveCommandAndWait(...args),
}));

vi.mock("../../../src/services/environments/workspace-status.js", () => ({
  callEnvironmentWorkspaceStatus: (...args: unknown[]) =>
    callEnvironmentWorkspaceStatus(...args),
}));

const ALICE: ActorStamp = {
  principalId: "human:alice",
  principalKind: "human",
  displayName: "Alice",
};

interface PublishFixture {
  environment: Environment;
  thread: Thread;
}

function seedPublishableThread(
  harness: TestAppHarness,
  value: number,
): PublishFixture {
  const { host } = seedHostSession(harness.deps, {
    id: `host-publish-${value}`,
  });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: `/tmp/publish-${value}`,
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: `/tmp/publish-${value}`,
    status: "ready",
    managed: true,
    workspaceProvisionType: "managed-worktree",
    isGitRepo: true,
    branchName: `rooms/publish-${value}`,
    baseBranch: "main",
  });
  const thread = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    status: "idle",
    title: "Room task title",
  });
  return { environment, thread };
}

function availableStatus(args: {
  branchName: string;
  headSha: string | null;
  hasUncommittedChanges: boolean;
}) {
  return {
    outcome: "available" as const,
    workspaceStatus: {
      workingTree: {
        insertions: args.hasUncommittedChanges ? 1 : 0,
        deletions: 0,
        files: [],
        hasUncommittedChanges: args.hasUncommittedChanges,
        state: args.hasUncommittedChanges
          ? ("dirty_uncommitted" as const)
          : ("clean" as const),
      },
      branch: {
        currentBranch: args.branchName,
        defaultBranch: "main",
      },
      checkout: {
        kind: "branch" as const,
        branchName: args.branchName,
        headSha: args.headSha,
      },
      mergeBase: null,
    },
  };
}

describe("admitBranchPublish", () => {
  beforeEach(() => {
    runLiveCommandAndWait.mockReset();
    callEnvironmentWorkspaceStatus.mockReset();
  });

  it("commits when dirty, then pushes and creates a PR in order", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedPublishableThread(harness, 1);
      callEnvironmentWorkspaceStatus.mockResolvedValue(
        availableStatus({
          branchName: environment.branchName!,
          headSha: "oldsha",
          hasUncommittedChanges: true,
        }),
      );
      runLiveCommandAndWait
        .mockResolvedValueOnce({
          commitSha: "newcommit",
          commitSubject: "Ship it",
        })
        .mockResolvedValueOnce({
          pushedBranch: environment.branchName,
          remote: "origin",
          upstreamSet: true,
          alreadyUpToDate: false,
        })
        .mockResolvedValueOnce({
          provider: "github",
          number: 17,
          url: "https://github.com/org/repo/pull/17",
        });

      const requestId = encodeClientTurnRequestIdNumber({ value: 101 });
      const result = await admitBranchPublish(harness.deps, {
        actor: ALICE,
        defaultTitle: "Canonical task",
        payload: {
          requestId,
          title: "Custom PR title",
          body: "Custom body",
        },
        thread,
      });

      expect(result.kind).toBe("accepted");
      expect(result.admission.result).toEqual({
        disposition: "published",
        provider: "github",
        prNumber: 17,
        prUrl: "https://github.com/org/repo/pull/17",
        commitSha: "newcommit",
      });

      expect(runLiveCommandAndWait).toHaveBeenCalledTimes(3);
      expect(runLiveCommandAndWait.mock.calls.map((call) => call[1].command.type)).toEqual(
        [
          "workspace.commit",
          "workspace.push",
          "workspace.pull_request_create",
        ],
      );
      expect(runLiveCommandAndWait.mock.calls[0]?.[1].command).toMatchObject({
        type: "workspace.commit",
        message: "Custom PR title",
        environmentId: environment.id,
      });
      expect(runLiveCommandAndWait.mock.calls[1]?.[1].command).toMatchObject({
        type: "workspace.push",
        branch: environment.branchName,
      });
      expect(runLiveCommandAndWait.mock.calls[2]?.[1].command).toMatchObject({
        type: "workspace.pull_request_create",
        base: "main",
        head: environment.branchName,
        title: "Custom PR title",
        body: "Custom body",
      });

      expect(
        getThreadCommandAdmission(harness.db, {
          threadId: thread.id,
          requestId,
        }),
      ).toMatchObject({
        commandKind: "branch.publish",
        result: {
          disposition: "published",
          prNumber: 17,
          commitSha: "newcommit",
        },
      });
    });
  });

  it("skips commit when clean and reuses pre-existing head SHA", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedPublishableThread(harness, 2);
      callEnvironmentWorkspaceStatus.mockResolvedValue(
        availableStatus({
          branchName: environment.branchName!,
          headSha: "preexisting",
          hasUncommittedChanges: false,
        }),
      );
      runLiveCommandAndWait
        .mockResolvedValueOnce({
          pushedBranch: environment.branchName,
          remote: "origin",
          upstreamSet: false,
          alreadyUpToDate: true,
        })
        .mockResolvedValueOnce({
          provider: "github",
          number: 9,
          url: "https://github.com/org/repo/pull/9",
        });

      const result = await admitBranchPublish(harness.deps, {
        actor: ALICE,
        defaultTitle: "Canonical task",
        payload: {
          requestId: encodeClientTurnRequestIdNumber({ value: 102 }),
        },
        thread,
      });

      expect(result.admission.result).toMatchObject({
        disposition: "published",
        commitSha: "preexisting",
        prNumber: 9,
      });
      expect(runLiveCommandAndWait.mock.calls.map((call) => call[1].command.type)).toEqual(
        ["workspace.push", "workspace.pull_request_create"],
      );
      expect(runLiveCommandAndWait.mock.calls[1]?.[1].command).toMatchObject({
        type: "workspace.pull_request_create",
        title: "Canonical task",
        body: "Published from room.",
      });
    });
  });

  it("surfaces host no_changes as a typed rejection without admitting", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedPublishableThread(harness, 3);
      callEnvironmentWorkspaceStatus.mockResolvedValue(
        availableStatus({
          branchName: environment.branchName!,
          headSha: "only-local",
          hasUncommittedChanges: false,
        }),
      );
      runLiveCommandAndWait.mockRejectedValue(
        new ApiError(409, "no_changes", "No commits to push"),
      );

      const requestId = encodeClientTurnRequestIdNumber({ value: 103 });
      await expect(
        admitBranchPublish(harness.deps, {
          actor: ALICE,
          defaultTitle: "Canonical task",
          payload: { requestId },
          thread,
        }),
      ).rejects.toMatchObject({
        status: 409,
        body: { code: "no_changes" },
      });

      expect(
        getThreadCommandAdmission(harness.db, {
          threadId: thread.id,
          requestId,
        }),
      ).toBeNull();
      expect(runLiveCommandAndWait).toHaveBeenCalledTimes(1);
      expect(runLiveCommandAndWait.mock.calls[0]?.[1].command.type).toBe(
        "workspace.push",
      );
    });
  });

  it("replays an exact admission without re-running host work", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedPublishableThread(harness, 4);
      callEnvironmentWorkspaceStatus.mockResolvedValue(
        availableStatus({
          branchName: environment.branchName!,
          headSha: "sha4",
          hasUncommittedChanges: false,
        }),
      );
      runLiveCommandAndWait
        .mockResolvedValueOnce({
          pushedBranch: environment.branchName,
          remote: "origin",
          upstreamSet: true,
          alreadyUpToDate: false,
        })
        .mockResolvedValueOnce({
          provider: "github",
          number: 4,
          url: "https://github.com/org/repo/pull/4",
        });

      const requestId = encodeClientTurnRequestIdNumber({ value: 104 });
      const first = await admitBranchPublish(harness.deps, {
        actor: ALICE,
        defaultTitle: "Task",
        payload: { requestId, title: "Same" },
        thread,
      });
      const second = await admitBranchPublish(harness.deps, {
        actor: ALICE,
        defaultTitle: "Task",
        payload: { requestId, title: "Same" },
        thread,
      });

      expect(first.kind).toBe("accepted");
      expect(second.kind).toBe("replayed");
      expect(second.admission).toEqual(first.admission);
      expect(runLiveCommandAndWait).toHaveBeenCalledTimes(2);
    });
  });
});
