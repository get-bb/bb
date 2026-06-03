import { getDefaultProjectSource, getProject } from "@bb/db";
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
import { requireThreadStorageContext } from "./thread-storage.js";
import {
  buildExistingThreadExecutionInput,
  resolveExistingThreadExecutionPlan,
} from "./thread-execution-plan.js";
import { resolveInjectedSkillSources } from "../skills/injected-skills.js";
export { getSupportedReasoningLevelsForProvider } from "./thread-reasoning-policy.js";

const STANDARD_AGENT_INSTRUCTIONS = renderTemplate(
  "standardAgentInstructions",
  {},
);
const MESSAGE_USER_TOOL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    text: {
      type: "string",
      description:
        "Exact message text to show to the user. Keep it concise, factual, and appropriate for the user conversation.",
    },
  },
  required: ["text"],
};
const MANAGER_DYNAMIC_TOOLS: DynamicTool[] = [
  {
    name: "message_user",
    description:
      "IMPORTANT: you need to call this for the user to see messages you send. Send a concise message that is visible to the user from the manager thread. Use this for status updates, questions, approval requests, blockers, and completion notes. Plain assistant text is internal and is not shown to users.",
    inputSchema: MESSAGE_USER_TOOL_SCHEMA,
  },
];
const MANAGER_DISALLOWED_TOOLS = [
  "ExitPlanMode",
  "NotebookEdit",
  "Task",
] as const;

function resolveLocalTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export interface ThreadRuntimeCommandEnvironment {
  cleanupRequestedAt: number | null;
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
  disallowedTools?: readonly string[];
  injectedSkillSources: HostDaemonInjectedSkillSource[];
  instructionMode: InstructionMode;
  instructions: string;
  projectId: string;
  providerId: string;
  /** Only set for manager threads. */
  threadStoragePath?: string;
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
    args.initiator === "system" ||
    args.thread.parentThreadId !== null ||
    args.thread.type === "manager"
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
  const project = getProject(deps.db, args.thread.projectId);
  if (!project) {
    throw new ApiError(404, "project_not_found", "Project not found");
  }

  const defaultSource = getDefaultProjectSource(deps.db, args.thread.projectId);
  const projectRootPath =
    defaultSource?.type === "local_path" ? defaultSource.path : workspacePath;
  const { workspaceProvisionType } = args.environment;
  const injectedSkillSources = resolveInjectedSkillSources(deps.logger, {
    dataDir: deps.config.dataDir,
  });

  if (args.thread.type !== "manager") {
    return {
      dynamicTools: [],
      injectedSkillSources,
      instructionMode: "append",
      instructions: STANDARD_AGENT_INSTRUCTIONS,
      projectId: args.thread.projectId,
      providerId: args.thread.providerId,
      ...(args.thread.environmentId === null
        ? { threadStoragePath: workspacePath }
        : {}),
      workspacePath,
      workspaceProvisionType,
    };
  }
  const threadStorageContext = await requireThreadStorageContext(deps, {
    hostId: args.environment.hostId,
    threadId: args.thread.id,
  });

  return {
    dynamicTools: MANAGER_DYNAMIC_TOOLS,
    disallowedTools: MANAGER_DISALLOWED_TOOLS,
    injectedSkillSources,
    instructionMode: "replace",
    instructions: renderTemplate("managerAgentInstructions", {
      hostId: args.environment.hostId,
      localTimezone: resolveLocalTimezone(),
      managerDataDir: threadStorageContext.dataDir,
      managerThreadId: args.thread.id,
      threadStoragePath: threadStorageContext.threadStoragePath,
      projectId: args.thread.projectId,
      projectName: project.name,
      projectRootPath,
    }),
    projectId: args.thread.projectId,
    providerId: args.thread.providerId,
    threadStoragePath: threadStorageContext.threadStoragePath,
    workspacePath,
    workspaceProvisionType,
  };
}
