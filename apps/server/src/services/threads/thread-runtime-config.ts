import {
  resolveHostEnvironment,
  mergeHostAndProviderEnvironment,
} from "../hosts/host-environment.js";
import {
  getEnvironment,
  getHost,
  getProject,
} from "@bb/db";
import { PLUGIN_DYNAMIC_INSTRUCTIONS_MAX_CHARS } from "@get-bb/plugin-sdk/internal/host-policy";
import type {
  DynamicTool,
  InstructionMode,
  PermissionEscalation,
  Thread,
  ThreadTurnInitiator,
  EnvironmentStatus,
} from "@bb/domain";
import type {
  HostDaemonContributedEnvEntry,
  HostDaemonInjectedSkillSource,
} from "@bb/host-daemon-contract";
import { ApiError } from "../../errors.js";
import type { LoggedWorkSessionDeps } from "../../types.js";
import { throwEnvironmentNotReady } from "../lib/lifecycle-api-errors.js";
import { requireLiveThreadStoragePath } from "./thread-storage.js";
import {
  listPluginAgentTools,
  listPluginInstructionContributions,
  getPluginSkillRootContributions,
  resolvePluginAgentConfiguration,
  resolvePluginProviderEnv,
} from "../plugins/plugin-agent-contributions.js";
import { resolveSkillCatalog } from "../skills/skill-catalog.js";
import { discoverPluginSkillIds } from "../skills/injected-skills.js";
import { UPDATE_ENVIRONMENT_DIRECTORY_TOOL } from "./thread-environment-directory.js";
import {
  DATA_DIR_AGENT_INSTRUCTIONS_RELATIVE_PATH,
  WORKSPACE_AGENT_INSTRUCTIONS_RELATIVE_PATH,
  readDataDirAgentInstructions,
} from "./workspace-agent-instructions.js";
import { readWorkspaceAgentContext } from "./workspace-agent-context.js";
import { renderWorkspaceFolderInstructions } from "./workspace-folder-instructions.js";
import { reportMissingWorkspaceFolders } from "./workspace-folder-notices.js";
import { listEnvironmentExtraFolderPaths } from "../environments/environment-workspace-folders.js";
import {
  resolveEnvironmentRepos,
  type EnvironmentReposTarget,
} from "../environments/environment-repos.js";
import { resolveDeprecatedWorkspaceProvisionType } from "../environments/environment-response.js";
import { markTurnTraceSpan } from "../system/turn-trace.js";
import { sliceUtf16Head } from "@bb/text-utils";

const UPDATE_ENVIRONMENT_DIRECTORY_INSTRUCTIONS =
  "If the user asks you to move this thread to another checkout, worktree, or directory, make sure the target directory exists, then call `update_environment_directory` with its absolute path. After it succeeds, end the current turn; bb starts the next turn in the updated environment automatically so you can continue there.";

export interface ThreadRuntimeCommandEnvironment {
  hostId: string;
  id: string;
  path: string | null;
  status: EnvironmentStatus;
}

interface ResolveThreadRuntimeCommandConfigArgs {
  environment: ThreadRuntimeCommandEnvironment;
  model: string;
  thread: Thread;
}

interface ResolvePermissionEscalationArgs {
  initiator: ThreadTurnInitiator;
}

export interface ResolvedThreadRuntimeCommandConfig {
  additionalWorkspaceFolders: string[];
  contributedEnv: HostDaemonContributedEnvEntry[];
  dynamicTools: DynamicTool[];
  injectedSkillSources: HostDaemonInjectedSkillSource[];
  instructionMode: InstructionMode;
  instructions: string;
  projectId: string;
  providerId: string;
  threadStoragePath: string;
  workspacePath: string;
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
  instructions: string | null;
  pluginId: string | null;
}

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
  if (args.initiator !== "user") {
    return "deny";
  }

  return "ask";
}

const REPO_DISCOVERY_WAIT_MS = 3_000;

async function findReposInsideWorkspaceFolders(
  deps: LoggedWorkSessionDeps,
  environment: EnvironmentReposTarget,
): Promise<string[]> {
  try {
    const found = await Promise.race([
      resolveEnvironmentRepos(deps, environment),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), REPO_DISCOVERY_WAIT_MS).unref();
      }),
    ]);
    if (found === null) return [];
    return found.repos
      .filter((repo) => repo.source === "discovered")
      .map((repo) => repo.path);
  } catch (error) {
    deps.logger.warn(
      { err: error, environmentId: environment.id },
      "Could not find git repositories inside the workspace folders",
    );
    return [];
  }
}

export async function resolveThreadRuntimeCommandConfig(
  deps: LoggedWorkSessionDeps,
  args: ResolveThreadRuntimeCommandConfigArgs,
): Promise<ResolvedThreadRuntimeCommandConfig> {
  markTurnTraceSpan("runtimeConfig.started");
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

  const candidateFolders = listEnvironmentExtraFolderPaths(deps.db, {
    additionalPaths: environment.additionalPaths,
    hostId: args.environment.hostId,
    mainPath: workspacePath,
    projectId: project.id,
  });
  const workspaceAgentContext = await readWorkspaceAgentContext(deps, {
    includeAgentInstructions: true,
    hostId: args.environment.hostId,
    workspacePath,
    folderPaths:
      candidateFolders.length > 0 ? [workspacePath, ...candidateFolders] : [],
  });
  markTurnTraceSpan("runtimeConfig.workspaceRead");
  const [, ...additionalFolderStatuses] = workspaceAgentContext.folders;
  const additionalWorkspaceFolders = additionalFolderStatuses
    .filter((folder) => folder.exists)
    .map((folder) => folder.path);
  reportMissingWorkspaceFolders(deps, {
    environmentId: environment.id,
    missingPaths: additionalFolderStatuses
      .filter((folder) => !folder.exists)
      .map((folder) => folder.path),
    threadId: args.thread.id,
  });
  const pluginSkillRoots = getPluginSkillRootContributions();
  const skillIdsByPlugin = await discoverPluginSkillIds(deps.logger, {
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
        branchName: environment.branchName,
        workspaceProvisionType: resolveDeprecatedWorkspaceProvisionType(
          environment.environmentProviderId,
        ),
      },
      host: { id: host.id, name: host.name },
      provider: {
        id: args.thread.providerId,
        model: args.model,
        capabilities: {
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
  markTurnTraceSpan("runtimeConfig.pluginConfig");
  const contributedEnv = mergeHostAndProviderEnvironment(
    await resolveHostEnvironment(deps, {
      hostId: host.id,
      projectId: project.id,
    }),
    await resolvePluginProviderEnv({
      providerId: args.thread.providerId,
      context: {
        threadId: args.thread.id,
        projectId: project.id,
        hostId: host.id,
      },
    }),
  );
  markTurnTraceSpan("runtimeConfig.env");
  const injectedSkillSources = (
    await resolveSkillCatalog(deps, {
      projectSkillSources: workspaceAgentContext.projectSkillSources,
      sharedSkillSources: workspaceAgentContext.sharedSkills.runtimeSources,
      pluginSkillSelections: conditionalConfiguration.selectedSkillIdsByPlugin,
    })
  ).map((entry) => entry.runtimeSource);
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
  const instructionSections: string[] = [];
  const reposInsideFolders =
    candidateFolders.length > 0 || environment.isGitRepo !== true
      ? await findReposInsideWorkspaceFolders(deps, {
          additionalPaths: environment.additionalPaths,
          hostId: args.environment.hostId,
          id: environment.id,
          path: workspacePath,
          projectId: project.id,
        })
      : [];
  const workspaceFolderInstructions = renderWorkspaceFolderInstructions(
    workspaceAgentContext.folders.length > 0
      ? workspaceAgentContext.folders
      : [{ path: workspacePath, exists: true, isGitRepo: false }],
    reposInsideFolders,
  );
  if (workspaceFolderInstructions !== null) {
    instructionSections.push(workspaceFolderInstructions);
  }
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
  for (const contribution of listPluginInstructionContributions()) {
    let text = contribution.provider({
      threadId: args.thread.id,
      projectId: args.thread.projectId,
    });
    if (text === null || text.trim().length === 0) continue;
    text = sliceUtf16Head(text, PLUGIN_DYNAMIC_INSTRUCTIONS_MAX_CHARS);
    instructionSections.push(
      `The following instructions come from the BB plugin "${contribution.pluginId}":`,
      text,
    );
  }
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
  if (workspaceAgentContext.agentInstructions) {
    instructionSections.push(
      `The following workspace instructions come from ${WORKSPACE_AGENT_INSTRUCTIONS_RELATIVE_PATH}:`,
      workspaceAgentContext.agentInstructions,
    );
  }
  const instructions = instructionSections.join("\n\n");
  const threadStoragePath = await requireLiveThreadStoragePath(deps, {
    hostId: args.environment.hostId,
    threadId: args.thread.id,
  });
  markTurnTraceSpan("runtimeConfig.built");
  return {
    additionalWorkspaceFolders,
    contributedEnv,
    dynamicTools,
    injectedSkillSources,
    instructionMode: "append",
    instructions,
    projectId: args.thread.projectId,
    providerId: args.thread.providerId,
    threadStoragePath,
    workspacePath,
  };
}
