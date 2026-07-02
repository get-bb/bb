import {
  deleteThread,
  findEnvironmentByHostPath,
  getEnvironment,
  getThread,
  hasNonTerminalThreadInEnvironment,
} from "@bb/db";
import type { Project, Thread, ThreadOriginKind } from "@bb/domain";
import {
  getBuiltInAgentProviderInfo,
  isAgentProviderId,
} from "@bb/agent-providers";
import type { BaseBranchSpec, UnmanagedBranchSpec } from "@bb/server-contract";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import { ApiError } from "../../errors.js";
import { ensureHostSessionReadyForWork } from "../hosts/host-lifecycle.js";
import { callHostRetryableOnlineRpc } from "../hosts/online-rpc.js";
import { requireNonDestroyedHostWithStatus } from "../lib/entity-lookup.js";
import { runtimeErrorLogFields } from "../lib/error-log-fields.js";
import { throwEnvironmentNotReady } from "../lib/lifecycle-api-errors.js";
import { buildExecutionOptions } from "./thread-commands.js";
import {
  getLastProviderThreadId,
  getProviderThreadIdAtOrBeforeSequence,
} from "./thread-events.js";
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
import { deriveTitleFallback } from "./title-generation.js";
import {
  advanceThreadProvisioning,
  requestThreadProvision,
} from "./thread-provisioning.js";
import type {
  ThreadForkDescriptor,
  ThreadProvisionContext,
  ThreadProvisionEnvironmentIntent,
} from "./thread-provisioning-context.js";
import { resolveManagedDefaultBaseBranchSpec } from "../projects/worktree-base-branch.js";
import { applyLoggedEnvironmentLifecycleEvent } from "../environments/lifecycle-outcome.js";

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
  originKind: ThreadOriginKind | null;
  providerId: string;
  sourceSeqEnd: number | undefined;
  sourceThread: Thread | null;
}

interface DeriveThreadCreateTitleFallbackArgs {
  input: ThreadCreateServiceRequestInput["input"];
  originKind: ThreadOriginKind | null;
  sourceThread: Thread | null;
}

/**
 * Resolve the native-fork descriptor for a source-derived thread, or null when
 * it cannot be provisioned as a fork. Both forks and side chats are native
 * forks: they clone the source thread's provider session at its branch point so
 * the new thread carries the full conversation history (a fork then waits idle;
 * a side chat runs its question turn). Forking requires: a live source thread
 * (any non-null originKind), a provider that supports native fork, a source that
 * already has a provider session, and a new workspace on the same host as the
 * source (a cross-host clone of a provider session is not possible).
 * Returns null when the request has no source provenance or the source session
 * cannot be cloned; the consumer treats a null descriptor for a source-derived
 * thread as an unforkable error rather than a silent fresh start.
 */
function resolveForkDescriptor(
  deps: Pick<ThreadCreateDeps, "db">,
  args: ResolveForkDescriptorArgs,
): ThreadForkDescriptor | null {
  if (args.originKind === null || args.sourceThread === null) {
    return null;
  }
  if (
    !isAgentProviderId(args.providerId) ||
    !getBuiltInAgentProviderInfo(args.providerId).capabilities.supportsFork
  ) {
    return null;
  }
  const sourceProviderThreadId =
    args.sourceSeqEnd === undefined
      ? getLastProviderThreadId(deps, args.sourceThread.id)
      : getProviderThreadIdAtOrBeforeSequence(deps, {
          sequence: args.sourceSeqEnd,
          threadId: args.sourceThread.id,
        });
  if (sourceProviderThreadId === null) {
    return null;
  }
  const sourceEnvironmentId = args.sourceThread.environmentId;
  if (sourceEnvironmentId === null || args.childHostId === null) {
    return null;
  }
  const sourceEnvironment = getEnvironment(deps.db, sourceEnvironmentId);
  if (
    sourceEnvironment === null ||
    sourceEnvironment.hostId !== args.childHostId
  ) {
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

function sourceThreadDisplayTitle(sourceThread: Thread): string {
  const title = sourceThread.title?.trim();
  if (title) return title;
  const titleFallback = sourceThread.titleFallback?.trim();
  if (titleFallback) return titleFallback;
  return `Thread ${sourceThread.id.slice(0, 8)}`;
}

function deriveThreadCreateTitleFallback({
  input,
  originKind,
  sourceThread,
}: DeriveThreadCreateTitleFallbackArgs): string | null {
  const inputFallback = deriveTitleFallback(input);
  if (inputFallback !== null) {
    return inputFallback;
  }
  if (originKind !== "side-chat" || sourceThread === null) {
    return null;
  }

  return `Side chat of ${sourceThreadDisplayTitle(sourceThread)}`;
}

interface EnsureCreateHostOnlineArgs {
  resolvedEnvironment: ResolvedStableThreadRequestEnvironment;
}

interface ResolveManagedDefaultBaseBranchForCreateArgs {
  baseBranch: BaseBranchSpec;
  hostId: string;
  sourcePath: string;
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

function requireLiveSourceThread(
  deps: Pick<ThreadCreateDeps, "db">,
  args: {
    projectId: string;
    sourceThreadId: string;
  },
): Thread {
  const sourceThread = getThread(deps.db, args.sourceThreadId);
  if (sourceThread === null) {
    throw new ApiError(400, "invalid_request", "sourceThreadId not found");
  }
  if (sourceThread.projectId !== args.projectId) {
    throw new ApiError(
      400,
      "invalid_request",
      "sourceThreadId must belong to the same project",
    );
  }
  if (sourceThread.archivedAt !== null) {
    throw new ApiError(
      400,
      "invalid_request",
      "sourceThreadId must reference an unarchived thread",
    );
  }
  if (sourceThread.deletedAt !== null) {
    throw new ApiError(
      400,
      "invalid_request",
      "sourceThreadId must reference a non-deleted thread",
    );
  }
  return sourceThread;
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

async function resolveManagedDefaultBaseBranchForCreate(
  deps: ThreadCreateDeps,
  args: ResolveManagedDefaultBaseBranchForCreateArgs,
): Promise<BaseBranchSpec> {
  if (args.baseBranch.kind === "named") {
    return args.baseBranch;
  }

  try {
    const result = await callHostRetryableOnlineRpc(deps, {
      hostId: args.hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: {
        type: "host.list_branches",
        path: args.sourcePath,
        limit: 1,
      },
    });
    return resolveManagedDefaultBaseBranchSpec(result);
  } catch (error) {
    deps.logger.warn(
      {
        hostId: args.hostId,
        sourcePath: args.sourcePath,
        ...runtimeErrorLogFields(deps.config, error),
      },
      "Failed to resolve smart worktree base branch; using source default",
    );
    return args.baseBranch;
  }
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
    status: "starting",
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
  const originKind =
    requestInput.originKind ?? requestInput.childOrigin ?? null;
  const sourceThreadId =
    requestInput.sourceThreadId ??
    (originKind !== null ? requestInput.parentThreadId : undefined);
  const hierarchyParentThreadId =
    originKind === null ? requestInput.parentThreadId : undefined;
  if (originKind === "fork" && requestInput.input.length === 0) {
    throw new ApiError(
      400,
      "invalid_request",
      "fork input must contain at least one entry",
    );
  }
  const parentThread = hierarchyParentThreadId
    ? assertValidParentThread(deps, {
        parentThreadId: hierarchyParentThreadId,
        projectId: requestInput.projectId,
      })
    : null;
  if (originKind === null && sourceThreadId !== undefined) {
    throw new ApiError(
      400,
      "invalid_request",
      "sourceThreadId requires an originKind",
    );
  }
  if (originKind === null && requestInput.sourceSeqEnd !== undefined) {
    throw new ApiError(
      400,
      "invalid_request",
      "sourceSeqEnd requires an originKind",
    );
  }
  const sourceThread = sourceThreadId
    ? requireLiveSourceThread(deps, {
        projectId: requestInput.projectId,
        sourceThreadId,
      })
    : null;
  if (originKind !== null && sourceThread !== null) {
    // Forks and side chats are not hierarchy children, but they still consume
    // the same spawn allowance exposed as ThreadResponse.canSpawnChild.
    assertValidParentThread(deps, {
      parentThreadId: sourceThread.id,
      projectId: requestInput.projectId,
    });
  }
  if (originKind !== null && sourceThread === null) {
    throw new ApiError(
      400,
      "invalid_request",
      "originKind requires a sourceThreadId",
    );
  }
  // Provenance coherence + anti-forgery. The validated source/parent thread
  // anchors senderThreadId so a caller cannot claim a start on behalf of an
  // arbitrary or cross-project thread.
  if (requestInput.startedOnBehalfOf !== null) {
    const senderThread = sourceThread ?? parentThread;
    if (senderThread === null) {
      throw new ApiError(
        400,
        "invalid_request",
        "startedOnBehalfOf requires a sourceThreadId or parentThreadId",
      );
    }
    if (requestInput.startedOnBehalfOf.senderThreadId !== senderThread.id) {
      throw new ApiError(
        400,
        "invalid_request",
        sourceThread === null
          ? "startedOnBehalfOf.senderThreadId must match parentThreadId"
          : "startedOnBehalfOf.senderThreadId must match sourceThreadId",
      );
    }
    // Seeding a thread-start without a provider run (startedOnBehalfOf) is
    // only meaningful for a tagged source-derived spawn. Requiring originKind
    // keeps the two signals coupled so the thread is excluded from reshaping
    // the project's stored execution defaults.
    if (originKind === null) {
      throw new ApiError(
        400,
        "invalid_request",
        "startedOnBehalfOf requires an originKind",
      );
    }
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
  const {
    childOrigin: _requestedChildOrigin,
    originKind: _requestedOriginKind,
    parentThreadId: _requestedParentThreadId,
    sourceThreadId: _requestedSourceThreadId,
    ...requestRest
  } = requestInput;
  const request: ThreadCreateServiceRequest = {
    ...requestRest,
    ...(hierarchyParentThreadId
      ? { parentThreadId: hierarchyParentThreadId }
      : {}),
    ...(sourceThread ? { sourceThreadId: sourceThread.id } : {}),
    originKind,
    childOrigin: originKind,
    environment: resolveCreateThreadEnvironment({
      parentThread: sourceThread ?? parentThread,
      projectId: requestInput.projectId,
      requestedEnvironment: requestInput.environment,
    }),
    providerId,
    titleFallback: deriveThreadCreateTitleFallback({
      input: requestInput.input,
      originKind,
      sourceThread,
    }),
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
      let environment = resolvedEnvironment.environment;
      if (environment.status === "retiring") {
        applyLoggedEnvironmentLifecycleEvent(deps, {
          environmentId: environment.id,
          event: { type: "retire.cancelled" },
        });
        environment = getEnvironment(deps.db, environment.id) ?? environment;
      }
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
        requireNonDestroyedHostWithStatus(deps, environment.hostId);
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
        baseBranch: await resolveManagedDefaultBaseBranchForCreate(deps, {
          baseBranch: workspace.baseBranch,
          hostId,
          sourcePath: managedSource.path,
        }),
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
    originKind: request.originKind ?? null,
    providerId: request.providerId,
    sourceSeqEnd: request.sourceSeqEnd,
    sourceThread,
  });

  // A fork/side-chat must clone the source provider session. If that clone
  // cannot be resolved (source has no active session, provider lacks fork
  // support, or the target is cross-host), do not fall back to a fresh
  // history-less thread.start.
  if (request.originKind !== null && fork === null) {
    throw new ApiError(
      400,
      "invalid_request",
      "Cannot fork: source has no active session to clone",
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
      is_child_thread: parentThread !== null,
      provider: request.providerId,
    },
  });
  if (
    (request.startedOnBehalfOf?.initiator ?? "user") === "user" &&
    request.input.length > 0
  ) {
    deps.telemetry.capture({
      name: "user_message_sent",
      properties: {
        is_child_thread: parentThread !== null,
        message_source: "thread_create",
        provider: request.providerId,
      },
    });
  }
  return thread;
}
