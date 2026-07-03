import {
  buildAcpProviderInfo,
  getAgentProviderServerCapabilities,
  getBuiltInAgentProviderInfo,
  isAcpProviderId,
  isAgentProviderId,
} from "@bb/agent-providers";
import type {
  PermissionMode,
  ProjectExecutionDefaults,
  ReasoningLevel,
  ServiceTier,
  Thread,
} from "@bb/domain";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type { EnvironmentArgs } from "@bb/server-contract";
import type { AppDeps } from "../../types.js";
import { requireConnectedPrimaryHostId } from "../hosts/primary-host.js";
import {
  isLiveParentThread,
  type ParentThread,
} from "./thread-parent.js";

export const DEFAULT_SERVICE_TIER: ServiceTier = "default";
export const DEFAULT_REASONING_LEVEL: ReasoningLevel = "medium";

/**
 * Whether provider sessions get the Workflows feature (dynamic multi-agent
 * orchestration). Server-owned product policy that reads the provider's
 * `supportsWorkflows` capability fact: the Workflow tool's own opt-in rules
 * govern when the model actually uses it, and the feature is meaningless for
 * providers without the concept. Host-level user/org disables still win inside
 * the CLI.
 */
export function resolveWorkflowsEnabledPolicy(providerId: string): boolean {
  return (
    getAgentProviderServerCapabilities(providerId)?.supportsWorkflows ?? false
  );
}
const DEFAULT_PERMISSION_MODE: PermissionMode = "full";
const PRODUCT_DEFAULT_PROVIDER_ID = "codex";
const PRODUCT_DEFAULT_MODEL = "gpt-5.5";

export interface ResolveCreateThreadExecutionDefaultsArgs {
  requestedProviderId?: string;
  storedDefaults: ProjectExecutionDefaults | null;
}

export interface CreateThreadExecutionDefaultsResolved {
  executionDefaults: ProjectExecutionDefaults | null;
  providerId: string;
}

export interface IsManagedChildThreadArgs {
  parentThread?: ParentThread | null;
  thread: Pick<Thread, "parentThreadId" | "projectId">;
}

export interface ResolveThreadDefaultPermissionModeArgs {
  thread: Pick<Thread, "providerId">;
}

export interface ResolveThreadExecutionPermissionModeArgs {
  lastExecutionPermissionMode?: PermissionMode;
  parentThread?: ParentThread | null;
  parentThreadExecutionPermissionMode?: PermissionMode;
  projectExecutionPermissionMode?: PermissionMode;
  requestedPermissionMode?: PermissionMode;
  thread: Pick<
    Thread,
    "childOrigin" | "originKind" | "parentThreadId" | "projectId" | "providerId"
  >;
}

export interface ResolveCreateThreadEnvironmentArgs {
  parentThread?: ParentThread | null;
  projectId: string;
  requestedEnvironment: EnvironmentArgs;
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

  return isLiveParentThread({
    parentThread: args.parentThread ?? null,
    projectId: args.thread.projectId,
  });
}

function resolveSupportedPermissionMode(
  args: ResolveSupportedPermissionModeArgs,
): PermissionMode {
  if (!args.providerId) {
    return args.preferredPermissionMode;
  }

  const provider = isAgentProviderId(args.providerId)
    ? getBuiltInAgentProviderInfo(args.providerId)
    : isAcpProviderId(args.providerId)
      ? buildAcpProviderInfo({
          id: args.providerId,
          displayName: args.providerId,
        })
      : null;
  if (!provider) {
    return args.preferredPermissionMode;
  }

  const supportedPermissionModes =
    provider.capabilities.supportedPermissionModes;
  if (supportedPermissionModes.includes(args.preferredPermissionMode)) {
    return args.preferredPermissionMode;
  }
  if (supportedPermissionModes.includes(DEFAULT_PERMISSION_MODE)) {
    return DEFAULT_PERMISSION_MODE;
  }
  return supportedPermissionModes[0] ?? DEFAULT_PERMISSION_MODE;
}

function buildProductThreadExecutionDefaults(
  providerId: string,
): ProjectExecutionDefaults | null {
  const defaults = buildInitialProjectExecutionDefaults();
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
    executionDefaults: buildProductThreadExecutionDefaults(providerId),
    providerId,
  };
}

export function buildInitialProjectExecutionDefaults(): ProjectExecutionDefaults {
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

/**
 * Resolve the `{ type: "project-default" }` thread-creation environment into
 * a concrete request. Server-owned defaulting policy for callers (plugins,
 * scripts) that must not re-derive the compose flow's choices: the personal
 * project gets a personal workspace on the primary host, and every other
 * project gets a fresh managed worktree from the project source's default
 * branch on the primary host. Throws a clear ApiError (502 host_unavailable)
 * when no enrolled, connected host exists.
 */
export function resolveProjectDefaultThreadEnvironment(
  deps: Pick<AppDeps, "config" | "db" | "hub">,
  args: { projectId: string },
): EnvironmentArgs {
  if (args.projectId === PERSONAL_PROJECT_ID) {
    // hostId is resolved to the primary host downstream, exactly like an
    // app-composed personal thread that omits it.
    return { type: "host", workspace: { type: "personal" } };
  }
  return {
    type: "host",
    hostId: requireConnectedPrimaryHostId(deps),
    workspace: { type: "managed-worktree", baseBranch: { kind: "default" } },
  };
}

export function resolveCreateThreadEnvironment(
  args: ResolveCreateThreadEnvironmentArgs,
): EnvironmentArgs {
  if (
    args.projectId === PERSONAL_PROJECT_ID &&
    isLiveParentThread({
      parentThread: args.parentThread ?? null,
      projectId: args.projectId,
    }) &&
    isPersonalHostDefaultEnvironment(args.requestedEnvironment)
  ) {
    if (!args.parentThread?.environmentId) {
      throw new Error("Personal parent thread is missing an environment");
    }
    return {
      type: "reuse",
      environmentId: args.parentThread.environmentId,
    };
  }

  if (
    isLiveParentThread({
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
  return resolveSupportedPermissionMode({
    providerId: args.thread.providerId,
    preferredPermissionMode: DEFAULT_PERMISSION_MODE,
  });
}

export function resolveThreadExecutionPermissionMode(
  args: ResolveThreadExecutionPermissionModeArgs,
): PermissionMode {
  if ((args.thread.originKind ?? args.thread.childOrigin) === "side-chat") {
    return "readonly";
  }
  if (args.requestedPermissionMode) {
    return args.requestedPermissionMode;
  }
  if (args.lastExecutionPermissionMode) {
    return args.lastExecutionPermissionMode;
  }

  if (
    isManagedChildThread(args) &&
    args.parentThreadExecutionPermissionMode !== undefined
  ) {
    return resolveSupportedPermissionMode({
      providerId: args.thread.providerId,
      preferredPermissionMode: args.parentThreadExecutionPermissionMode,
    });
  }

  const defaultPermissionMode = resolveThreadDefaultPermissionMode({
    thread: args.thread,
  });
  return args.projectExecutionPermissionMode ?? defaultPermissionMode;
}
