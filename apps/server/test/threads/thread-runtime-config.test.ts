import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  markThreadDeleted,
  setAppSettings,
  setExperiments,
  setThreadExecutionOverride,
} from "@bb/db";
import {
  DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_ENDPOINT,
  defaultAppSettings,
  defaultExperiments,
  encodeClientTurnRequestIdNumber,
} from "@bb/domain";
import type { DiscoveredSkill } from "@bb/host-daemon-contract";
import { setPluginAgentContributions } from "../../src/services/plugins/plugin-agent-contributions.js";
import { readSkillTreeManifest } from "../../src/services/skills/injected-skills.js";
import type { PluginAgentToolContribution } from "../../src/services/plugins/plugin-service.js";
import {
  resolvePermissionEscalation,
  resolveExecutionOptions,
  resolveThreadRuntimeCommandConfig,
} from "../../src/services/threads/thread-runtime-config.js";
import {
  buildThreadStartCommand,
  prepareTurnSubmitCommandPayload,
} from "../../src/services/threads/thread-commands.js";
import {
  seedEnvironment,
  seedHostSession,
  seedPrimaryHost,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import {
  registerHostRpcResponder,
  type HostRpcResponder,
} from "../helpers/host-rpc.js";
import { registerFakeProviders } from "../helpers/provider-registry.js";
import type { TestAppHarness } from "../helpers/test-app.js";
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

function registerRemoteRuntimeFileResponder(
  harness: TestAppHarness,
  args: {
    files: ReadonlyMap<string, string>;
    hostId: string;
    sessionId: string;
    sharedSkills?: DiscoveredSkill[];
  },
): HostRpcResponder {
  return registerHostRpcResponder(harness, {
    hostId: args.hostId,
    sessionId: args.sessionId,
    handle: ({ command }) => {
      if (command.type === "host.list_files") {
        const prefix = `${command.path}${path.sep}`;
        const files = [...args.files.keys()]
          .filter((filePath) => filePath.startsWith(prefix))
          .map((filePath) => path.relative(command.path, filePath))
          .filter((relativePath) => {
            const segments = relativePath.split(path.sep);
            return segments.length === 2 && segments[1] === "SKILL.md";
          })
          .sort()
          .slice(0, command.limit)
          .map((relativePath) => ({
            name: path.basename(relativePath),
            path: relativePath.split(path.sep).join("/"),
          }));
        return { ok: true, result: { files, truncated: false } };
      }
      if (command.type === "host.read_file") {
        const content = args.files.get(command.path);
        if (content === undefined) {
          return {
            ok: false,
            errorCode: "ENOENT",
            errorMessage: `Path does not exist: ${command.path}`,
          };
        }
        const bytes = Buffer.from(content, "utf8");
        return {
          ok: true,
          result: {
            path: command.path,
            content,
            contentEncoding: "utf8",
            sha256: createHash("sha256").update(bytes).digest("hex"),
            sizeBytes: bytes.length,
          },
        };
      }
      if (command.type === "host.list_skills") {
        return {
          ok: true,
          result: { skills: args.sharedSkills ?? [] },
        };
      }
      throw new Error(`Unexpected remote runtime RPC ${command.type}`);
    },
  });
}

describe("thread runtime config", () => {
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
            supportsManualCompaction: false,
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
          permissionMode: "accept-edits",
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

  it.each([
    {
      expectedSpec: {
        displayName: "opencode",
        command: "opencode",
        args: ["acp"],
        env: {},
      },
      providerId: "acp-opencode",
      requestedModel: "opencode/default",
    },
    {
      expectedSpec: {
        displayName: "Grok Build",
        command: "grok",
        args: ["agent", "stdio"],
        env: {},
        modelCli: {
          listArgs: ["models"],
          selectFlag: "--model",
          primaryModels: ["grok-4.5", "grok-composer-2.5-fast"],
        },
        permissionCli: {
          full: ["--always-approve"],
          insertAfterArgs: 1,
        },
        reasoningCli: {
          flag: "--reasoning-effort",
          supportedLevels: ["low", "medium", "high"],
          levelValues: {
            none: "low",
            xhigh: "high",
            ultracode: "high",
            max: "high",
          },
          defaultLevel: "high",
        },
      },
      providerId: "acp-grok",
      requestedModel: "grok-4.5",
    },
    {
      expectedSpec: {
        displayName: "Hermes Agent",
        command: "hermes",
        args: ["acp"],
        env: {},
        nativeReasoning: {
          configId: "reasoning_effort",
          supportedLevels: ["none", "low", "medium", "high", "xhigh", "max"],
          defaultLevel: "medium",
        },
      },
      providerId: "acp-hermes-agent",
      requestedModel: "acp-default",
    },
  ])(
    "attaches known ACP launch specs for $providerId to thread start and turn submit commands",
    async ({ expectedSpec, providerId, requestedModel }) => {
      await withTestHarness(async (harness) => {
        const { host } = seedHostSession(harness.deps, {
          id: `host-runtime-known-${providerId}`,
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
          providerId,
        });
        seedThreadRuntimeState(harness.deps, {
          environmentId: environment.id,
          providerThreadId: `provider-${providerId}`,
          threadId: thread.id,
        });
        const execution = {
          model: requestedModel,
          permissionMode: "accept-edits",
          reasoningLevel: "medium",
          serviceTier: "default",
          source: "client/turn/requested",
        } as const;

        const startCommand = await buildThreadStartCommand(harness.deps, {
          environment,
          execution,
          fork: null,
          permissionEscalation: "ask",
          input: textInput("hello"),
          projectId: project.id,
          providerId,
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
    },
  );

  it.each([
    {
      childProviderId: "codex",
      expectedPermissionMode: "auto",
      parentProviderId: null,
      name: "defaults root-thread execution permission mode to auto",
      requestedModel: "gpt-5",
    },
    {
      childProviderId: "codex",
      expectedPermissionMode: "auto",
      parentProviderId: "codex",
      name: "defaults child execution permission mode to auto without parent history or project defaults",
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
          permissionMode: "accept-edits",
          serviceTier: "default",
        },
        requestedExecution: {
          model: "gpt-5",
          source: "client/turn/requested",
        },
      });

      expect(execution.permissionMode).toBe("accept-edits");
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
        permissionMode: "accept-edits",
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
          permissionMode: "accept-edits",
          serviceTier: "default",
        },
        requestedExecution: {
          model: "gpt-5",
          source: "client/turn/requested",
        },
      });

      expect(execution.permissionMode).toBe("accept-edits");
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
          permissionMode: "accept-edits",
          serviceTier: "default",
        },
        requestedExecution: {
          model: "gpt-5",
          source: "client/turn/requested",
        },
      });

      expect(execution.permissionMode).toBe("accept-edits");
    });
  });

  it("honors requested Accept Edits permission mode when the provider supports it", async () => {
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
          permissionMode: "accept-edits",
          source: "client/turn/requested",
        },
      });

      expect(execution.permissionMode).toBe("accept-edits");
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
            permissionMode: "accept-edits",
            source: "client/turn/requested",
          },
        }),
      ).rejects.toThrow("Provider pi only supports full permission mode.");
    });
  });

  it.each(["none", "max"] as const)(
    "accepts %s reasoning for Pi sessions",
    async (reasoningLevel) => {
      await withTestHarness(async (harness) => {
        const { host } = seedHostSession(harness.deps, {
          id: `host-runtime-pi-${reasoningLevel}-reasoning`,
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

        const execution = await resolveExecutionOptions(harness.deps, {
          threadId: thread.id,
          requestedExecution: {
            model: "openai-codex/gpt-5.6-luna",
            permissionMode: "full",
            reasoningLevel,
            source: "client/turn/requested",
          },
        });

        expect(execution.reasoningLevel).toBe(reasoningLevel);
      });
    },
  );

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
            reasoningLevel: "ultracode",
            source: "client/turn/requested",
          },
        }),
      ).rejects.toThrow(
        "Provider codex does not support ultracode reasoning level. Supported reasoning levels: low, medium, high, xhigh, max, ultra.",
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
          kind: "tree",
          sourceType: "builtin",
          name: "bb-cli",
          description: "Use bb-cli when server runtime tests run.",
          treeHash: readSkillTreeManifest(builtinSourceRootPath).treeHash,
          entryPath: "SKILL.md",
        },
        {
          kind: "workspace-path",
          sourceType: "project",
          name: "project-helper",
          description: "Use project-helper when server runtime tests run.",
          sourceRootPath: projectSourceRootPath,
          skillFilePath: path.join(projectSourceRootPath, "SKILL.md"),
        },
        {
          kind: "tree",
          sourceType: "data-dir",
          name: "release-notes",
          description: "Use release-notes when server runtime tests run.",
          treeHash: readSkillTreeManifest(sourceRootPath).treeHash,
          entryPath: "SKILL.md",
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
        editMessages: false,
        newOnboarding: false,
        providerSessionReaping: false,
      });

      expect((await buildCommand(2)).options.claudeCodeMockCliTraffic).toEqual({
        enabled: true,
        endpoint: DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_ENDPOINT,
      });
    });
  });

  it("resolves native memory preferences independently for Codex and Claude Code", async () => {
    await withTestHarness(async (harness) => {
      setAppSettings(harness.db, {
        ...defaultAppSettings,
        codexMemoryEnabled: false,
        claudeCodeMemoryEnabled: true,
      });
      const { host } = seedHostSession(harness.deps, {
        id: "host-provider-memory-settings",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });

      async function build(providerId: "codex" | "claude-code") {
        const thread = seedThread(harness.deps, {
          projectId: project.id,
          environmentId: environment.id,
          providerId,
        });
        const execution = await resolveExecutionOptions(harness.deps, {
          threadId: thread.id,
          requestedExecution: {
            model: providerId === "codex" ? "gpt-5" : "claude-sonnet-4-6",
            source: "client/turn/requested",
          },
        });
        return buildThreadStartCommand(harness.deps, {
          environment,
          execution,
          fork: null,
          permissionEscalation: "ask",
          input: textInput("hello"),
          projectId: project.id,
          providerId,
          requestId: encodeClientTurnRequestIdNumber({ value: 1 }),
          syncGeneratedTitle: false,
          thread,
        });
      }

      expect((await build("codex")).options.memoryEnabled).toBe(false);
      expect((await build("claude-code")).options.memoryEnabled).toBe(true);
    });
  });

  it("carries provider-native feature settings independently", async () => {
    await withTestHarness(async (harness) => {
      setAppSettings(harness.db, {
        ...defaultAppSettings,
        codexSubagentsDisabled: true,
        claudeCodeSubagentsDisabled: true,
        claudeCodeWorkflowsDisabled: true,
      });
      const { host } = seedHostSession(harness.deps, {
        id: "host-provider-subagent-settings",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });

      async function build(providerId: "codex" | "claude-code") {
        const thread = seedThread(harness.deps, {
          projectId: project.id,
          environmentId: environment.id,
          providerId,
        });
        const execution = await resolveExecutionOptions(harness.deps, {
          threadId: thread.id,
          requestedExecution: {
            model: providerId === "codex" ? "gpt-5" : "claude-sonnet-4-6",
            source: "client/turn/requested",
          },
        });
        return buildThreadStartCommand(harness.deps, {
          environment,
          execution,
          fork: null,
          permissionEscalation: "ask",
          input: textInput("hello"),
          projectId: project.id,
          providerId,
          requestId: encodeClientTurnRequestIdNumber({ value: 1 }),
          syncGeneratedTitle: false,
          thread,
        });
      }

      const codex = await build("codex");
      expect(codex.options.providerSubagentsEnabled).toBe(false);
      expect(codex.disallowedTools).toBeUndefined();

      const claudeCode = await build("claude-code");
      expect(claudeCode.options.providerSubagentsEnabled).toBe(false);
      expect(claudeCode.options.workflowsEnabled).toBe(false);
      expect(claudeCode.disallowedTools).toBeUndefined();
    });
  });

  it("scopes the Claude workflows toggle to claude-code only", async () => {
    await withTestHarness(async (harness) => {
      // A non-Claude provider that declares `supportsWorkflows: true`, like
      // the first third-party workflow provider would.
      registerFakeProviders(
        harness.deps.providerRegistry,
        harness.deps.pluginHostArtifacts,
      );
      setAppSettings(harness.db, {
        ...defaultAppSettings,
        claudeCodeWorkflowsDisabled: true,
      });
      const { host } = seedHostSession(harness.deps, {
        id: "host-provider-workflows-scope",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });

      async function build(providerId: "fake" | "claude-code", model: string) {
        const thread = seedThread(harness.deps, {
          projectId: project.id,
          environmentId: environment.id,
          providerId,
        });
        return buildThreadStartCommand(harness.deps, {
          environment,
          execution: {
            model,
            permissionMode: "auto",
            reasoningLevel: "medium",
            serviceTier: "default",
            source: "client/turn/requested",
          },
          fork: null,
          permissionEscalation: "ask",
          input: textInput("hello"),
          projectId: project.id,
          providerId,
          requestId: encodeClientTurnRequestIdNumber({ value: 1 }),
          syncGeneratedTitle: false,
          thread,
        });
      }

      // Claude Code honors the Claude-named toggle.
      const claudeCode = await build("claude-code", "claude-sonnet-4-6");
      expect(claudeCode.options.workflowsEnabled).toBe(false);

      // Another workflows-capable provider is unaffected by it.
      const fake = await build("fake", "fake-model");
      expect(fake.options.workflowsEnabled).toBe(true);
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
          permissionMode: "accept-edits",
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

  it("derives ask escalation for user-initiated work on root and child threads", async () => {
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
        originKind: "fork",
        originPluginId: "side-chat",
        visibility: "hidden",
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
      ).toBe("ask");
      expect(
        resolvePermissionEscalation({
          thread: childThread,
          initiator: "system",
        }),
      ).toBe("deny");
      expect(
        resolvePermissionEscalation({
          thread: sideChatThread,
          initiator: "user",
        }),
      ).toBe("ask");
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
          model: "test-model",
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

  it("keeps local-host workspace .bb/AGENTS.md instructions unchanged", async () => {
    await withTestHarness(async (harness) => {
      const hostId = "host-runtime-agents-md";
      seedHostSession(harness.deps, { id: hostId });
      seedPrimaryHost(harness.deps, hostId);
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
          model: "test-model",
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

  it("reads workspace .bb/AGENTS.md from a non-primary host", async () => {
    await withTestHarness(async (harness) => {
      const { host: primary } = seedHostSession(harness.deps, {
        id: "host-runtime-agents-primary",
      });
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-runtime-agents-remote",
      });
      seedPrimaryHost(harness.deps, primary.id);
      setExperiments(harness.db, {
        ...defaultExperiments,
      });
      const workspacePath = "/remote/runtime-agents-workspace";
      const agentInstructionsPath = path.join(
        workspacePath,
        ".bb",
        "AGENTS.md",
      );
      const responder = registerRemoteRuntimeFileResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        files: new Map([
          [
            agentInstructionsPath,
            "\n# Remote Rules\n\nRead me from the remote daemon.\n",
          ],
        ]),
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: workspacePath,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: workspacePath,
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
      });

      const runtimeConfig = await resolveThreadRuntimeCommandConfig(
        harness.deps,
        {
          thread,
          environment,
          model: "test-model",
        },
      );

      expect(runtimeConfig.instructions).toContain(
        "# Remote Rules\n\nRead me from the remote daemon.",
      );
      expect(responder.requests).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            command: expect.objectContaining({
              type: "host.read_file",
              path: agentInstructionsPath,
              rootPath: workspacePath,
            }),
          }),
        ]),
      );
    });
  });

  it("treats a missing remote workspace .bb/AGENTS.md as null", async () => {
    await withTestHarness(async (harness) => {
      const { host: primary } = seedHostSession(harness.deps, {
        id: "host-runtime-missing-agents-primary",
      });
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-runtime-missing-agents-remote",
      });
      seedPrimaryHost(harness.deps, primary.id);
      setExperiments(harness.db, {
        ...defaultExperiments,
      });
      const workspacePath = "/remote/runtime-missing-agents-workspace";
      registerRemoteRuntimeFileResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        files: new Map(),
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: workspacePath,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: workspacePath,
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
      });

      const runtimeConfig = await resolveThreadRuntimeCommandConfig(
        harness.deps,
        { thread, environment, model: "test-model" },
      );

      expect(runtimeConfig.instructions).not.toContain(
        "The following workspace instructions come from .bb/AGENTS.md:",
      );
    });
  });

  it("enumerates project skills through a non-primary host", async () => {
    await withTestHarness(async (harness) => {
      const { host: primary } = seedHostSession(harness.deps, {
        id: "host-runtime-skills-primary",
      });
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-runtime-skills-remote",
      });
      seedPrimaryHost(harness.deps, primary.id);
      setExperiments(harness.db, {
        ...defaultExperiments,
      });
      const workspacePath = "/remote/runtime-skills-workspace";
      const skillRootPath = path.join(
        workspacePath,
        ".bb",
        "skills",
        "remote-review",
      );
      const skillFilePath = path.join(skillRootPath, "SKILL.md");
      const responder = registerRemoteRuntimeFileResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        files: new Map([
          [
            skillFilePath,
            [
              "---",
              "name: remote-review",
              "description: Review code on the remote host.",
              "---",
              "",
              "# Remote Review",
            ].join("\n"),
          ],
        ]),
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: workspacePath,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: workspacePath,
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
      });

      const runtimeConfig = await resolveThreadRuntimeCommandConfig(
        harness.deps,
        { thread, environment, model: "test-model" },
      );

      expect(runtimeConfig.injectedSkillSources).toContainEqual({
        kind: "workspace-path",
        sourceType: "project",
        name: "remote-review",
        description: "Review code on the remote host.",
        sourceRootPath: skillRootPath,
        skillFilePath,
      });
      expect(responder.requests).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            command: expect.objectContaining({
              type: "host.list_files",
              path: path.join(workspacePath, ".bb", "skills"),
            }),
          }),
          expect.objectContaining({
            command: expect.objectContaining({
              type: "host.read_file",
              path: skillFilePath,
              rootPath: workspacePath,
            }),
          }),
        ]),
      );
    });
  });

  it("injects shared host skills into thread runtime configuration", async () => {
    await withTestHarness(
      {
        sharedSkillRoots: {
          user: [".agents/skills"],
          project: [".agents/skills"],
        },
      },
      async (harness) => {
        const { host, session } = seedHostSession(harness.deps, {
          id: "host-runtime-shared-skills",
        });
        const workspacePath = "/remote/runtime-shared-skills";
        const skillFilePath = path.join(
          workspacePath,
          ".agents",
          "skills",
          "portable-review",
          "SKILL.md",
        );
        registerRemoteRuntimeFileResponder(harness, {
          hostId: host.id,
          sessionId: session.id,
          files: new Map(),
          sharedSkills: [
            {
              id: `skill_${"b".repeat(64)}`,
              name: "portable-review",
              description: "Review code from one shared source.",
              filePath: skillFilePath,
              rootKind: "shared-project",
              linked: false,
            },
          ],
        });
        const { project } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
          path: workspacePath,
        });
        const environment = seedEnvironment(harness.deps, {
          hostId: host.id,
          projectId: project.id,
          path: workspacePath,
        });
        const thread = seedThread(harness.deps, {
          environmentId: environment.id,
          projectId: project.id,
          providerId: "claude-code",
        });

        const runtimeConfig = await resolveThreadRuntimeCommandConfig(
          harness.deps,
          { thread, environment, model: "test-model" },
        );

        expect(runtimeConfig.injectedSkillSources).toContainEqual({
          kind: "host-path",
          sourceType: "shared-project",
          name: "portable-review",
          description: "Review code from one shared source.",
          sourceRootPath: path.dirname(skillFilePath),
          skillFilePath,
        });
      },
    );
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
          model: "test-model",
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

  describe("plugin contributeInstructions assembly", () => {
    afterEach(() => {
      // withTestHarness rebinds this on each createApp; clear so a later
      // isolated test doesn't see a leftover stub if harness cleanup races.
      setPluginAgentContributions(undefined);
    });

    function stubContributions(args: {
      tools?: PluginAgentToolContribution[];
      instructions?: Array<{
        pluginId: string;
        provider: (ctx: {
          threadId: string;
          projectId: string;
        }) => string | null;
      }>;
    }): void {
      setPluginAgentContributions({
        listSkillRootContributions: () => [],
        listAgentTools: () => args.tools ?? [],
        listInstructionContributions: () => args.instructions ?? [],
        findAgentTool: () => undefined,
        invokeAgentTool: async () => ({
          success: false,
          contentItems: [{ type: "inputText", text: "unused" }],
        }),
        resolveMention: async () => ({
          ok: false,
          error: "unused in runtime-config tests",
        }),
      });
    }

    it("appends attributed plugin instructions after tool snippets and before data-dir instructions", async () => {
      await withTestHarness(async (harness) => {
        const hostId = "host-runtime-plugin-instr";
        seedHostSession(harness.deps, { id: hostId });
        const workspacePath = path.join(
          harness.config.dataDir,
          "plugin-instr-workspace",
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

        stubContributions({
          tools: [
            {
              pluginId: "tooldemo",
              tool: {
                name: "demo_lookup",
                description: "Look up demo data",
                inputSchema: { type: "object" },
              },
              instructions: "Call demo_lookup before guessing.",
            },
          ],
          instructions: [
            {
              pluginId: "connect",
              provider: ({ threadId, projectId }) =>
                `Remote session for ${threadId} in ${projectId}`,
            },
          ],
        });

        const runtimeConfig = await resolveThreadRuntimeCommandConfig(
          harness.deps,
          {
            thread,
            model: "test-model",
            environment: {
              hostId: environment.hostId,
              id: environment.id,
              path: environment.path,
              status: environment.status,
              workspaceProvisionType: environment.workspaceProvisionType,
            },
          },
        );

        const toolHeader =
          'The following instructions come from the BB plugin "tooldemo" for its tool "demo_lookup":';
        const pluginHeader =
          'The following instructions come from the BB plugin "connect":';
        const dataDirHeader =
          "The following user instructions come from <dataDir>/AGENTS.md:";
        const instructions = runtimeConfig.instructions;
        expect(instructions).toContain(toolHeader);
        expect(instructions).toContain("Call demo_lookup before guessing.");
        expect(instructions).toContain(pluginHeader);
        expect(instructions).toContain(
          `Remote session for ${thread.id} in ${project.id}`,
        );
        expect(instructions).toContain(dataDirHeader);
        expect(instructions.indexOf(toolHeader)).toBeLessThan(
          instructions.indexOf(pluginHeader),
        );
        expect(instructions.indexOf(pluginHeader)).toBeLessThan(
          instructions.indexOf(dataDirHeader),
        );
      });
    });

    it("skips null/empty providers, truncates long text, and isolates throws", async () => {
      await withTestHarness(async (harness) => {
        const hostId = "host-runtime-plugin-instr-edge";
        seedHostSession(harness.deps, { id: hostId });
        const { project } = seedProjectWithSource(harness.deps, {
          hostId,
          path: "/tmp/runtime-plugin-instr-edge",
        });
        const environment = seedEnvironment(harness.deps, {
          hostId,
          projectId: project.id,
          path: "/tmp/runtime-plugin-instr-edge",
        });
        const thread = seedThread(harness.deps, {
          projectId: project.id,
          environmentId: environment.id,
        });

        const longBody = "x".repeat(5000);
        stubContributions({
          instructions: [
            {
              pluginId: "nuller",
              provider: () => null,
            },
            {
              pluginId: "blank",
              provider: () => "   \n\t  ",
            },
            {
              pluginId: "boom",
              provider: () => {
                throw new Error("provider boom");
              },
            },
            {
              pluginId: "verbose",
              provider: () => longBody,
            },
            {
              pluginId: "ok",
              provider: () => "still contributes",
            },
          ],
        });

        const runtimeConfig = await resolveThreadRuntimeCommandConfig(
          harness.deps,
          {
            thread,
            model: "test-model",
            environment: {
              hostId: environment.hostId,
              id: environment.id,
              path: environment.path,
              status: environment.status,
              workspaceProvisionType: environment.workspaceProvisionType,
            },
          },
        );

        const instructions = runtimeConfig.instructions;
        expect(instructions).not.toContain(
          'The following instructions come from the BB plugin "nuller":',
        );
        expect(instructions).not.toContain(
          'The following instructions come from the BB plugin "blank":',
        );
        expect(instructions).not.toContain(
          'The following instructions come from the BB plugin "boom":',
        );
        expect(instructions).toContain(
          'The following instructions come from the BB plugin "verbose":',
        );
        expect(instructions).toContain(
          'The following instructions come from the BB plugin "ok":',
        );
        expect(instructions).toContain("still contributes");
        // Truncated to 4096 chars — the full 5000-x body must not appear.
        expect(instructions).not.toContain(longBody);
        expect(instructions).toContain("x".repeat(4096));
        expect(instructions).not.toContain("x".repeat(4097));
      });
    });
  });
});
