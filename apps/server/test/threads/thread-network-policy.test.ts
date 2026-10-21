import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  createProject,
  createThread,
  noopNotifier,
  threadPluginMetadata,
  upsertHost,
} from "@bb/db";
import { createMigratedConnection } from "@bb/db/testing";
import { encodeClientTurnRequestIdNumber } from "@bb/domain";
import { threadNetworkAccess } from "../../src/services/threads/thread-network-policy.js";
import {
  buildThreadStartCommand,
  prepareTurnSubmitCommandPayload,
} from "../../src/services/threads/thread-commands.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";
import { textInput } from "../helpers/prompt-input.js";

const databases: ReturnType<typeof createMigratedConnection>[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const db of databases.splice(0)) db.$client.close();
});

function restrictedThread(providerId: string) {
  const db = createMigratedConnection();
  databases.push(db);
  const host = upsertHost(db, noopNotifier, { name: "test-host" });
  const { project } = createProject(db, noopNotifier, {
    name: "test-project",
    source: { hostId: host.id, path: "/workspace", type: "local_path" },
  });
  const thread = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId,
    originPluginId: "automations",
    pluginMetadata: {
      pluginId: "automations",
      metadata: { networkAccess: false },
    },
  });
  return { db, thread };
}

describe("thread network policy", () => {
  it("fails closed when stored policy is unreadable", () => {
    const corrupt = restrictedThread("codex");
    corrupt.db
      .update(threadPluginMetadata)
      .set({ metadataJson: "{" })
      .where(eq(threadPluginMetadata.threadId, corrupt.thread.id))
      .run();
    expect(() => threadNetworkAccess(corrupt.db, corrupt.thread.id)).toThrow(
      "The thread's execution policy could not be read",
    );
  });

  it.each(["codex", "claude-code"])(
    "retains local-only permissions across %s session creation and subsequent turns",
    async (providerId) => {
      await withTestHarness(async (harness) => {
        const { host } = seedHostSession(harness.deps);
        const { project } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
        });
        const environment = seedEnvironment(harness.deps, {
          hostId: host.id,
          projectId: project.id,
          path: harness.config.dataDir,
        });
        const thread = createThread(harness.db, harness.hub, {
          projectId: project.id,
          environmentId: environment.id,
          providerId,
          originPluginId: "automations",
          pluginMetadata: {
            pluginId: "automations",
            metadata: { networkAccess: false },
          },
        });
        seedThreadRuntimeState(harness.deps, {
          environmentId: environment.id,
          providerThreadId: "provider-restricted",
          threadId: thread.id,
        });
        const execution = {
          model: providerId === "codex" ? "gpt-5" : "claude-sonnet-4-6",
          permissionMode: "full",
          reasoningLevel: "medium",
          serviceTier: "default",
          source: "client/turn/requested",
        } as const;
        const start = await buildThreadStartCommand(harness.deps, {
          environment,
          execution,
          fork: null,
          permissionEscalation: "ask",
          input: textInput("Work locally"),
          projectId: project.id,
          providerId,
          requestId: encodeClientTurnRequestIdNumber({ value: 1 }),
          syncGeneratedTitle: false,
          thread,
        });
        const turn = await prepareTurnSubmitCommandPayload(harness.deps, {
          environment,
          execution,
          permissionEscalation: "ask",
          input: textInput("Continue"),
          target: { mode: "start" },
          thread,
        });
        for (const options of [start.options, turn.options]) {
          expect(options).toMatchObject({
            networkAccess: false,
            permissionMode: "accept-edits",
            permissionScope: "workspace",
            approvalReviewer: "user",
            permissionEscalation: "deny",
          });
        }
        for (const command of [start, turn.resumeContext]) {
          expect(command.dynamicTools).toEqual([]);
          expect(command.injectedSkillSources).toEqual([]);
        }
        const getProvider = harness.deps.providerRegistry.get.bind(
          harness.deps.providerRegistry,
        );
        vi.spyOn(harness.deps.providerRegistry, "get").mockImplementation(
          (id) => {
            const registration = getProvider(id);
            return registration === null
              ? null
              : {
                  ...registration,
                  info: {
                    ...registration.info,
                    capabilities: {
                      ...registration.info.capabilities,
                      experimental_supportsNetworkIsolation: false,
                    },
                  },
                };
          },
        );
        await expect(
          prepareTurnSubmitCommandPayload(harness.deps, {
            environment,
            execution,
            permissionEscalation: "ask",
            input: textInput("Continue"),
            target: { mode: "start" },
            thread,
          }),
        ).rejects.toThrow("This agent cannot run with network access disabled");
      });
    },
  );
});
