import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  markThreadDeleted,
  setExperiments,
  setThreadExecutionOverride,
} from "@bb/db";
import {
  DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_ENDPOINT,
  encodeClientTurnRequestIdNumber,
} from "@bb/domain";
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
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import { textInput } from "../helpers/prompt-input.js";
import { withTestHarness } from "../helpers/test-app.js";

interface WriteRuntimeSkillArgs {
  name: string;
  rootPath: string;
}

async function writeRuntimeSkill(args: WriteRuntimeSkillArgs): Promise<string> {
  const sourceRootPath = path.join(args.rootPath, args.name);
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
      parentProviderId: null,
      name: "defaults root-thread execution permission mode to full",
      requestedModel: "gpt-5",
    },
    {
      childProviderId: "codex",
      expectedPermissionMode: "full",
      parentProviderId: "codex",
      name: "defaults child execution permission mode to full without parent history or project defaults",
      requestedModel: "gpt-5",
    },
    {
      childProviderId: "pi",
      expectedPermissionMode: "full",
      parentProviderId: "pi",
      name: "defaults Pi child execution permission mode to full",
      requestedModel: "openai-codex/gpt-5.4",
    },
  ])("$name", async ({ childProviderId, expectedPermissionMode, parentProviderId, requestedModel }) => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: `host-runtime-${childProviderId}-${parentProviderId ?? "root"}`,
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const parentThread =
        parentProviderId === null
          ? null
          : seedThread(harness.deps, {
              projectId: project.id,
              environmentId: environment.id,
              providerId: parentProviderId,
            });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        parentThreadId: parentThread?.id ?? null,
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

  it("uses project permission defaults for child threads without parent execution history", async () => {
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
      const parentThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });
      const childThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        parentThreadId: parentThread.id,
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

  it("inherits live parent execution permission before project defaults", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-runtime-child-parent-execution-permission-mode",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const parentThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });
      seedThreadRuntimeState(harness.deps, {
        threadId: parentThread.id,
        environmentId: environment.id,
        providerThreadId: "provider-parent-permission-mode",
        permissionMode: "workspace-write",
      });
      const childThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        parentThreadId: parentThread.id,
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
      const deletedParent = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });
      markThreadDeleted(harness.db, harness.hub, {
        threadId: deletedParent.id,
      });
      const childThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        parentThreadId: deletedParent.id,
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
        name: "release-notes",
        rootPath: path.join(harness.config.dataDir, "skills"),
      });
      const builtinSourceRootPath = await writeRuntimeSkill({
        name: "bb-cli",
        rootPath: harness.config.builtinSkillsRootPath,
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
        input: textInput("hello"),
        projectId: project.id,
        providerId: "codex",
        requestId: encodeClientTurnRequestIdNumber({ value: 1 }),
        syncGeneratedTitle: false,
        thread,
      });

      expect(command.injectedSkillSources).toEqual([
        {
          sourceType: "builtin",
          name: "bb-cli",
          description: "Use bb-cli when server runtime tests run.",
          sourceRootPath: builtinSourceRootPath,
          skillFilePath: path.join(builtinSourceRootPath, "SKILL.md"),
        },
        {
          sourceType: "data-dir",
          name: "release-notes",
          description: "Use release-notes when server runtime tests run.",
          sourceRootPath,
          skillFilePath: path.join(sourceRootPath, "SKILL.md"),
        },
      ]);
    });
  });

  it("gates the bb-workflows skill on the workflows experiment", async () => {
    await withTestHarness(async (harness) => {
      const workflowsSkillRootPath = await writeRuntimeSkill({
        name: "bb-workflows",
        rootPath: harness.config.builtinSkillsRootPath,
      });
      await writeRuntimeSkill({
        name: "bb-cli",
        rootPath: harness.config.builtinSkillsRootPath,
      });
      const { host } = seedHostSession(harness.deps, {
        id: "host-runtime-workflows-experiment",
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
      const buildCommand = (requestValue: number) =>
        buildThreadStartCommand(harness.deps, {
          environment,
          execution,
          permissionEscalation: "ask",
          input: textInput("hello"),
          projectId: project.id,
          providerId: "codex",
          requestId: encodeClientTurnRequestIdNumber({ value: requestValue }),
          syncGeneratedTitle: false,
          thread,
        });

      // Experiments default to off: the bb-workflows skill never ships.
      const gated = await buildCommand(1);
      expect(gated.injectedSkillSources.map((skill) => skill.name)).toEqual([
        "bb-cli",
      ]);

      setExperiments(harness.db, {
        claudeCodeMockCliTraffic: false,
        workflows: true,
      });
      const enabled = await buildCommand(2);
      expect(enabled.injectedSkillSources.map((skill) => skill.name)).toEqual([
        "bb-cli",
        "bb-workflows",
      ]);
      expect(
        enabled.injectedSkillSources.find(
          (skill) => skill.name === "bb-workflows",
        )?.sourceRootPath,
      ).toBe(workflowsSkillRootPath);
    });
  });

  it("gates Claude Code mock CLI traffic on its experiment with the fixed endpoint", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-runtime-mock-cli-traffic-experiment",
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
      const buildCommand = (requestValue: number) =>
        buildThreadStartCommand(harness.deps, {
          environment,
          execution,
          permissionEscalation: "ask",
          input: textInput("hello"),
          projectId: project.id,
          providerId: "codex",
          requestId: encodeClientTurnRequestIdNumber({ value: requestValue }),
          syncGeneratedTitle: false,
          thread,
        });

      expect((await buildCommand(1)).options.claudeCodeMockCliTraffic).toEqual({
        enabled: false,
        endpoint: DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_ENDPOINT,
      });

      setExperiments(harness.db, {
        claudeCodeMockCliTraffic: true,
        workflows: false,
      });

      expect((await buildCommand(2)).options.claudeCodeMockCliTraffic).toEqual({
        enabled: true,
        endpoint: DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_ENDPOINT,
      });
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
      const parentThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
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
          thread: parentThread,
          initiator: "user",
        }),
      ).toBe("ask");
    });
  });

  it("resolves the workspace and host data-dir storage path", async () => {
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
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });

      const runtimeConfig = await resolveThreadRuntimeCommandConfig(
        harness.deps,
        {
          thread,
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

      expect(runtimeConfig.workspacePath).toBe("/tmp/runtime-project-root");
      expect(runtimeConfig.threadStoragePath).toBe(
        `/tmp/bb-host-data/${hostId}/thread-storage/${thread.id}`,
      );
      expect(runtimeConfig.workspaceProvisionType).toBe("unmanaged");
      expect(runtimeConfig.instructions).toContain(
        "You are working inside bb, an agentic IDE",
      );
    });
  });

});
