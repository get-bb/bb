import { getThread } from "@bb/db";
import { threadSchema, type ProjectSourceCheckout } from "@bb/domain";
import { threadResponseSchema } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import {
  registerTestHostRpcCapture,
  requireManagedWorktreeEnvironmentProvisionLiveCommand,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedPrimaryHost,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
  seedTurnStarted,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const SOURCE_PATH = "/tmp/named-base-branch-source";

function buildCheckout(
  defaultBranchRelation: ProjectSourceCheckout["defaultBranchRelation"],
): ProjectSourceCheckout {
  return {
    branches: ["main"],
    branchesTruncated: false,
    checkout: { kind: "branch", branchName: "main", headSha: "abc123" },
    defaultBranch: "main",
    defaultBranchRelation,
    hasUncommittedChanges: false,
    operation: { kind: "none" },
    originDefaultBranch: "origin/main",
    remoteBranches: ["origin/main"],
    remoteBranchesTruncated: false,
    selectedBranch: null,
  };
}

async function createNamedBaseBranchThread(
  harness: TestAppHarness,
  args: {
    baseBranch: string;
    defaultBranchRelation: ProjectSourceCheckout["defaultBranchRelation"];
  },
): Promise<string | null> {
  const { host, session } = seedHostSession(harness.deps);
  seedPrimaryHost(harness.deps, host.id);
  registerTestHostRpcCapture(harness, {
    hostId: host.id,
    sessionId: session.id,
    listBranchesResult: buildCheckout(args.defaultBranchRelation),
  });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: SOURCE_PATH,
  });

  const response = await harness.app.request("/api/v1/threads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      origin: "sdk",
      projectId: project.id,
      providerId: "codex",
      input: [{ type: "text", text: "Spawn a thread" }],
      environment: {
        type: "host",
        hostId: host.id,
        workspace: {
          type: "managed-worktree",
          baseBranch: { kind: "named", name: args.baseBranch },
        },
      },
    }),
  });
  expect(response.status).toBe(201);
  threadSchema.parse(await readJson(response));
  const queued = await waitForQueuedCommand(
    harness,
    ({ command }) => command.type === "environment.provision",
  );
  return requireManagedWorktreeEnvironmentProvisionLiveCommand(queued).command
    .baseBranch;
}

describe("named managed-worktree base branch", () => {
  // Issue #1770: `--base-branch main` used to reach the daemon verbatim, and
  // the daemon only fetches remote-qualified bases, so a checkout whose local
  // main was behind origin seeded every new worktree from the stale commit.
  it("bases on origin when the named default branch is behind origin", async () => {
    await withTestHarness(async (harness) => {
      await expect(
        createNamedBaseBranchThread(harness, {
          baseBranch: "main",
          defaultBranchRelation: "local-behind",
        }),
      ).resolves.toBe("origin/main");
    });
  });

  it("keeps the named default branch when local is ahead of origin", async () => {
    await withTestHarness(async (harness) => {
      await expect(
        createNamedBaseBranchThread(harness, {
          baseBranch: "main",
          defaultBranchRelation: "local-ahead",
        }),
      ).resolves.toBe("main");
    });
  });

  it("passes a named non-default branch through unchanged", async () => {
    await withTestHarness(async (harness) => {
      await expect(
        createNamedBaseBranchThread(harness, {
          baseBranch: "release/2026-05",
          defaultBranchRelation: "local-behind",
        }),
      ).resolves.toBe("release/2026-05");
    });
  });

  it("keeps a fork on its source branch even when local main is behind origin", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      registerTestHostRpcCapture(harness, {
        hostId: host.id,
        sessionId: session.id,
        listBranchesResult: buildCheckout("local-behind"),
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: SOURCE_PATH,
      });
      // An unmanaged checkout sitting on local main. A fork continues that
      // conversation, so it must start from the branch the source is on.
      const environment = seedEnvironment(harness.deps, {
        branchName: "main",
        hostId: host.id,
        path: SOURCE_PATH,
        projectId: project.id,
      });
      const sourceThread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
      });
      seedThreadRuntimeState(harness.deps, {
        environmentId: environment.id,
        permissionMode: "full",
        providerThreadId: "provider-fork-source",
        threadId: sourceThread.id,
      });
      seedTurnStarted(harness.deps, {
        environmentId: environment.id,
        providerThreadId: "provider-fork-source",
        sequence: 3,
        threadId: sourceThread.id,
        turnId: "turn-fork-source",
      });

      const response = await harness.app.request("/api/v1/threads/fork", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceThreadId: sourceThread.id,
          workspace: "isolated",
        }),
      });
      expect(response.status).toBe(201);
      const fork = threadResponseSchema.parse(await readJson(response));
      const forkEnvironmentId = getThread(harness.db, fork.id)?.environmentId;
      expect(forkEnvironmentId).not.toBeNull();
      const queued = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "environment.provision" &&
          command.environmentId === forkEnvironmentId,
      );
      expect(
        requireManagedWorktreeEnvironmentProvisionLiveCommand(queued).command
          .baseBranch,
      ).toBe("main");
    });
  });
});
