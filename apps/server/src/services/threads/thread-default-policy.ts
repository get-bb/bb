import {
  getAgentProviderServerCapabilities,
  getSupportedPermissionModes,
  listBuiltInAgentProviderInfos,
} from "@bb/agent-providers";
import type {
  PermissionMode,
  ProjectExecutionDefaults,
  RecordedPermissionMode,
  ReasoningLevel,
  ServiceTier,
  Thread,
} from "@bb/domain";
import { PERSONAL_PROJECT_ID, clampPermissionModeToCeiling } from "@bb/domain";
import type { EnvironmentArgs } from "@bb/server-contract";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import type { WorkSessionDeps } from "../../types.js";
import { callHostRetryableOnlineRpc } from "../hosts/online-rpc.js";
import { requireConnectedPrimaryHostId } from "../hosts/primary-host.js";
import { resolveProjectWorkspaceTarget } from "../projects/project-workspace.js";
import { resolveDefaultWorktreeBaseBranch } from "../projects/worktree-base-branch.js";
import { isLiveParentThread, type ParentThread } from "./thread-parent.js";

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
const DEFAULT_PERMISSION_MODE: PermissionMode = "auto";

/** Catalog order is the single source for both the model picker and the
 * product fallback used when no caller or project has chosen a provider. */
function requireProductDefaultProviderId(): string {
  const providerId = listBuiltInAgentProviderInfos()[0]?.id;
  if (providerId === undefined) {
    throw new Error("Built-in agent provider catalog is empty");
  }
  return providerId;
}

const PRODUCT_DEFAULT_PROVIDER_ID = requireProductDefaultProviderId();

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
  lastExecutionPermissionMode?: RecordedPermissionMode;
  parentThread?: ParentThread | null;
  parentThreadExecutionPermissionMode?: RecordedPermissionMode;
  projectExecutionPermissionMode?: PermissionMode;
  requestedPermissionMode?: PermissionMode;
  thread: Pick<
    Thread,
    "originKind" | "parentThreadId" | "projectId" | "providerId"
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

  const supportedPermissionModes = getSupportedPermissionModes(args.providerId);
  if (!supportedPermissionModes) {
    return args.preferredPermissionMode;
  }

  if (supportedPermissionModes.includes(args.preferredPermissionMode)) {
    return args.preferredPermissionMode;
  }
  if (supportedPermissionModes.includes(DEFAULT_PERMISSION_MODE)) {
    return DEFAULT_PERMISSION_MODE;
  }
  if (supportedPermissionModes.includes("full")) {
    return "full";
  }
  return supportedPermissionModes[0] ?? DEFAULT_PERMISSION_MODE;
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
    executionDefaults: null,
    providerId,
  };
}

export function buildProviderThreadExecutionDefaults(args: {
  model: string;
  providerId: string;
}): ProjectExecutionDefaults {
  return {
    providerId: args.providerId,
    model: args.model,
    reasoningLevel: DEFAULT_REASONING_LEVEL,
    permissionMode: resolveSupportedPermissionMode({
      providerId: args.providerId,
      preferredPermissionMode: DEFAULT_PERMISSION_MODE,
    }),
    serviceTier: DEFAULT_SERVICE_TIER,
  };
}

/**
 * Resolve the `{ type: "project-default" }` thread-creation environment into
 * a concrete request. Server-owned defaulting policy for callers (plugins,
 * scripts) that must not re-derive the compose flow's choices. The personal
 * project gets a personal workspace on the primary host. Every other project
 * gets a fresh managed worktree when its primary source exposes a usable base
 * branch, or works in that source checkout when it does not (for example, a
 * non-Git directory or a repository with no commits). Host inspection failures
 * remain failures; only a successful inspection can select the source checkout.
 */
export async function resolveProjectDefaultThreadEnvironment(
  deps: WorkSessionDeps,
  args: { projectId: string },
): Promise<EnvironmentArgs> {
  if (args.projectId === PERSONAL_PROJECT_ID) {
    // hostId is resolved to the primary host downstream, exactly like an
    // app-composed personal thread that omits it.
    return { type: "host", workspace: { type: "personal" } };
  }

  const hostId = requireConnectedPrimaryHostId(deps);
  const source = resolveProjectWorkspaceTarget(deps, {
    hostId,
    projectId: args.projectId,
  });
  const checkout = await callHostRetryableOnlineRpc(deps, {
    hostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: {
      type: "host.list_branches",
      path: source.path,
      limit: 1,
    },
  });
  const baseBranch = resolveDefaultWorktreeBaseBranch(checkout);
  if (baseBranch === null) {
    return {
      type: "host",
      hostId,
      workspace: { type: "unmanaged", path: null },
    };
  }

  return {
    type: "host",
    hostId,
    workspace: {
      type: "managed-worktree",
      // Pin the inspected ref so downstream provisioning does not need to
      // inspect again or race a changing default branch.
      baseBranch: { kind: "named", name: baseBranch },
    },
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
  const permissionMode = resolvePreferredThreadExecutionPermissionMode(args);
  if (
    !isManagedChildThread(args) ||
    args.parentThreadExecutionPermissionMode === undefined
  ) {
    return permissionMode;
  }

  const ceiling = normalizeRecordedPermissionMode(
    args.parentThreadExecutionPermissionMode,
  );
  const supported = args.thread.providerId
    ? getSupportedPermissionModes(args.thread.providerId)
    : null;
  // A null clamp means the provider supports nothing at or below the parent's
  // mode; returning the ceiling lets provider validation reject the pairing.
  return (
    clampPermissionModeToCeiling({
      ceiling,
      permissionMode,
      ...(supported ? { supportedPermissionModes: supported } : {}),
    }) ?? ceiling
  );
}

function resolvePreferredThreadExecutionPermissionMode(
  args: ResolveThreadExecutionPermissionModeArgs,
): PermissionMode {
  if (args.requestedPermissionMode) {
    return args.requestedPermissionMode;
  }
  if (args.lastExecutionPermissionMode) {
    return normalizeRecordedPermissionMode(args.lastExecutionPermissionMode);
  }

  if (
    isManagedChildThread(args) &&
    args.parentThreadExecutionPermissionMode !== undefined
  ) {
    return resolveSupportedPermissionMode({
      providerId: args.thread.providerId,
      preferredPermissionMode: normalizeRecordedPermissionMode(
        args.parentThreadExecutionPermissionMode,
      ),
    });
  }

  const defaultPermissionMode = resolveThreadDefaultPermissionMode({
    thread: args.thread,
  });
  return args.projectExecutionPermissionMode ?? defaultPermissionMode;
}

/**
 * Resolve a historical permission fact into the current execution contract.
 * Stored events remain unchanged; only future work is translated. Legacy
 * workspace-write keeps its workspace boundary, while legacy readonly falls
 * back to Accept Edits instead of being accepted as a public writable alias.
 */
export function normalizeRecordedPermissionMode(
  permissionMode: RecordedPermissionMode,
): PermissionMode {
  switch (permissionMode) {
    case "accept-edits":
    case "auto":
    case "full":
      return permissionMode;
    case "workspace-write":
    case "readonly":
      return "accept-edits";
  }
}
