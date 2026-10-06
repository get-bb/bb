import { describe, expect, it } from "vitest";
import { registerFakeAiService } from "../helpers/ai-services.js";
import { generateCommitMessage } from "../../src/services/ai/commit-message.js";
import {
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const commitMessageArgs = {
  diffDescription: "uncommitted changes",
  files: "M\tfile.ts\n",
  patch:
    "diff --git a/file.ts b/file.ts\n@@ -1 +1,2 @@\n export {}\n+export const changed = true;\n",
  shortstat: "1 file changed, 1 insertion(+)\n",
};

function registerCodex(
  harness: TestAppHarness,
  complete: (prompt: string) => Promise<string>,
) {
  return registerFakeAiService(harness.deps.aiServices, {
    id: "codex",
    pluginId: "provider-codex",
    builtin: true,
    complete,
  });
}

async function commitThroughRoute(harness: TestAppHarness): Promise<string> {
  const { host } = seedHostSession(harness.deps);
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
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
      branch: { currentBranch: "feature", defaultBranch: "main" },
      checkout: { kind: "branch", branchName: "feature", headSha: null },
      mergeBase: null,
      workingTree: {
        deletions: 0,
        files: [],
        hasUncommittedChanges: true,
        insertions: 1,
        lineStatsComplete: true,
        state: "dirty_uncommitted",
      },
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
      diff: commitMessageArgs.patch,
      files: commitMessageArgs.files,
      mergeBaseRef: null,
      shortstat: commitMessageArgs.shortstat,
      truncated: false,
    },
  });

  const commitCommand = await waitForQueuedCommand(
    harness,
    ({ command }) =>
      command.type === "workspace.commit" &&
      command.environmentId === environment.id,
  );
  const message =
    commitCommand.command.type === "workspace.commit"
      ? commitCommand.command.message
      : "";
  await reportQueuedCommandSuccess(harness, commitCommand, {
    commitSha: "abc123",
    commitSubject: message,
  });

  const response = await responsePromise;
  expect(response.status).toBe(200);
  await expect(readJson(response)).resolves.toMatchObject({
    action: "commit",
    commitSubject: message,
    ok: true,
  });
  return message;
}

describe("commit message generation", () => {
  it("sends the diff prompt and returns the cleaned subject line", async () => {
    await withTestHarness({}, async (harness) => {
      const codex = registerCodex(
        harness,
        async () => '"fix: export the changed flag"\n\nLonger body',
      );

      await expect(
        generateCommitMessage(harness.deps, commitMessageArgs),
      ).resolves.toBe("fix: export the changed flag");
      const prompt = codex.completeCalls[0]?.prompt ?? "";
      expect(prompt).toContain("uncommitted changes");
      expect(prompt).toContain("+export const changed = true;");
      expect(prompt).toContain("M\tfile.ts");
    });
  });

  it("keeps the subject within 72 columns", async () => {
    await withTestHarness({}, async (harness) => {
      registerCodex(
        harness,
        async () =>
          "feat: add an extremely long commit subject that keeps going well past the conventional limit",
      );

      const message = await generateCommitMessage(
        harness.deps,
        commitMessageArgs,
      );
      expect(message?.length).toBeLessThanOrEqual(72);
      expect(message).toMatch(/^feat: add an extremely long commit subject/u);
    });
  });

  it("returns null when no AI service answers", async () => {
    await withTestHarness({}, async (harness) => {
      await expect(
        generateCommitMessage(harness.deps, commitMessageArgs),
      ).resolves.toBeNull();
      registerCodex(harness, async () => {
        throw new Error("Codex request failed");
      });
      await expect(
        generateCommitMessage(harness.deps, commitMessageArgs),
      ).resolves.toBeNull();
    });
  });

  it("commits with the generated message through the environment action", async () => {
    await withTestHarness({}, async (harness) => {
      registerCodex(harness, async () => "fix: export the changed flag");
      await expect(commitThroughRoute(harness)).resolves.toBe(
        "fix: export the changed flag",
      );
    });
  });

  it("commits with the fallback message when generation fails", async () => {
    await withTestHarness({}, async (harness) => {
      registerCodex(harness, async () => {
        throw new Error("Codex request failed");
      });
      await expect(commitThroughRoute(harness)).resolves.toBe(
        "bb: automated commit",
      );
    });
  });
});
