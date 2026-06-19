import path from "node:path";
import { getProject } from "@bb/db";
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
import { resolveInjectedSkillSources } from "../skills/injected-skills.js";
import { buildTerminalDynamicTools } from "../terminals/terminal-tools.js";
import { isSideChatThread } from "./side-chat-thread.js";
export { getSupportedReasoningLevelsForProvider } from "./thread-reasoning-policy.js";

const STANDARD_AGENT_INSTRUCTIONS = renderTemplate(
  "standardAgentAppendInstructions",
  {},
);
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

export function resolvePermissionEscalation(
  args: ResolvePermissionEscalationArgs,
): PermissionEscalation {
  if (
    args.initiator !== "user" ||
    args.thread.parentThreadId !== null ||
    isSideChatThread(args.thread)
  ) {
    return "deny";
  }

  return "ask";
}

export async function resolveExecutionOptions(
  deps: Pick<AppDeps, "db">,
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
  if (!getProject(deps.db, args.thread.projectId)) {
    throw new ApiError(404, "project_not_found", "Project not found");
  }

  const { workspaceProvisionType } = args.environment;
  const injectedSkillSources = resolveInjectedSkillSources(deps.logger, {
    builtinSkillsRootPath: deps.config.builtinSkillsRootPath,
    dataDir: deps.config.dataDir,
    projectSkillsRootPath: path.join(workspacePath, ".bb", "skills"),
  });
  const threadStoragePath = await requireThreadStoragePath(deps, {
    hostId: args.environment.hostId,
    threadId: args.thread.id,
  });
  return {
    dynamicTools: buildTerminalDynamicTools(),
    injectedSkillSources,
    instructionMode: "append",
    instructions: STANDARD_AGENT_INSTRUCTIONS,
    projectId: args.thread.projectId,
    providerId: args.thread.providerId,
    threadStoragePath,
    workspacePath,
    workspaceProvisionType,
  };
}
