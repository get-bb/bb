import {
  deleteThread,
  findEnvironmentByHostPath,
  getEnvironment,
  hasNonTerminalThreadInEnvironment,
} from "@bb/db";
import type { Project, Thread } from "@bb/domain";
import {
  getBuiltInAgentProviderInfo,
  isAgentProviderId,
} from "@bb/agent-providers";
import type { UnmanagedBranchSpec } from "@bb/server-contract";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import { ensureHostSessionReadyForWork } from "../hosts/host-lifecycle.js";
import { requireNonDestroyedHostWithStatus } from "../lib/entity-lookup.js";
import { runtimeErrorLogFields } from "../lib/error-log-fields.js";
import { throwEnvironmentNotReady } from "../lib/lifecycle-api-errors.js";
import { buildExecutionOptions } from "./thread-commands.js";
import { getLastProviderThreadId } from "./thread-events.js";
import {
  rememberProjectExecutionDefaultsForCreate,
  resolveProjectExecutionDefaultsForCreate,
} from "./project-execution-defaults.js";
import { validatePromptAttachmentReferences } from "../projects/attachments.js";
import {
  createThreadRecord,
  getThreadSafe,
  requirePublicProjectForThreadCreate,
} from "./thread-create-helpers.js";
import {
  resolveStableThreadRequestEnvironment,
  type ResolvedStableThreadRequestEnvironment,
} from "./thread-request-eligibility.js";
import { resolveCreateThreadEnvironment } from "./thread-default-policy.js";
import { assertValidParentThread } from "./thread-parent.js";
import {
  type ThreadCreateServiceRequestInput,
  type ThreadCreateServiceRequest,
} from "./thread-create-request.js";
import {
  advanceThreadProvisioning,
  requestThreadProvision,
} from "./thread-provisioning.js";
import type {
  ThreadForkDescriptor,
  ThreadProvisionContext,
  ThreadProvisionEnvironmentIntent,
} from "./thread-provisioning-context.js";

type ThreadCreateDeps = LoggedPendingInteractionWorkSessionDeps;

interface ExistingUnmanagedEnvironmentIntentByHostPathArgs {
  branch: UnmanagedBranchSpec | undefined;
  hostId: string;
  path: string;
  request: ThreadCreateServiceRequest;
}

interface ExistingUnmanagedEnvironmentIntentResult {
  environmentId: string;
  intent:
    | Extract<ThreadProvisionEnvironmentIntent, { type: "reuse" }>
    | Extract<ThreadProvisionEnvironmentIntent, { type: "checkout-unmanaged" }>;
}

interface CreateProvisioningThreadArgs {
  environmentId: string | null;
  executionDefaults: Parameters<
    typeof buildExecutionOptions
  >[2]["projectDefaults"];
  fork: ThreadForkDescriptor | null;
  request: ThreadCreateServiceRequest;
}

interface ResolveForkDescriptorArgs {
  childHostId: string | null;
  childOrigin: ThreadCreateServiceRequest["childOrigin"];
  parentThread: Thread | null;
  providerId: string;
}

/**
 * Resolve the native-fork descriptor for a child thread, or null when the child
 * cannot be provisioned as a fork. Both forks and side chats are native forks:
 * they clone the parent's provider session at its branch point so the child
 * carries the full conversation history (a fork then waits idle; a side chat
 * runs its question turn). Forking requires: a child of a live parent (any
 * non-null childOrigin), a provider that supports native fork, a parent that
 * already has a provider session, and a child whose workspace lands on the same
 * host as the parent (a cross-host clone of a provider session is not possible).
 * Returns null when the child is not a child thread (no parent) or the parent's
 * session cannot be cloned; the consumer treats a null descriptor for an
 * empty-input child as an unforkable error rather than a silent fresh start.
 */
function resolveForkDescriptor(
  deps: Pick<ThreadCreateDeps, "db">,
  args: ResolveForkDescriptorArgs,
): ThreadForkDescriptor | null {
  if (args.childOrigin === null || args.parentThread === null) {
    return null;
  }
  if (
    !isAgentProviderId(args.providerId) ||
    !getBuiltInAgentProviderInfo(args.providerId).capabilities.supportsFork
  ) {
    return null;
  }
  const sourceProviderThreadId = getLastProviderThreadId(
    deps,
    args.parentThread.id,
  );
  if (sourceProviderThreadId === null) {
    return null;
  }
  const parentEnvironmentId = args.parentThread.environmentId;
  if (parentEnvironmentId === null || args.childHostId === null) {
    return null;
  }
  const parentEnvironment = getEnvironment(deps.db, parentEnvironmentId);
  if (parentEnvironment === null || parentEnvironment.hostId !== args.childHostId) {
    return null;
  }
  return { sourceProviderThreadId };
}

function childHostIdForResolvedEnvironment(
  resolvedEnvironment: ResolvedStableThreadRequestEnvironment,
): string | null {
  switch (resolvedEnvironment.type) {
    case "reuse":
      return resolvedEnvironment.environment.hostId;
    case "host":
      return resolvedEnvironment.hostId;
    case "personal":
      return resolvedEnvironment.hostId;
  }
}

interface EnsureCreateHostOnlineArgs {
  resolvedEnvironment: ResolvedStableThreadRequestEnvironment;
}

function scheduleThreadProvisioningAdvance(
  deps: ThreadCreateDeps,
  context: ThreadProvisionContext,
  threadId: string,
): void {
  void advanceThreadProvisioning(deps, {
    context,
    threadId,
  }).catch((error) => {
    deps.logger.warn(
      {
        threadId,
        ...runtimeErrorLogFields(deps.config, error),
      },
      "Failed to advance thread provisioning after thread creation",
    );
  });
}

function shouldAdvanceProvisioningBeforeResponse(
  environmentIntent: ThreadProvisionEnvironmentIntent,
): boolean {
  return environmentIntent.type === "direct-personal";
}

function requestUsesPersonalWorkspace(
  request: ThreadCreateServiceRequestInput,
): boolean {
  return (
    request.environment.type === "host" &&
    request.environment.workspace.type === "personal"
  );
}

function assertProjectWorkspaceCompatibility(
  project: Project,
  request: ThreadCreateServiceRequestInput,
): void {
  const personalWorkspace = requestUsesPersonalWorkspace(request);
  if (project.kind === "personal") {
    if (request.environment.type !== "reuse" && !personalWorkspace) {
      throw new ApiError(
        400,
        "invalid_request",
        "Personal project threads must use a personal workspace",
      );
    }
    return;
  }

  if (personalWorkspace) {
    throw new ApiError(
      400,
      "invalid_request",
      "Personal workspaces are only supported for the personal project",
    );
  }
}

async function ensureCreateHostOnline(
  deps: ThreadCreateDeps,
  args: EnsureCreateHostOnlineArgs,
): Promise<void> {
  const hostId =
    args.resolvedEnvironment.type === "reuse"
      ? args.resolvedEnvironment.environment.hostId
      : args.resolvedEnvironment.hostId;
  if (hostId === null) {
    return;
  }
  await ensureHostSessionReadyForWork(deps, { hostId });
}

function existingUnmanagedEnvironmentIntentByHostPath(
  deps: ThreadCreateDeps,
  args: ExistingUnmanagedEnvironmentIntentByHostPathArgs,
): ExistingUnmanagedEnvironmentIntentResult | null {
  const existing = findEnvironmentByHostPath(deps.db, args.hostId, args.path);
  if (!existing) {
    return null;
  }

  if (existing.projectId !== args.request.projectId) {
    throw new ApiError(
      409,
      "invalid_request",
      "Workspace path is already attached to a different project",
    );
  }

  if (!args.branch) {
    if (existing.status === "ready" || existing.status === "provisioning") {
      return {
        environmentId: existing.id,
        intent: {
          type: "reuse",
          environmentId: existing.id,
        },
      };
    }

    throw new ApiError(
      409,
      "invalid_request",
      `Workspace path is already attached to an environment in ${existing.status} state`,
    );
  }

  if (existing.status !== "ready" || !existing.path) {
    throw new ApiError(
      409,
      "invalid_request",
      `Cannot checkout branch while the workspace environment is in ${existing.status} state`,
    );
  }

  if (
    hasNonTerminalThreadInEnvironment(deps.db, {
      environmentId: existing.id,
    })
  ) {
    throw new ApiError(
      409,
      "invalid_request",
      "Cannot checkout branch while another thread is using this workspace",
    );
  }

  return {
    environmentId: existing.id,
    intent: {
      type: "checkout-unmanaged",
      environmentId: existing.id,
      hostId: args.hostId,
      path: args.path,
      branch: args.branch,
    },
  };
}

async function createProvisioningThread(
  deps: ThreadCreateDeps,
  args: CreateProvisioningThreadArgs & {
    environmentIntent: ThreadProvisionEnvironmentIntent;
  },
) {
  const thread = createThreadRecord(deps, {
    request: args.request,
    environmentId: args.environmentId,
    status: "provisioning",
  });
  let execution: Awaited<ReturnType<typeof buildExecutionOptions>>;
  let context: ThreadProvisionContext;
  try {
    execution = await buildExecutionOptions(
      deps,
      args.request,
      {
        ...(args.executionDefaults
          ? { projectDefaults: args.executionDefaults }
          : {}),
        threadId: thread.id,
      },
      "client/turn/requested",
    );
    context = requestThreadProvision(deps, {
      thread,
      environmentIntent: args.environmentIntent,
      execution,
      fork: args.fork,
      input: args.request.input,
      startedOnBehalfOf: args.request.startedOnBehalfOf,
      titleProvided: Boolean(args.request.title),
    });
  } catch (error) {
    deleteThread(deps.db, deps.hub, thread.id);
    throw error;
  }
  rememberProjectExecutionDefaultsForCreate(deps, {
    execution,
    request: args.request,
  });
  if (shouldAdvanceProvisioningBeforeResponse(args.environmentIntent)) {
    await advanceThreadProvisioning(deps, {
      context,
      threadId: thread.id,
    });
  } else {
    scheduleThreadProvisioningAdvance(deps, context, thread.id);
  }
  return getThreadSafe(deps, thread.id);
}

export async function createThreadFromRequest(
  deps: ThreadCreateDeps,
  requestInput: ThreadCreateServiceRequestInput,
) {
  const project = requirePublicProjectForThreadCreate(
    deps,
    requestInput.projectId,
  );
  assertProjectWorkspaceCompatibility(project, requestInput);
  const parentThread = requestInput.parentThreadId
    ? assertValidParentThread(deps, {
        parentThreadId: requestInput.parentThreadId,
        projectId: requestInput.projectId,
      })
    : null;
  // Child-thread coherence + anti-forgery. assertValidParentThread above has
  // already proven parentThreadId is a live, same-project thread, so anchoring
  // senderThreadId to it transitively validates the sender — a caller cannot
  // claim a thread was started on behalf of an arbitrary or cross-project
  // thread.
  if (requestInput.startedOnBehalfOf !== null) {
    if (parentThread === null) {
      throw new ApiError(
        400,
        "invalid_request",
        "startedOnBehalfOf requires a parentThreadId",
      );
    }
    if (requestInput.startedOnBehalfOf.senderThreadId !== parentThread.id) {
      throw new ApiError(
        400,
        "invalid_request",
        "startedOnBehalfOf.senderThreadId must match parentThreadId",
      );
    }
    // Seeding a thread-start without a provider run (startedOnBehalfOf) is only
    // meaningful for a tagged child spawn. Requiring childOrigin keeps the two
    // signals coupled: a single source of truth for "this is a child spawn",
    // so a seed-without-run thread is always tagged and is excluded from
    // reshaping the project's stored execution defaults.
    if (requestInput.childOrigin === null) {
      throw new ApiError(
        400,
        "invalid_request",
        "startedOnBehalfOf requires a childOrigin",
      );
    }
  }
  // Both fork and side-chat are child threads, so they require a parent. Note a
  // side chat legitimately has startedOnBehalfOf null, so this is independent of
  // the check above.
  if (requestInput.childOrigin !== null && parentThread === null) {
    throw new ApiError(
      400,
      "invalid_request",
      "childOrigin requires a parentThreadId",
    );
  }
  await validatePromptAttachmentReferences({
    dataDir: deps.config.dataDir,
    input: requestInput.input,
    projectId: requestInput.projectId,
  });
  const { executionDefaults, providerId } =
    resolveProjectExecutionDefaultsForCreate(deps, {
      executionInputSources: requestInput.executionInputSources,
      model: requestInput.model,
      projectId: requestInput.projectId,
      providerId: requestInput.providerId,
    });
  const request: ThreadCreateServiceRequest = {
    ...requestInput,
    environment: resolveCreateThreadEnvironment({
      parentThread,
      projectId: requestInput.projectId,
      requestedEnvironment: requestInput.environment,
    }),
    providerId,
  };
  const resolvedEnvironment = resolveStableThreadRequestEnvironment(deps, {
    environment: request.environment,
    projectId: request.projectId,
  });
  await ensureCreateHostOnline(deps, { resolvedEnvironment });

  let environmentId: string | null = null;
  let environmentIntent: ThreadProvisionEnvironmentIntent;

  switch (resolvedEnvironment.type) {
    case "reuse": {
      const environment = resolvedEnvironment.environment;
      if (
        environment.status !== "ready" &&
        environment.status !== "provisioning"
      ) {
        throwEnvironmentNotReady(environment);
      }
      if (environment.status === "ready" && !environment.path) {
        throwEnvironmentNotReady(environment);
      }
      if (environment.status === "provisioning") {
        requireNonDestroyedHostWithStatus(deps.db, environment.hostId);
      }
      environmentId = environment.id;
      environmentIntent = {
        type: "reuse",
        environmentId: environment.id,
      };
      break;
    }
    case "host": {
      const hostId = resolvedEnvironment.hostId;
      const workspace = resolvedEnvironment.workspace;
      if (workspace.type === "unmanaged") {
        if (resolvedEnvironment.unmanagedPath === null) {
          throw new Error(
            "Validated unmanaged host request is missing a workspace path",
          );
        }
        const existingIntent = existingUnmanagedEnvironmentIntentByHostPath(
          deps,
          {
            branch: workspace.branch,
            hostId,
            path: resolvedEnvironment.unmanagedPath,
            request,
          },
        );
        environmentIntent = existingIntent?.intent ?? {
          type: "direct-unmanaged",
          hostId,
          path: resolvedEnvironment.unmanagedPath,
          ...(workspace.branch ? { branch: workspace.branch } : {}),
        };
        if (existingIntent) {
          environmentId = existingIntent.environmentId;
        }
        break;
      }

      const managedSource = resolvedEnvironment.localSource;
      if (!managedSource) {
        throw new Error(
          "Validated managed host request is missing a local source",
        );
      }
      environmentIntent = {
        type: "direct-managed",
        hostId,
        sourcePath: managedSource.path,
        baseBranch: workspace.baseBranch,
        workspaceProvisionType: workspace.type,
      };
      break;
    }
    case "personal": {
      if (resolvedEnvironment.hostId === null) {
        throw new Error("Resolved personal environment is missing hostId");
      }
      environmentIntent = {
        type: "direct-personal",
        hostId: resolvedEnvironment.hostId,
        workspaceProvisionType: "personal",
      };
      break;
    }
  }

  const fork = resolveForkDescriptor(deps, {
    childHostId: childHostIdForResolvedEnvironment(resolvedEnvironment),
    childOrigin: request.childOrigin,
    parentThread,
    providerId: request.providerId,
  });

  // A fork/side-chat must clone the parent's provider session. When that clone
  // could not be resolved (parent has no active session, provider lacks fork
  // support, or a cross-host mismatch) AND there is no input to run a fresh
  // turn, starting the thread would dispatch an empty, session-less start that
  // the daemon rejects and that would land as a history-less dead end. Forks
  // are sent with empty input, so they hit this; side chats carry the user's
  // question, so they do not. Fail the create with an actionable error instead.
  if (
    request.childOrigin !== null &&
    fork === null &&
    request.input.length === 0
  ) {
    throw new ApiError(
      400,
      "invalid_request",
      "Cannot fork: parent has no active session to clone",
    );
  }

  const thread = await createProvisioningThread(deps, {
    environmentId,
    environmentIntent,
    executionDefaults,
    fork,
    request,
  });
  deps.telemetry.capture({
    name: "thread_created",
    properties: {
      is_automation: requestInput.automationId !== null,
      is_child_thread: parentThread !== null,
      provider: request.providerId,
    },
  });
  return thread;
}
