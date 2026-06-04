import {
  getBuiltInAgentProviderInfo,
  isAgentProviderId,
} from "@bb/agent-providers";
import type {
  PermissionMode,
  ProjectExecutionDefaults,
  ReasoningLevel,
  ServiceTier,
  Thread,
  ThreadType,
} from "@bb/domain";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type { EnvironmentArgs } from "@bb/server-contract";
import {
  isLiveManagerParentThread,
  type ManagerParentThread,
} from "./thread-parent.js";

export const DEFAULT_SERVICE_TIER: ServiceTier = "default";
export const DEFAULT_REASONING_LEVEL: ReasoningLevel = "medium";

/**
 * Whether provider sessions get the Workflows feature (dynamic multi-agent
 * orchestration). Server-owned product policy: enabled for claude-code — the
 * Workflow tool's own opt-in rules govern when the model actually uses it —
 * and meaningless for providers without the concept. Host-level user/org
 * disables still win inside the CLI.
 */
export function resolveWorkflowsEnabledPolicy(providerId: string): boolean {
  return providerId === "claude-code";
}
const DEFAULT_PERMISSION_MODE: PermissionMode = "full";
const MANAGED_CHILD_PERMISSION_MODE: PermissionMode = "workspace-write";
const PRODUCT_DEFAULT_PROVIDER_ID = "codex";
const PRODUCT_DEFAULT_MODEL = "gpt-5.5";
const MANAGER_DEFAULT_REASONING_LEVEL: ReasoningLevel = "xhigh";

export interface ResolveCreateThreadExecutionDefaultsArgs {
  requestedProviderId?: string;
  storedDefaults: ProjectExecutionDefaults | null;
  threadType: ThreadType;
}

export interface CreateThreadExecutionDefaultsResolved {
  executionDefaults: ProjectExecutionDefaults | null;
  providerId: string;
}

export interface IsManagedChildThreadArgs {
  parentThread?: ManagerParentThread | null;
  thread: Pick<Thread, "parentThreadId" | "projectId">;
}

export interface ResolveThreadDefaultPermissionModeArgs {
  parentThread?: ManagerParentThread | null;
  thread: Pick<Thread, "parentThreadId" | "projectId" | "providerId">;
}

export interface ResolveThreadExecutionPermissionModeArgs {
  lastExecutionPermissionMode?: PermissionMode;
  parentThread?: ManagerParentThread | null;
  projectExecutionPermissionMode?: PermissionMode;
  requestedPermissionMode?: PermissionMode;
  thread: Pick<Thread, "parentThreadId" | "projectId" | "providerId">;
}

export interface ResolveCreateThreadEnvironmentArgs {
  parentThread?: ManagerParentThread | null;
  projectId: string;
  requestedEnvironment: EnvironmentArgs;
  threadType: ThreadType;
}

export interface ResolveSupportedPermissionModeArgs {
  preferredPermissionMode: PermissionMode;
  providerId?: string;
}

type ImplicitHostDefaultEnvironment = Extract<
  EnvironmentArgs,
  { type: "host" }
> & {
  workspace: { path: null; type: "unmanaged" };
};

type PersonalHostDefaultEnvironment = Extract<
  EnvironmentArgs,
  { type: "host" }
> & {
  workspace: { type: "personal" };
};

function isImplicitHostDefaultEnvironment(
  environment: EnvironmentArgs,
): environment is ImplicitHostDefaultEnvironment {
  return (
    environment.type === "host" &&
    environment.workspace.type === "unmanaged" &&
    environment.workspace.path === null
  );
}

function isPersonalHostDefaultEnvironment(
  environment: EnvironmentArgs,
): environment is PersonalHostDefaultEnvironment {
  return (
    environment.type === "host" && environment.workspace.type === "personal"
  );
}

function requireHostEnvironmentId(
  environment: Extract<EnvironmentArgs, { type: "host" }>,
): string {
  if (environment.hostId !== undefined) {
    return environment.hostId;
  }
  throw new Error("Host environment is missing hostId");
}

function isManagedChildThread(args: IsManagedChildThreadArgs): boolean {
  if (args.thread.parentThreadId === null) {
    return false;
  }

  return isLiveManagerParentThread({
    parentThread: args.parentThread ?? null,
    projectId: args.thread.projectId,
  });
}

function resolveSupportedPermissionMode(
  args: ResolveSupportedPermissionModeArgs,
): PermissionMode {
  if (!args.providerId || !isAgentProviderId(args.providerId)) {
    return args.preferredPermissionMode;
  }

  const supportedPermissionModes = getBuiltInAgentProviderInfo(args.providerId)
    .capabilities.supportedPermissionModes;
  if (supportedPermissionModes.includes(args.preferredPermissionMode)) {
    return args.preferredPermissionMode;
  }
  if (supportedPermissionModes.includes(DEFAULT_PERMISSION_MODE)) {
    return DEFAULT_PERMISSION_MODE;
  }
  return supportedPermissionModes[0] ?? DEFAULT_PERMISSION_MODE;
}

function buildManagerThreadExecutionDefaults(
  providerId: string,
): ProjectExecutionDefaults | null {
  if (providerId !== PRODUCT_DEFAULT_PROVIDER_ID) {
    return null;
  }

  return {
    providerId,
    model: PRODUCT_DEFAULT_MODEL,
    reasoningLevel: MANAGER_DEFAULT_REASONING_LEVEL,
    permissionMode: resolveSupportedPermissionMode({
      providerId,
      preferredPermissionMode: DEFAULT_PERMISSION_MODE,
    }),
    serviceTier: DEFAULT_SERVICE_TIER,
  };
}

function buildProductThreadExecutionDefaults(
  threadType: ThreadType,
  providerId: string,
): ProjectExecutionDefaults | null {
  const defaults = buildInitialProjectExecutionDefaults(threadType);
  return defaults.providerId === providerId ? defaults : null;
}

export function resolveCreateThreadExecutionDefaults(
  args: ResolveCreateThreadExecutionDefaultsArgs,
): CreateThreadExecutionDefaultsResolved {
  const providerId =
    args.requestedProviderId ??
    args.storedDefaults?.providerId ??
    PRODUCT_DEFAULT_PROVIDER_ID;

  const storedDefaults =
    args.storedDefaults?.providerId === providerId ? args.storedDefaults : null;
  if (storedDefaults) {
    return {
      executionDefaults: storedDefaults,
      providerId,
    };
  }

  return {
    executionDefaults: buildProductThreadExecutionDefaults(
      args.threadType,
      providerId,
    ),
    providerId,
  };
}

export function buildInitialProjectExecutionDefaults(
  threadType: ThreadType,
): ProjectExecutionDefaults {
  if (threadType === "manager") {
    const managerDefaults = buildManagerThreadExecutionDefaults(
      PRODUCT_DEFAULT_PROVIDER_ID,
    );
    if (!managerDefaults) {
      throw new Error("Manager defaults were not configured");
    }
    return managerDefaults;
  }

  return {
    providerId: PRODUCT_DEFAULT_PROVIDER_ID,
    model: PRODUCT_DEFAULT_MODEL,
    reasoningLevel: DEFAULT_REASONING_LEVEL,
    permissionMode: resolveSupportedPermissionMode({
      providerId: PRODUCT_DEFAULT_PROVIDER_ID,
      preferredPermissionMode: DEFAULT_PERMISSION_MODE,
    }),
    serviceTier: DEFAULT_SERVICE_TIER,
  };
}

export function resolveCreateThreadEnvironment(
  args: ResolveCreateThreadEnvironmentArgs,
): EnvironmentArgs {
  if (
    args.projectId === PERSONAL_PROJECT_ID &&
    args.threadType === "standard" &&
    isLiveManagerParentThread({
      parentThread: args.parentThread ?? null,
      projectId: args.projectId,
    }) &&
    isPersonalHostDefaultEnvironment(args.requestedEnvironment)
  ) {
    if (!args.parentThread?.environmentId) {
      throw new Error("Personal manager parent is missing an environment");
    }
    return {
      type: "reuse",
      environmentId: args.parentThread.environmentId,
    };
  }

  if (
    args.threadType === "standard" &&
    isLiveManagerParentThread({
      parentThread: args.parentThread ?? null,
      projectId: args.projectId,
    }) &&
    isImplicitHostDefaultEnvironment(args.requestedEnvironment)
  ) {
    return {
      type: "host",
      hostId: requireHostEnvironmentId(args.requestedEnvironment),
      workspace: { type: "managed-worktree", baseBranch: { kind: "default" } },
    };
  }

  return args.requestedEnvironment;
}

export function resolveThreadDefaultPermissionMode(
  args: ResolveThreadDefaultPermissionModeArgs,
): PermissionMode {
  if (isManagedChildThread(args)) {
    return resolveSupportedPermissionMode({
      providerId: args.thread.providerId,
      preferredPermissionMode: MANAGED_CHILD_PERMISSION_MODE,
    });
  }

  return resolveSupportedPermissionMode({
    providerId: args.thread.providerId,
    preferredPermissionMode: DEFAULT_PERMISSION_MODE,
  });
}

export function resolveThreadExecutionPermissionMode(
  args: ResolveThreadExecutionPermissionModeArgs,
): PermissionMode {
  if (args.requestedPermissionMode) {
    return args.requestedPermissionMode;
  }
  if (args.lastExecutionPermissionMode) {
    return args.lastExecutionPermissionMode;
  }

  const defaultPermissionMode = resolveThreadDefaultPermissionMode({
    parentThread: args.parentThread,
    thread: args.thread,
  });
  if (isManagedChildThread(args)) {
    return defaultPermissionMode;
  }

  return args.projectExecutionPermissionMode ?? defaultPermissionMode;
}
