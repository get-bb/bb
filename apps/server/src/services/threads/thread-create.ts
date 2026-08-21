import {
  deleteThread,
  findProjectEnvironmentByHostPath,
  getEnvironment,
  getThread,
} from "@bb/db";
import type {
  ProjectExecutionDefaults,
  Project,
  Thread,
  ThreadOriginKind,
  ThreadVisibility,
} from "@bb/domain";
import type { BaseBranchSpec, UnmanagedBranchSpec } from "@bb/server-contract";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import { ApiError } from "../../errors.js";
import { unmanagedAttachRefusal } from "./workspace-path-claims.js";
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
import { resolvePluginMentionContextInputs } from "../plugins/plugin-mentions.js";
import { emitPluginThreadDeleted } from "../plugins/plugin-thread-events.js";
import {
  createThreadRecord,
  getThreadSafe,
  requirePublicProjectForThreadCreate,
} from "./thread-create-helpers.js";
import {
  resolveStableThreadRequestEnvironment,
  type ResolvedStableThreadRequestEnvironment,
} from "./thread-request-eligibility.js";
import {
  buildProviderThreadExecutionDefaults,
  resolveCreateThreadEnvironment,
  resolveProjectDefaultThreadEnvironment,
} from "./thread-default-policy.js";
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
import {
  resolveManagedDefaultBaseBranchSpec,
  resolveManagedNamedBaseBranchSpec,
} from "../projects/worktree-base-branch.js";
import { applyLoggedEnvironmentLifecycleEvent } from "../environments/lifecycle-outcome.js";
import { resolveSystemProviderModels } from "../system/execution-options.js";

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
  providerInput?: ThreadCreateServiceRequestInput["input"];
}

interface ResolveForkDescriptorArgs {
  childHostId: string;
  originKind: ThreadOriginKind | null;
  providerId: string;
  sourceSeqEnd: number | undefined;
  sourceThread: Thread | null;
}

interface ResolveCatalogExecutionDefaultsArgs {
  cwd?: string;
  executionDefaults: ProjectExecutionDefaults | null;
  hostId: string;
  providerId: string;
  requestedModel: string | null;
}

async function resolveCatalogExecutionDefaults(
  deps: ThreadCreateDeps,
  args: ResolveCatalogExecutionDefaultsArgs,
): Promise<ProjectExecutionDefaults | null> {
  if (args.executionDefaults !== null || args.requestedModel !== null) {
    return args.executionDefaults;
  }

  const catalog = await resolveSystemProviderModels(deps, {
    ...(args.cwd !== undefined ? { cwd: args.cwd } : {}),
    hostId: args.hostId,
    providerId: args.providerId,
  });
  if (catalog.modelLoadError !== null) {
    throw new ApiError(
      503,
      "model_catalog_unavailable",
      `Unable to load ${args.providerId} models to resolve the default. Try again once the host is connected and the provider is ready.`,
      {
        details: catalog.modelLoadError,
        retryable: true,
      },
    );
  }
  const defaultModel =
    catalog.models.find((model) => model.isDefault) ?? catalog.models[0];
  if (defaultModel === undefined) {
    throw new ApiError(
      503,
      "model_catalog_unavailable",
      `The ${args.providerId} model catalog is empty, so no default model can be resolved.`,
      true,
    );
  }
  return buildProviderThreadExecutionDefaults(deps.providerRegistry, {
    providerId: args.providerId,
    model: defaultModel.model,
  });
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
  deps: Pick<ThreadCreateDeps, "db" | "providerRegistry">,
  args: ResolveForkDescriptorArgs,
): ThreadForkDescriptor | null {
  if (args.originKind === null || args.sourceThread === null) {
    return null;
  }
  if (!deps.providerRegistry.supportsFork(args.providerId)) {
    return null;
  }
  // A provider session ID is opaque to every other provider, so a fork is
  // possible only when the source and the child use the same provider.
  if (args.sourceThread.providerId !== args.providerId) {
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
  if (sourceEnvironmentId === null) {
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
): string {
  switch (resolvedEnvironment.type) {
    case "reuse":
      return resolvedEnvironment.environment.hostId;
    case "host":
      return resolvedEnvironment.hostId;
    case "personal":
      return resolvedEnvironment.hostId;
  }
}

function modelCatalogCwdForResolvedEnvironment(
  resolvedEnvironment: ResolvedStableThreadRequestEnvironment,
): string | undefined {
  switch (resolvedEnvironment.type) {
    case "reuse":
      return resolvedEnvironment.environment.path ?? undefined;
    case "host":
      return (
        resolvedEnvironment.unmanagedPath ??
        resolvedEnvironment.localSource?.path ??
        undefined
      );
    case "personal":
      return undefined;
  }
}

interface ResolveManagedBaseBranchForCreateArgs {
  baseBranch: BaseBranchSpec;
  hostId: string;
  originKind: ThreadOriginKind | null;
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

/**
 * Pick the ref a new managed worktree starts from. `host.list_branches`
 * refreshes the remote-tracking refs and reports how the local default branch
 * relates to origin; the default spec and a plain name that is the default
 * branch both prefer origin when local is equal or behind. A fork names the
 * branch its source environment is on, so it keeps that branch verbatim.
 */
async function resolveManagedBaseBranchForCreate(
  deps: ThreadCreateDeps,
  args: ResolveManagedBaseBranchForCreateArgs,
): Promise<BaseBranchSpec> {
  if (args.baseBranch.kind === "named" && args.originKind !== null) {
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
    return args.baseBranch.kind === "named"
      ? resolveManagedNamedBaseBranchSpec(args.baseBranch, result)
      : resolveManagedDefaultBaseBranchSpec(result);
  } catch (error) {
    deps.logger.warn(
      {
        hostId: args.hostId,
        sourcePath: args.sourcePath,
        ...runtimeErrorLogFields(deps.config, error),
      },
      "Failed to resolve smart worktree base branch; using requested base",
    );
    return args.baseBranch;
  }
}

interface AssertUnmanagedHostPathIsAttachableArgs {
  branch: UnmanagedBranchSpec | undefined;
  dataDir: string;
  hostId: string;
  path: string;
  projectId: string;
}

/**
 * The environment claim on a path is project-scoped, but the directory is
 * physical and shared. Guard the two things that scoping cannot: attaching in
 * place to another project's bb-managed worktree, and rewriting the working
 * tree while another project works in the same folder.
 */
function assertUnmanagedHostPathIsAttachable(
  deps: ThreadCreateDeps,
  args: AssertUnmanagedHostPathIsAttachableArgs,
): void {
  const refusal = unmanagedAttachRefusal(deps.db, {
    checksOutBranch: args.branch !== undefined,
    dataDir: args.dataDir,
    hostId: args.hostId,
    path: args.path,
    projectId: args.projectId,
  });
  if (refusal) {
    throw new ApiError(409, "invalid_request", refusal.message);
  }
}

function existingUnmanagedEnvironmentIntentByHostPath(
  deps: ThreadCreateDeps,
  args: ExistingUnmanagedEnvironmentIntentByHostPathArgs,
): ExistingUnmanagedEnvironmentIntentResult | null {
  const existing = findProjectEnvironmentByHostPath(
    deps.db,
    args.request.projectId,
    args.hostId,
    args.path,
  );
  if (!existing) {
    return null;
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

/** Machine a provisioning intent lands on, for the permission ceiling. */
function intentHostId(
  deps: ThreadCreateDeps,
  intent: ThreadProvisionEnvironmentIntent,
): string | null {
  if (intent.type === "reuse") {
    return getEnvironment(deps.db, intent.environmentId)?.hostId ?? null;
  }
  return intent.hostId;
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
  });
  let execution: Awaited<ReturnType<typeof buildExecutionOptions>>;
  let context: ThreadProvisionContext;
  try {
    execution = await buildExecutionOptions(deps, args.request, {
      ...(args.executionDefaults
        ? { projectDefaults: args.executionDefaults }
        : {}),
      // The environment usually does not exist yet, so the machine's
      // permission ceiling comes from the provisioning intent.
      hostId: intentHostId(deps, args.environmentIntent),
      threadId: thread.id,
    });
    context = requestThreadProvision(deps, {
      thread,
      environmentIntent: args.environmentIntent,
      execution,
      fork: args.fork,
      input: args.request.input,
      ...(args.providerInput !== undefined
        ? { providerInput: args.providerInput }
        : {}),
      startedOnBehalfOf: args.request.startedOnBehalfOf,
      titleProvided: Boolean(args.request.title),
    });
  } catch (error) {
    emitPluginThreadDeleted({
      ...thread,
      deletedAt: Date.now(),
      updatedAt: Date.now(),
    });
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

interface ResolveCreateThreadVisibilityArgs {
  /** Resolved hierarchy parent; null for roots and forks. */
  parentThread: Pick<Thread, "visibility"> | null;
  requestedVisibility: ThreadVisibility | undefined;
}

/**
 * Visibility default for a new thread. An explicit request always wins. A
 * hierarchy child otherwise inherits its parent, so sub-agents delegated by a
 * hidden thread stay out of navigation with it. A side chat is forked with an
 * explicit `hidden` by the plugin that owns it.
 */
function resolveCreateThreadVisibility(
  args: ResolveCreateThreadVisibilityArgs,
): ThreadVisibility {
  if (args.requestedVisibility !== undefined) {
    return args.requestedVisibility;
  }
  return args.parentThread?.visibility ?? "visible";
}

export async function createThreadFromRequest(
  deps: ThreadCreateDeps,
  rawRequestInput: ThreadCreateServiceRequestInput,
  options: {
    /** Provider-facing input when it differs from the persisted start seed. */
    providerInput?: ThreadCreateServiceRequestInput["input"];
    /** Source environment selected by the public fork route. */
    forkSourceEnvironmentId?: string;
  } = {},
) {
  const project = requirePublicProjectForThreadCreate(
    deps,
    rawRequestInput.projectId,
  );
  if (rawRequestInput.origin === "plugin") {
    if (rawRequestInput.originPluginId === undefined) {
      throw new ApiError(
        400,
        "invalid_request",
        'originPluginId is required when origin is "plugin"',
      );
    }
  } else if (rawRequestInput.originPluginId !== undefined) {
    throw new ApiError(
      400,
      "invalid_request",
      'originPluginId requires origin "plugin"',
    );
  }
  // Resolve the server-owned "project-default" environment marker into a
  // concrete environment before any workspace/provisioning logic runs.
  const requestInput = {
    ...rawRequestInput,
    environment:
      rawRequestInput.environment.type === "project-default"
        ? await resolveProjectDefaultThreadEnvironment(deps, {
            projectId: rawRequestInput.projectId,
          })
        : rawRequestInput.environment,
  };
  // Plugin mentions resolve once at send time (plugin design §4.9): each
  // unique mention becomes an agent-only context input appended after the
  // user's message; a resolve failure throws a 422 before the thread is
  // created.
  const pluginMentionContext = await resolvePluginMentionContextInputs(
    requestInput.input,
  );
  if (pluginMentionContext.length > 0) {
    requestInput.input = [...requestInput.input, ...pluginMentionContext];
  }
  assertProjectWorkspaceCompatibility(project, requestInput);
  const originKind = requestInput.originKind ?? null;
  const sourceThreadId =
    requestInput.sourceThreadId ??
    (originKind !== null ? requestInput.parentThreadId : undefined);
  const hierarchyParentThreadId =
    originKind === null ? requestInput.parentThreadId : undefined;
  const parentThread = hierarchyParentThreadId
    ? assertValidParentThread(deps, {
        parentThreadId: hierarchyParentThreadId,
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
    });
  }
  if (originKind !== null && sourceThread === null) {
    throw new ApiError(
      400,
      "invalid_request",
      "originKind requires a sourceThreadId",
    );
  }
  const forkSourceEnvironmentId =
    options.forkSourceEnvironmentId ??
    (originKind === "fork" &&
    sourceThread !== null &&
    sourceThread.environmentId !== null &&
    requestInput.environment.type === "reuse" &&
    requestInput.environment.environmentId === sourceThread.environmentId
      ? sourceThread.environmentId
      : undefined);
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
  // Providers register with plugin startup, which the listener does not wait
  // for: without this, a thread created on boot sees an empty registry and
  // fails with "no provider available".
  await deps.providerRegistry.whenRegistrationsSettled();
  const { executionDefaults, providerId, requestedModel } =
    resolveProjectExecutionDefaultsForCreate(deps, {
      executionInputSources: requestInput.executionInputSources,
      model: requestInput.model,
      projectId: requestInput.projectId,
      providerId: requestInput.providerId,
    });
  const {
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
    visibility: resolveCreateThreadVisibility({
      parentThread,
      requestedVisibility: requestInput.visibility,
    }),
    environment: resolveCreateThreadEnvironment({
      // Source-derived forks already resolve their environment before this
      // call. Applying ordinary child defaults here would turn an isolated
      // personal fork back into source reuse.
      parentThread:
        forkSourceEnvironmentId !== undefined
          ? null
          : (sourceThread ?? parentThread),
      projectId: requestInput.projectId,
      requestedEnvironment: requestInput.environment,
    }),
    providerId,
    titleFallback: deriveTitleFallback(requestInput.input),
  };
  const resolvedEnvironment = resolveStableThreadRequestEnvironment(deps, {
    allowUnmanagedPersonalProjectReuseEnvironmentId: forkSourceEnvironmentId,
    environment: request.environment,
    projectId: request.projectId,
  });
  const childHostId = childHostIdForResolvedEnvironment(resolvedEnvironment);
  const hostDataDir = (
    await ensureHostSessionReadyForWork(deps, { hostId: childHostId })
  ).dataDir;
  const modelCatalogCwd =
    modelCatalogCwdForResolvedEnvironment(resolvedEnvironment);
  const resolvedExecutionDefaults = await resolveCatalogExecutionDefaults(
    deps,
    {
      ...(modelCatalogCwd !== undefined ? { cwd: modelCatalogCwd } : {}),
      executionDefaults,
      hostId: childHostId,
      providerId,
      requestedModel,
    },
  );

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
        assertUnmanagedHostPathIsAttachable(deps, {
          branch: workspace.branch,
          dataDir: hostDataDir,
          hostId,
          path: resolvedEnvironment.unmanagedPath,
          projectId: request.projectId,
        });
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
        baseBranch: await resolveManagedBaseBranchForCreate(deps, {
          baseBranch: workspace.baseBranch,
          hostId,
          originKind,
          sourcePath: managedSource.path,
        }),
        workspaceProvisionType: workspace.type,
      };
      break;
    }
    case "personal": {
      environmentIntent = {
        type: "direct-personal",
        hostId: resolvedEnvironment.hostId,
        workspaceProvisionType: "personal",
      };
      break;
    }
  }

  const fork = resolveForkDescriptor(deps, {
    childHostId,
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
      "fork_source_session_unavailable",
      "Cannot fork: source has no active session to clone",
    );
  }

  const thread = await createProvisioningThread(deps, {
    environmentId,
    environmentIntent,
    executionDefaults: resolvedExecutionDefaults,
    fork,
    ...(options.providerInput !== undefined
      ? { providerInput: options.providerInput }
      : {}),
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
