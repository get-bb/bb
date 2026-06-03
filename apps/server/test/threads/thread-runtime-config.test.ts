import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { markThreadDeleted, setThreadExecutionOverride } from "@bb/db";
import { encodeClientTurnRequestIdNumber } from "@bb/domain";
import {
  resolvePermissionEscalation,
  resolveExecutionOptions,
  resolveThreadRuntimeCommandConfig,
} from "../../src/services/threads/thread-runtime-config.js";
import { buildThreadStartCommand } from "../../src/services/threads/thread-commands.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

function resolveLocalTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

interface WriteRuntimeSkillArgs {
  dataDir: string;
  name: string;
}

async function writeRuntimeSkill(args: WriteRuntimeSkillArgs): Promise<string> {
  const sourceRootPath = path.join(args.dataDir, "skills", args.name);
  await mkdir(sourceRootPath, { recursive: true });
  await writeFile(
    path.join(sourceRootPath, "SKILL.md"),
    [
      "---",
      `name: ${args.name}`,
      `description: Use ${args.name} when server runtime tests run.`,
      "---",
      "",
      "# Test Skill",
      "",
    ].join("\n"),
    "utf8",
  );
  return sourceRootPath;
}

describe("thread runtime config", () => {
  it.each([
    {
      childProviderId: "codex",
      expectedPermissionMode: "full",
      managerProviderId: null,
      name: "defaults root-thread execution permission mode to full",
      requestedModel: "gpt-5",
    },
    {
      childProviderId: "codex",
      expectedPermissionMode: "workspace-write",
      managerProviderId: "codex",
      name: "defaults managed child execution permission mode to workspace-write when supported",
      requestedModel: "gpt-5",
    },
    {
      childProviderId: "pi",
      expectedPermissionMode: "full",
      managerProviderId: "pi",
      name: "falls back to full for managed child execution when the provider does not support workspace-write",
      requestedModel: "openai-codex/gpt-5.4",
    },
  ])("$name", async ({ childProviderId, expectedPermissionMode, managerProviderId, requestedModel }) => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: `host-runtime-${childProviderId}-${managerProviderId ?? "root"}`,
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const managerThread =
        managerProviderId === null
          ? null
          : seedThread(harness.deps, {
              projectId: project.id,
              environmentId: environment.id,
              type: "manager",
              providerId: managerProviderId,
            });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        parentThreadId: managerThread?.id ?? null,
        providerId: childProviderId,
      });

      const execution = await resolveExecutionOptions(harness.deps, {
        threadId: thread.id,
        requestedExecution: {
          model: requestedModel,
          source: "client/turn/requested",
        },
      });

      expect(execution.permissionMode).toBe(expectedPermissionMode);
    });
  });

  it("ignores standard project permission defaults for managed child execution", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-runtime-managed-child-project-default-permission-mode",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const managerThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        type: "manager",
      });
      const childThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        parentThreadId: managerThread.id,
        providerId: "codex",
      });

      const execution = await resolveExecutionOptions(harness.deps, {
        threadId: childThread.id,
        projectDefaults: {
          providerId: "codex",
          model: "gpt-5",
          reasoningLevel: "medium",
          permissionMode: "full",
          serviceTier: "default",
        },
        requestedExecution: {
          model: "gpt-5",
          source: "client/turn/requested",
        },
      });

      expect(execution.permissionMode).toBe("workspace-write");
    });
  });

  it("treats ghost parent references as root-thread execution defaults", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-runtime-deleted-parent-permission-mode",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const deletedManager = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        type: "manager",
      });
      markThreadDeleted(harness.db, harness.hub, {
        threadId: deletedManager.id,
      });
      const childThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        parentThreadId: deletedManager.id,
        providerId: "codex",
      });

      const execution = await resolveExecutionOptions(harness.deps, {
        threadId: childThread.id,
        projectDefaults: {
          providerId: "codex",
          model: "gpt-5",
          reasoningLevel: "medium",
          permissionMode: "readonly",
          serviceTier: "default",
        },
        requestedExecution: {
          model: "gpt-5",
          source: "client/turn/requested",
        },
      });

      expect(execution.permissionMode).toBe("readonly");
    });
  });

  it("honors requested workspace-write permission mode when the provider supports it", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-runtime-permission-mode-workspace-write",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });

      const execution = await resolveExecutionOptions(harness.deps, {
        threadId: thread.id,
        requestedExecution: {
          model: "gpt-5",
          permissionMode: "workspace-write",
          source: "client/turn/requested",
        },
      });

      expect(execution.permissionMode).toBe("workspace-write");
    });
  });

  it("rejects permission modes unsupported by the provider", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-runtime-permission-mode-unsupported",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        providerId: "pi",
      });

      await expect(
        resolveExecutionOptions(harness.deps, {
          threadId: thread.id,
          requestedExecution: {
            model: "openai/codex-mini",
            permissionMode: "workspace-write",
            source: "client/turn/requested",
          },
        }),
      ).rejects.toThrow("Provider pi only supports full permission mode.");
    });
  });

  it("rejects reasoning levels unsupported by the provider", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-runtime-reasoning-level-unsupported",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        providerId: "codex",
      });

      await expect(
        resolveExecutionOptions(harness.deps, {
          threadId: thread.id,
          requestedExecution: {
            model: "gpt-5.4",
            reasoningLevel: "max",
            source: "client/turn/requested",
          },
        }),
      ).rejects.toThrow(
        "Provider codex does not support max reasoning level. Supported reasoning levels: low, medium, high, xhigh.",
      );
    });
  });

  it("serializes injected skill sources into new thread start commands", async () => {
    await withTestHarness(async (harness) => {
      const sourceRootPath = await writeRuntimeSkill({
        dataDir: harness.config.dataDir,
        name: "release-notes",
      });
      const { host } = seedHostSession(harness.deps, {
        id: "host-runtime-injected-skills",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        providerId: "codex",
      });
      const execution = await resolveExecutionOptions(harness.deps, {
        threadId: thread.id,
        requestedExecution: {
          model: "gpt-5",
          source: "client/turn/requested",
        },
      });

      const command = await buildThreadStartCommand(harness.deps, {
        environment,
        execution,
        permissionEscalation: "ask",
        input: [{ type: "text", text: "hello" }],
        projectId: project.id,
        providerId: "codex",
        requestId: encodeClientTurnRequestIdNumber({ value: 1 }),
        thread,
      });

      expect(command.injectedSkillSources).toEqual([
        {
          sourceType: "data-dir",
          applicationId: null,
          name: "release-notes",
          description: "Use release-notes when server runtime tests run.",
          sourceRootPath,
          skillFilePath: path.join(sourceRootPath, "SKILL.md"),
        },
      ]);
    });
  });

  it("consumes the sticky thread execution override across turns without a request value", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-runtime-execution-override",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        providerId: "claude-code",
      });

      setThreadExecutionOverride(harness.db, {
        threadId: thread.id,
        modelOverride: "claude-opus-4-8",
        reasoningLevelOverride: "high",
      });

      // No model/reasoning in the request: the override sticks for this turn.
      const execution = await resolveExecutionOptions(harness.deps, {
        threadId: thread.id,
        requestedExecution: { source: "client/turn/requested" },
      });
      expect(execution.model).toBe("claude-opus-4-8");
      expect(execution.reasoningLevel).toBe("high");

      // An explicit per-turn request still wins over the sticky override.
      const oneOff = await resolveExecutionOptions(harness.deps, {
        threadId: thread.id,
        requestedExecution: {
          model: "claude-sonnet-4-6",
          reasoningLevel: "low",
          source: "client/turn/requested",
        },
      });
      expect(oneOff.model).toBe("claude-sonnet-4-6");
      expect(oneOff.reasoningLevel).toBe("low");
    });
  });

  it("derives ask escalation only for direct user root-thread work", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-runtime-permission-escalation",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const rootThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });
      const childThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        parentThreadId: rootThread.id,
      });
      const managerThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        type: "manager",
      });

      expect(
        resolvePermissionEscalation({
          thread: rootThread,
          initiator: "user",
        }),
      ).toBe("ask");
      expect(
        resolvePermissionEscalation({
          thread: rootThread,
          initiator: "system",
        }),
      ).toBe("deny");
      expect(
        resolvePermissionEscalation({
          thread: childThread,
          initiator: "user",
        }),
      ).toBe("deny");
      expect(
        resolvePermissionEscalation({
          thread: managerThread,
          initiator: "user",
        }),
      ).toBe("deny");
    });
  });

  it("uses the project root as cwd and a host data-dir workspace for managers", async () => {
    await withTestHarness(async (harness) => {
      const hostId = "host-runtime";
      seedHostSession(harness.deps, { id: hostId });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId,
        path: "/tmp/runtime-project-root",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId,
        projectId: project.id,
        path: "/tmp/runtime-project-root",
      });
      const managerThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        type: "manager",
      });

      const runtimeConfig = await resolveThreadRuntimeCommandConfig(
        harness.deps,
        {
          thread: managerThread,
          environment: {
            cleanupRequestedAt: environment.cleanupRequestedAt,
            hostId: environment.hostId,
            id: environment.id,
            path: environment.path,
            status: environment.status,
            workspaceProvisionType: environment.workspaceProvisionType,
          },
        },
      );

      expect(runtimeConfig.instructions).toContain(
        "Project root: `/tmp/runtime-project-root`",
      );
      expect(runtimeConfig.instructions).toContain(
        `BB data dir: \`/tmp/bb-host-data/${hostId}\``,
      );
      expect(runtimeConfig.instructions).toContain(
        `Thread storage: \`/tmp/bb-host-data/${hostId}/thread-storage/${managerThread.id}\``,
      );
      expect(runtimeConfig.instructions).toContain(
        `Local timezone: \`${resolveLocalTimezone()}\``,
      );
    });
  });

});
