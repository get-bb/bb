import { getEnvironment, getHost, getProject } from "@bb/db";
import type {
  DynamicTool,
  InstructionMode,
  PermissionEscalation,
  ProjectExecutionDefaults,
  ResolvedThreadExecutionOptions,
  Thread,
  ThreadExecutionOptions,
  ThreadExecutionSource,
  ThreadTurnInitiator,
  WorkspaceProvisionType,
  EnvironmentStatus,
} from "@bb/domain";
import type { HostDaemonInjectedSkillSource } from "@bb/host-daemon-contract";
import { renderTemplate } from "@bb/templates";
import { ApiError } from "../../errors.js";
import type { AppDeps, LoggedWorkSessionDeps } from "../../types.js";
import { throwEnvironmentNotReady } from "../lib/lifecycle-api-errors.js";
import { requireThreadStoragePath } from "./thread-storage.js";
import {
  buildExistingThreadExecutionInput,
  resolveExistingThreadExecutionPlan,
} from "./thread-execution-plan.js";
import {
  listPluginAgentTools,
  listPluginInstructionContributions,
  getPluginSkillRootContributions,
  resolvePluginAgentConfiguration,
} from "../plugins/plugin-agent-contributions.js";
import { resolveSkillCatalogSources } from "../skills/skill-catalog.js";
import { discoverPluginSkillIds } from "../skills/injected-skills.js";
import { resolveWorkspaceProjectSkills } from "../skills/workspace-skills.js";
import { resolveSharedSkills } from "../skills/shared-skills.js";
import { UPDATE_ENVIRONMENT_DIRECTORY_TOOL } from "./thread-environment-directory.js";
import {
  DATA_DIR_AGENT_INSTRUCTIONS_RELATIVE_PATH,
  WORKSPACE_AGENT_INSTRUCTIONS_RELATIVE_PATH,
  readDataDirAgentInstructions,
  readWorkspaceAgentInstructions,
} from "./workspace-agent-instructions.js";

const STANDARD_AGENT_INSTRUCTIONS = renderTemplate(
  "standardAgentAppendInstructions",
  {},
);
const UPDATE_ENVIRONMENT_DIRECTORY_INSTRUCTIONS =
  "If the user asks you to move this thread to another checkout, worktree, or directory, make sure the target directory exists, then call `update_environment_directory` with its absolute path. After it succeeds, stop work in the current turn; future turns will run in the updated environment.";

/** Cap on each plugin's contributeInstructions output (per resolution). */
const PLUGIN_INSTRUCTION_CONTRIBUTION_MAX_CHARS = 4096;

export interface ThreadRuntimeCommandEnvironment {
  hostId: string;
  id: string;
  path: string | null;
  status: EnvironmentStatus;
  workspaceProvisionType: WorkspaceProvisionType;
}

export interface ResolveExecutionOptionsArgs {
  projectDefaults?: ProjectExecutionDefaults | null;
  requestedExecution: RequestedExecutionOptions;
  threadId: string;
}

export interface RequestedExecutionOptions extends ThreadExecutionOptions {
  source: ThreadExecutionSource;
}

export interface ResolveThreadRuntimeCommandConfigArgs {
  environment: ThreadRuntimeCommandEnvironment;
  model: string;
  thread: Thread;
}

export interface ResolvePermissionEscalationArgs {
  initiator: ThreadTurnInitiator;
  thread: Thread;
}

export interface ResolvedThreadRuntimeCommandConfig {
  dynamicTools: DynamicTool[];
  injectedSkillSources: HostDaemonInjectedSkillSource[];
  instructionMode: InstructionMode;
  instructions: string;
  projectId: string;
  providerId: string;
  threadStoragePath: string;
  workspacePath: string;
  workspaceProvisionType: WorkspaceProvisionType;
}

function requireWorkspacePath(
  environment: ThreadRuntimeCommandEnvironment,
): string {
  if (!environment.path) {
    throwEnvironmentNotReady(environment);
  }

  return environment.path;
}

interface DynamicToolContribution {
  tool: DynamicTool;
  /** Usage snippet appended to the thread instructions; null for none. */
  instructions: string | null;
  /** Contributing plugin id; null for built-in tools. */
  pluginId: string | null;
}

/**
 * The session's dynamic tool set: built-ins first, then native plugin tools
 * (bb.agents.registerTool), resolved live at thread.start/turn.submit — so
 * tool-set changes apply on the next session start, never mid-session.
 * Conditionally selected plugin tools follow configure() like any thread.
 */
function resolveDynamicTools(
  pluginTools: ReturnType<typeof listPluginAgentTools>,
): DynamicToolContribution[] {
  return [
    {
      tool: UPDATE_ENVIRONMENT_DIRECTORY_TOOL,
      instructions: UPDATE_ENVIRONMENT_DIRECTORY_INSTRUCTIONS,
      pluginId: null,
    },
    ...pluginTools.map((contribution) => ({
      tool: contribution.tool,
      instructions: contribution.instructions,
      pluginId: contribution.pluginId,
    })),
  ];
}

export function resolvePermissionEscalation(
  args: ResolvePermissionEscalationArgs,
): PermissionEscalation {
  // System turns (parent notifications, recovery) must not prompt. A
  // user-started turn asks even on a delegated child so a sandbox-blocked
  // action can surface on the parent instead of failing in silence.
  if (args.initiator !== "user") {
    return "deny";
  }

  return "ask";
}

export async function resolveExecutionOptions(
  deps: Pick<AppDeps, "db" | "providerRegistry">,
  args: ResolveExecutionOptionsArgs,
): Promise<ResolvedThreadExecutionOptions> {
  const plan = await resolveExistingThreadExecutionPlan(deps, {
    ...(args.projectDefaults !== undefined
      ? { projectDefaults: args.projectDefaults }
      : {}),
    executionSource: args.requestedExecution.source,
    input: buildExistingThreadExecutionInput(args.requestedExecution),
    threadId: args.threadId,
  });
  return plan.resolvedExecution;
}

export async function resolveThreadRuntimeCommandConfig(
  deps: LoggedWorkSessionDeps,
  args: ResolveThreadRuntimeCommandConfigArgs,
): Promise<ResolvedThreadRuntimeCommandConfig> {
  const workspacePath = requireWorkspacePath(args.environment);
  const project = getProject(deps.db, args.thread.projectId);
  if (!project) {
    throw new ApiError(404, "project_not_found", "Project not found");
  }
  const environment = getEnvironment(deps.db, args.environment.id);
  if (!environment) {
    throw new ApiError(404, "environment_not_found", "Environment not found");
  }
  const host = getHost(deps.db, args.environment.hostId);
  if (!host) {
    throw new ApiError(404, "host_not_found", "Host not found");
  }

  const { workspaceProvisionType } = args.environment;
  const [projectSkillSources, sharedSkills, workspaceAgentInstructions] =
    await Promise.all([
      resolveWorkspaceProjectSkills(deps, {
        hostId: args.environment.hostId,
        workspacePath,
      }),
      resolveSharedSkills(deps, {
        hostId: args.environment.hostId,
        cwd: workspacePath,
      }),
      readWorkspaceAgentInstructions(deps, {
        hostId: args.environment.hostId,
        workspacePath,
      }),
    ]);
  const pluginSkillRoots = getPluginSkillRootContributions();
  const skillIdsByPlugin = discoverPluginSkillIds(deps.logger, {
    pluginSkillRoots,
    skillTreeRegistry: deps.skillTreeRegistry,
  });
  const conditionalConfiguration = await resolvePluginAgentConfiguration({
    context: {
      thread: {
        id: args.thread.id,
        title: args.thread.title,
        parentThreadId: args.thread.parentThreadId,
        sourceThreadId: args.thread.sourceThreadId,
      },
      project: {
        id: project.id,
        kind: project.kind,
        name: project.name,
        gitRemoteUrl: project.gitRemoteUrl,
      },
      environment: {
        id: environment.id,
        name: environment.name,
        path: environment.path,
        workspaceProvisionType: environment.workspaceProvisionType,
        branchName: environment.branchName,
      },
      host: { id: host.id, name: host.name },
      provider: {
        id: args.thread.providerId,
        model: args.model,
        capabilities: {
          // Absent registration (an ACP tier id, or a provider whose plugin
          // is disabled mid-thread) reads as "no native affordance", which is
          // the safe answer: the plugin contributes its own.
          supportsNativeUserQuestion:
            deps.providerRegistry.get(args.thread.providerId)?.info.capabilities
              .supportsNativeUserQuestion ?? false,
        },
      },
      origin: {
        kind: args.thread.originKind,
        pluginId: args.thread.originPluginId,
      },
    },
    skillIdsByPlugin,
  });
  const injectedSkillSources = resolveSkillCatalogSources(deps, {
    projectSkillSources,
    sharedSkillSources: sharedSkills.runtimeSources,
    pluginSkillSelections: conditionalConfiguration.selectedSkillIdsByPlugin,
  });
  const dataDirAgentInstructions = readDataDirAgentInstructions(
    deps.logger,
    deps.config.dataDir,
  );
  const dynamicToolContributions = resolveDynamicTools(
    conditionalConfiguration.tools,
  );
  const dynamicTools = dynamicToolContributions.map(
    (contribution) => contribution.tool,
  );
  const instructionSections = [STANDARD_AGENT_INSTRUCTIONS];
  // Per-tool instructions: each dynamic tool carries its own snippet (the
  // built-in update_environment_directory guidance is one of them; plugin
  // tools are description-only unless they registered a snippet).
  for (const contribution of dynamicToolContributions) {
    if (!contribution.instructions) continue;
    if (contribution.pluginId === null) {
      instructionSections.push(contribution.instructions);
    } else {
      instructionSections.push(
        `The following instructions come from the BB plugin "${contribution.pluginId}" for its tool "${contribution.tool.name}":`,
        contribution.instructions,
      );
    }
  }
  // Legacy plugin-level contributeInstructions providers (after per-tool
  // snippets, before configure dynamic instructions).
  for (const contribution of listPluginInstructionContributions()) {
    let text: string | null;
    try {
      text = contribution.provider({
        threadId: args.thread.id,
        projectId: args.thread.projectId,
      });
    } catch (error) {
      deps.logger.warn(
        {
          err: error,
          pluginId: contribution.pluginId,
          threadId: args.thread.id,
        },
        "Plugin instruction contribution threw; skipping",
      );
      continue;
    }
    if (text === null || text.trim().length === 0) continue;
    if (text.length > PLUGIN_INSTRUCTION_CONTRIBUTION_MAX_CHARS) {
      text = text.slice(0, PLUGIN_INSTRUCTION_CONTRIBUTION_MAX_CHARS);
    }
    instructionSections.push(
      `The following instructions come from the BB plugin "${contribution.pluginId}":`,
      text,
    );
  }
  // Conditional dynamic instructions follow the legacy/static plugin-level
  // providers on every thread, including side chats. Each configure output
  // was already validated and capped by the plugin service;
  // user/data-dir/workspace instructions still follow.
  for (const contribution of conditionalConfiguration.dynamicInstructions) {
    instructionSections.push(
      `The following dynamic instructions come from the BB plugin "${contribution.pluginId}":`,
      contribution.text,
    );
  }
  if (dataDirAgentInstructions) {
    instructionSections.push(
      `The following user instructions come from <dataDir>/${DATA_DIR_AGENT_INSTRUCTIONS_RELATIVE_PATH}:`,
      dataDirAgentInstructions,
    );
  }
  if (workspaceAgentInstructions) {
    instructionSections.push(
      `The following workspace instructions come from ${WORKSPACE_AGENT_INSTRUCTIONS_RELATIVE_PATH}:`,
      workspaceAgentInstructions,
    );
  }
  const instructions = instructionSections.join("\n\n");
  const threadStoragePath = await requireThreadStoragePath(deps, {
    hostId: args.environment.hostId,
    threadId: args.thread.id,
  });
  return {
    dynamicTools,
    injectedSkillSources,
    instructionMode: "append",
    instructions,
    projectId: args.thread.projectId,
    providerId: args.thread.providerId,
    threadStoragePath,
    workspacePath,
    workspaceProvisionType,
  };
}
