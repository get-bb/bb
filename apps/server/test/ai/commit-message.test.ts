import { afterEach, describe, expect, it } from "vitest";
import { updateHost } from "@bb/db";
import { registerFakeAiService } from "../helpers/ai-services.js";
import { generateCommitMessage } from "../../src/services/ai/commit-message.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
} from "../helpers/seed.js";
import { makeWorkspaceStatus } from "bb-plugin-bb--git/testing";
import { installGitPluginWithHost } from "../helpers/git-plugin.js";
import { installMachineProvider } from "../helpers/machine-provider.js";
import {
  setPluginMachineProviderBridge,
} from "../../src/services/plugins/plugin-machine-provider-registry.js";
import {
  startTestServer,
  withTestHarness,
  type RunningTestServer,
  type TestAppHarness,
} from "../helpers/test-app.js";

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

afterEach(() => {
  setPluginMachineProviderBridge(undefined);
});

async function commitThroughRoute(
  server: RunningTestServer,
  options: { suspended: boolean } = { suspended: false },
): Promise<string> {
  const { host, session } = seedHostSession(server.deps);
  const { project } = seedProjectWithSource(server.deps, {
    hostId: host.id,
  });
  const environment = seedEnvironment(server.deps, {
    hostId: host.id,
    projectId: project.id,
  });
  if (options.suspended) {
    installMachineProvider({
      resume: async () => ({ resource: { id: "restored" } }),
      suspend: async () => ({ resource: { id: "saved" } }),
    });
    updateHost(server.db, server.hub, host.id, {
      machineProviderId: "test-machine",
      phase: "suspended",
      resource: { id: "saved" },
      suspendedAt: 1,
    });
  }
  const commits: string[] = [];
  const responder = await installGitPluginWithHost(server, {
    hostId: host.id,
    sessionId: session.id,
    reads: {
      status: makeWorkspaceStatus({
        mergeBase: null,
        workingTree: {
          deletions: 0,
          files: [],
          hasUncommittedChanges: true,
          insertions: 1,
          lineStatsComplete: true,
          fileCount: 0,
          state: "dirty_uncommitted",
        },
      }),
      diff: {
        diff: commitMessageArgs.patch,
        files: commitMessageArgs.files,
        mergeBaseRef: null,
        shortstat: commitMessageArgs.shortstat,
        truncated: false,
      },
    },
    handleOther({ command }) {
      if (
        command.type !== "workspace.commit" ||
        command.environmentId !== environment.id
      ) {
        throw new Error(`unexpected host command ${command.type}`);
      }
      commits.push(command.message);
      return {
        ok: true,
        result: { commitSha: "abc123", commitSubject: command.message },
      };
    },
  });

  const response = await server.app.request(
    `/api/v1/environments/${environment.id}/actions`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "commit" }),
    },
  );
  expect(response.status).toBe(200);
  const [message = ""] = commits;
  await expect(readJson(response)).resolves.toMatchObject({
    action: "commit",
    commitSubject: message,
    ok: true,
  });
  expect(
    responder.requests.map((request) =>
      request.command.type === "plugin.host.call" ? request.command.method : null,
    ),
  ).toEqual(expect.arrayContaining(["status", "diff"]));
  responder.unregister();
  return message;
}

async function withGitServer(
  run: (server: RunningTestServer) => Promise<void>,
): Promise<void> {
  const server = await startTestServer();
  try {
    await run(server);
  } finally {
    await server.close();
  }
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
    await withGitServer(async (server) => {
      registerCodex(server, async () => "fix: export the changed flag");
      await expect(commitThroughRoute(server)).resolves.toBe(
        "fix: export the changed flag",
      );
    });
  });

  it("wakes a suspended machine before reading what to commit", async () => {
    await withGitServer(async (server) => {
      registerCodex(server, async () => "fix: export the changed flag");
      await expect(
        commitThroughRoute(server, { suspended: true }),
      ).resolves.toBe("fix: export the changed flag");
    });
  });

  it("commits with the fallback message when generation fails", async () => {
    await withGitServer(async (server) => {
      registerCodex(server, async () => {
        throw new Error("Codex request failed");
      });
      await expect(commitThroughRoute(server)).resolves.toBe(
        "bb: automated commit",
      );
    });
  });
});
