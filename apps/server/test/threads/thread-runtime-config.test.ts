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
import {
  buildAcpLaunchSpec,
  buildThreadStartCommand,
  prepareTurnSubmitCommandPayload,
} from "../../src/services/threads/thread-commands.js";
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

interface WriteWorkspaceAgentInstructionsArgs {
  content: string;
  workspacePath: string;
}

interface WriteDataDirAgentInstructionsArgs {
  content: string;
  dataDir: string;
}

async function writeDataDirAgentInstructions(
  args: WriteDataDirAgentInstructionsArgs,
): Promise<void> {
  await writeFile(path.join(args.dataDir, "AGENTS.md"), args.content, "utf8");
}

async function writeWorkspaceAgentInstructions(
  args: WriteWorkspaceAgentInstructionsArgs,
): Promise<void> {
  const bbDir = path.join(args.workspacePath, ".bb");
  await mkdir(bbDir, { recursive: true });
  await writeFile(path.join(bbDir, "AGENTS.md"), args.content, "utf8");
}

describe("thread runtime config", () => {
  it("omits empty custom ACP modelCli from launch specs", () => {
    expect(
      buildAcpLaunchSpec({
        id: "custom",
        displayName: "Custom ACP",
        command: "custom-agent",
        args: [],
        env: {},
        modelCli: {
          listArgs: [],
          selectFlag: "--model",
          primaryModels: ["model-a"],
        },
      }),
    ).toEqual({
      displayName: "Custom ACP",
      command: "custom-agent",
      args: [],
      env: {},
    });
  });

  it("attaches custom ACP launch specs to thread start and turn submit commands", async () => {
    await withTestHarness(
      {
        customAcpAgents: [
          {
            id: "custom",
            displayName: "Custom ACP",
            command: "custom-agent",
            args: ["serve"],
            env: { CUSTOM_AGENT_TOKEN: "token" },
            cwd: "/agent-home",
            modelCli: {
              listArgs: ["models", "list"],
              selectFlag: "--model",
              primaryModels: ["model-a"],
            },
          },
        ],
      },
      async (harness) => {
        const { host } = seedHostSession(harness.deps, {
          id: "host-runtime-custom-acp",
        });
        const { project } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
        });
        const environment = seedEnvironment(harness.deps, {
          hostId: host.id,
          projectId: project.id,
          path: "/tmp/custom-acp",
        });
        const thread = seedThread(harness.deps, {
          projectId: project.id,
          environmentId: environment.id,
          providerId: "acp-custom",
        });
        seedThreadRuntimeState(harness.deps, {
          environmentId: environment.id,
          providerThreadId: "provider-custom",
          threadId: thread.id,
        });
        const execution = {
          model: "model-a",
          permissionMode: "workspace-write",
          reasoningLevel: "medium",
          serviceTier: "default",
          source: "client/turn/requested",
        } as const;
        const expectedSpec = {
          displayName: "Custom ACP",
          command: "custom-agent",
          args: ["serve"],
          env: { CUSTOM_AGENT_TOKEN: "token" },
          cwd: "/agent-home",
          modelCli: {
            listArgs: ["models", "list"],
            selectFlag: "--model",
            primaryModels: ["model-a"],
          },
        };

        const startCommand = await buildThreadStartCommand(harness.deps, {
          environment,
          execution,
          fork: null,
          permissionEscalation: "ask",
          input: textInput("hello"),
          projectId: project.id,
          providerId: "acp-custom",
          requestId: encodeClientTurnRequestIdNumber({ value: 101 }),
          syncGeneratedTitle: false,
          thread,
        });
        expect(startCommand.acpLaunchSpec).toEqual(expectedSpec);
        expect(startCommand.dynamicTools).toEqual([
          expect.objectContaining({
            name: "update_environment_directory",
          }),
        ]);
        expect(startCommand.instructions).toContain(
          "update_environment_directory",
        );

        const submitCommand = await prepareTurnSubmitCommandPayload(
          harness.deps,
          {
            environment,
            execution,
            permissionEscalation: "ask",
            input: textInput("continue"),
            target: { mode: "start" },
            thread,
          },
        );
        expect(submitCommand.acpLaunchSpec).toEqual(expectedSpec);
        expect(submitCommand.resumeContext.acpLaunchSpec).toEqual(expectedSpec);
        expect(submitCommand.resumeContext.dynamicTools).toEqual([
          expect.objectContaining({
            name: "update_environment_directory",
          }),
        ]);
        expect(submitCommand.resumeContext.instructions).toContain(
          "update_environment_directory",
        );
      },
    );
  });

  it("attaches known ACP launch specs to thread start and turn submit commands", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-runtime-known-acp",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/known-acp",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        providerId: "acp-opencode",
      });
      seedThreadRuntimeState(harness.deps, {
        environmentId: environment.id,
        providerThreadId: "provider-opencode",
        threadId: thread.id,
      });
      const execution = {
        model: "opencode/default",
        permissionMode: "workspace-write",
        reasoningLevel: "medium",
        serviceTier: "default",
        source: "client/turn/requested",
      } as const;
      const expectedSpec = {
        displayName: "opencode",
        command: "opencode",
        args: ["acp"],
        env: {},
      };

      const startCommand = await buildThreadStartCommand(harness.deps, {
        environment,
        execution,
        fork: null,
        permissionEscalation: "ask",
        input: textInput("hello"),
        projectId: project.id,
        providerId: "acp-opencode",
        requestId: encodeClientTurnRequestIdNumber({ value: 102 }),
        syncGeneratedTitle: false,
        thread,
      });
      expect(startCommand.acpLaunchSpec).toEqual(expectedSpec);
      expect(startCommand.dynamicTools).toEqual([
        expect.objectContaining({
          name: "update_environment_directory",
        }),
      ]);
      expect(startCommand.instructions).toContain(
        "update_environment_directory",
      );

      const submitCommand = await prepareTurnSubmitCommandPayload(
        harness.deps,
        {
          environment,
          execution,
          permissionEscalation: "ask",
          input: textInput("continue"),
          target: { mode: "start" },
          thread,
        },
      );
      expect(submitCommand.acpLaunchSpec).toEqual(expectedSpec);
      expect(submitCommand.resumeContext.acpLaunchSpec).toEqual(expectedSpec);
      expect(submitCommand.resumeContext.dynamicTools).toEqual([
        expect.objectContaining({
          name: "update_environment_directory",
        }),
      ]);
      expect(submitCommand.resumeContext.instructions).toContain(
        "update_environment_directory",
      );
    });
  });

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
  ])(
    "$name",
    async ({
      childProviderId,
      expectedPermissionMode,
      parentProviderId,
      requestedModel,
    }) => {
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
    },
  );

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
      const workspacePath = path.join(
        harness.config.dataDir,
        "runtime-skill-workspace",
      );
      const projectSourceRootPath = await writeRuntimeSkill({
        name: "project-helper",
        rootPath: path.join(workspacePath, ".bb", "skills"),
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
        path: workspacePath,
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
        fork: null,
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
          sourceType: "project",
          name: "project-helper",
          description: "Use project-helper when server runtime tests run.",
          sourceRootPath: projectSourceRootPath,
          skillFilePath: path.join(projectSourceRootPath, "SKILL.md"),
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
          fork: null,
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
        popoutChat: false,
        popoutChatHotkey: "Alt+Space",
        plugins: false,
        uiForking: false,
      });

      expect((await buildCommand(2)).options.claudeCodeMockCliTraffic).toEqual({
        enabled: true,
        endpoint: DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_ENDPOINT,
      });
    });
  });

  it("sets Claude Code native plan mode when the prompt starts from a plan command pill", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-runtime-claude-plan",
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
      const input = [
        {
          type: "text" as const,
          text: "/plan inspect the failing test",
          mentions: [
            {
              start: 0,
              end: 5,
              resource: {
                kind: "command" as const,
                trigger: "/" as const,
                name: "plan",
                source: "command" as const,
                origin: "user" as const,
                label: "plan",
                argumentHint: null,
              },
            },
          ],
        },
      ];

      const command = await buildThreadStartCommand(harness.deps, {
        environment,
        execution: {
          model: "claude-sonnet-4-6",
          permissionMode: "workspace-write",
          reasoningLevel: "medium",
          serviceTier: "default",
          source: "client/turn/requested",
        },
        fork: null,
        permissionEscalation: "ask",
        input,
        projectId: project.id,
        providerId: "claude-code",
        requestId: encodeClientTurnRequestIdNumber({ value: 1 }),
        syncGeneratedTitle: false,
        thread,
      });

      expect(command.input).toEqual(input);
      expect(command.options.claudeCodePermissionMode).toBe("plan");
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
      const sideChatThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        originKind: "side-chat",
        sourceThreadId: rootThread.id,
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
          thread: sideChatThread,
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

  it("resolves the workspace, storage path, and environment directory dynamic tool", async () => {
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
      expect(runtimeConfig.dynamicTools).toEqual([
        expect.objectContaining({
          name: "update_environment_directory",
          inputSchema: expect.objectContaining({
            required: ["path"],
          }),
        }),
      ]);
      expect(runtimeConfig.instructions).toContain(
        "You are working inside bb, an agentic IDE",
      );
      expect(runtimeConfig.instructions).toContain("bb status");
      expect(runtimeConfig.instructions).toContain("bb guide");
      expect(runtimeConfig.instructions).toContain("Markdown links");
      expect(runtimeConfig.instructions).toContain(
        "update_environment_directory",
      );
    });
  });

  it("does not expose mutable dynamic tools for side chat threads", async () => {
    await withTestHarness(async (harness) => {
      const hostId = "host-side-chat-runtime";
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
      const mainThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });
      const sideChatThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        originKind: "side-chat",
        sourceThreadId: mainThread.id,
      });

      const runtimeConfig = await resolveThreadRuntimeCommandConfig(
        harness.deps,
        {
          thread: sideChatThread,
          environment: {
            hostId: environment.hostId,
            id: environment.id,
            path: environment.path,
            status: environment.status,
            workspaceProvisionType: environment.workspaceProvisionType,
          },
        },
      );

      expect(runtimeConfig.dynamicTools).toEqual([]);
      expect(runtimeConfig.instructions).not.toContain(
        "update_environment_directory",
      );
      expect(runtimeConfig.instructions).not.toContain(
        "bb_send_to_main_thread",
      );
      expect(runtimeConfig.instructions).not.toContain("Side chat handoff");
    });
  });

  it("appends workspace .bb/AGENTS.md instructions to the standard agent instructions", async () => {
    await withTestHarness(async (harness) => {
      const hostId = "host-runtime-agents-md";
      seedHostSession(harness.deps, { id: hostId });
      const workspacePath = path.join(
        harness.config.dataDir,
        "agents-md-workspace",
      );
      const { project } = seedProjectWithSource(harness.deps, {
        hostId,
        path: workspacePath,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId,
        projectId: project.id,
        path: workspacePath,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        providerId: "codex",
      });
      await writeWorkspaceAgentInstructions({
        content:
          "# Project Rules\n\nAlways run the smoke test before pushing.\n",
        workspacePath,
      });

      const runtimeConfig = await resolveThreadRuntimeCommandConfig(
        harness.deps,
        {
          thread,
          environment: {
            hostId: environment.hostId,
            id: environment.id,
            path: environment.path,
            status: environment.status,
            workspaceProvisionType: environment.workspaceProvisionType,
          },
        },
      );

      expect(runtimeConfig.instructionMode).toBe("append");
      expect(runtimeConfig.instructions).toContain(
        "You are working inside bb, an agentic IDE",
      );
      expect(runtimeConfig.instructions).toContain(
        "The following workspace instructions come from .bb/AGENTS.md:",
      );
      expect(runtimeConfig.instructions).toContain(
        "Always run the smoke test before pushing.",
      );
    });
  });

  it("appends data-dir AGENTS.md instructions before workspace instructions", async () => {
    await withTestHarness(async (harness) => {
      const hostId = "host-runtime-data-dir-agents-md";
      seedHostSession(harness.deps, { id: hostId });
      const workspacePath = path.join(
        harness.config.dataDir,
        "data-dir-agents-md-workspace",
      );
      const { project } = seedProjectWithSource(harness.deps, {
        hostId,
        path: workspacePath,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId,
        projectId: project.id,
        path: workspacePath,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        providerId: "codex",
      });
      await writeDataDirAgentInstructions({
        content: "# User Rules\n\nPrefer concise progress updates.\n",
        dataDir: harness.config.dataDir,
      });
      await writeWorkspaceAgentInstructions({
        content:
          "# Project Rules\n\nAlways run the smoke test before pushing.\n",
        workspacePath,
      });

      const runtimeConfig = await resolveThreadRuntimeCommandConfig(
        harness.deps,
        {
          thread,
          environment: {
            hostId: environment.hostId,
            id: environment.id,
            path: environment.path,
            status: environment.status,
            workspaceProvisionType: environment.workspaceProvisionType,
          },
        },
      );

      const userSource =
        "The following user instructions come from <dataDir>/AGENTS.md:";
      const workspaceSource =
        "The following workspace instructions come from .bb/AGENTS.md:";
      expect(runtimeConfig.instructions).toContain(userSource);
      expect(runtimeConfig.instructions).toContain(
        "Prefer concise progress updates.",
      );
      expect(runtimeConfig.instructions).toContain(workspaceSource);
      expect(runtimeConfig.instructions).toContain(
        "Always run the smoke test before pushing.",
      );
      expect(runtimeConfig.instructions.indexOf(userSource)).toBeLessThan(
        runtimeConfig.instructions.indexOf(workspaceSource),
      );
    });
  });
});
