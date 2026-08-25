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
import { DISPATCH_HOLD_USER_HOLDER } from "@bb/domain";
import type { DispatchHoldHolder } from "@bb/domain";
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
  copyForkSourceHistory,
  resolveThreadForkPoint,
  type ThreadForkPoint,
} from "./thread-fork-history.js";
import {
  rememberProjectExecutionDefaultsForCreate,
  resolveProjectExecutionDefaultsForCreate,
} from "./project-execution-defaults.js";
import { validatePromptAttachmentReferences } from "../projects/attachments.js";
import { resolvePluginMentionContextInputs } from "../plugins/plugin-mentions.js";
import {
  createThreadDispatchHold,
  SCHEDULED_DISPATCH_HOLD_REASON,
} from "./dispatch-holds.js";
import {
  dispatchExecutionSources,
  dispatchGateHolder,
  dispatchHoldReasonForPass,
  hasDispatchAmendments,
  hasDispatchGates,
  runDispatchGatePass,
  type DispatchAmendmentResult,
} from "./dispatch-gates.js";
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
  scheduleThreadProvisioningAdvance,
} from "./thread-provisioning.js";
import type {
  ThreadProvisionContext,
  ThreadProvisionEnvironmentIntent,
} from "./thread-provisioning-context.js";
import { resolveManagedDefaultBaseBranchSpec } from "../projects/worktree-base-branch.js";
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
  fork: ThreadForkPoint | null;
  request: ThreadCreateServiceRequest;
  providerInput?: ThreadCreateServiceRequestInput["input"];
}

interface ResolveForkPointArgs {
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

function resolveForkPoint(
  deps: Pick<ThreadCreateDeps, "db" | "providerRegistry">,
  args: ResolveForkPointArgs,
): ThreadForkPoint | null {
  if (args.originKind === null || args.sourceThread === null) {
    return null;
  }
  if (!deps.providerRegistry.supportsFork(args.providerId)) {
    return null;
  }
  if (args.sourceThread.providerId !== args.providerId) {
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
  return resolveThreadForkPoint(deps, {
    sourceSeqEnd: args.sourceSeqEnd,
    sourceThread: args.sourceThread,
  });
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
  sourcePath: string;
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

async function resolveManagedBaseBranchForCreate(
  deps: ThreadCreateDeps,
  args: ResolveManagedBaseBranchForCreateArgs,
): Promise<BaseBranchSpec> {
  if (args.baseBranch.kind === "named") {
    return args.baseBranch;
  }

  try {
    const result = await callHostRetryableOnlineRpc(deps, {
      hostId: args.hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: {
        type: "host.inspect_git_source",
        path: args.sourcePath,
        remoteRefresh: "background",
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
    pluginAmended: boolean;
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
    if (
      args.fork !== null &&
      args.fork.historyEndSequence !== null &&
      args.request.visibility === "visible"
    ) {
      copyForkSourceHistory(deps, {
        fork: thread,
        historyEndSequence: args.fork.historyEndSequence,
        sourceThreadId: args.fork.sourceThreadId,
      });
    }
    execution = await buildExecutionOptions(deps, args.request, {
      ...(args.executionDefaults
        ? { projectDefaults: args.executionDefaults }
        : {}),
      hostId: intentHostId(deps, args.environmentIntent),
      threadId: thread.id,
    });
    context = requestThreadProvision(deps, {
      thread,
      environmentIntent: args.environmentIntent,
      execution,
      fork: args.fork?.descriptor ?? null,
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
    pluginAmended: args.pluginAmended,
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

/**
 * What a held creation parks its first turn under. Phase 1 only ever produced
 * a user-owned `holdUntil` hold; a `thread.create` gate verdict produces the
 * same row with a plugin holder and the pass's reason, which is why this is a
 * descriptor rather than a bare timestamp.
 */
interface HeldThreadDispatchHold {
  holder: DispatchHoldHolder;
  reason: string;
  resumeAt: number | null;
  userReleasable: boolean;
}

/**
 * Held creation: everything the normal path resolves (provider, model,
 * permission ceiling, environment intent, fork point) is resolved and frozen,
 * but nothing is dispatched. The thread inserts `idle` with no turn, no
 * environment work and no provisioning intent, and the first turn becomes a
 * user-owned hold.
 *
 * No provisioning context is parked. The live context
 * (`rememberActiveThreadProvisionContext`) is in-memory and only valid while
 * the thread is `starting`, so a parked one would not survive the wait, let
 * alone a restart. The hold carries the resolved intent instead and
 * {@link releaseDispatchHoldAndDispatch} builds the context when it releases —
 * which is also what makes "release schedules provisioning" true after a
 * server restart.
 */
async function createHeldThread(
  deps: ThreadCreateDeps,
  args: CreateProvisioningThreadArgs & {
    environmentIntent: ThreadProvisionEnvironmentIntent;
    hold: HeldThreadDispatchHold;
    pluginAmended: boolean;
  },
) {
  const thread = createThreadRecord(deps, {
    request: args.request,
    environmentId: args.environmentId,
    status: "idle",
  });
  let execution: Awaited<ReturnType<typeof buildExecutionOptions>>;
  try {
    if (
      args.fork !== null &&
      args.fork.historyEndSequence !== null &&
      args.request.visibility === "visible"
    ) {
      copyForkSourceHistory(deps, {
        fork: thread,
        historyEndSequence: args.fork.historyEndSequence,
        sourceThreadId: args.fork.sourceThreadId,
      });
    }
    execution = await buildExecutionOptions(deps, args.request, {
      ...(args.executionDefaults
        ? { projectDefaults: args.executionDefaults }
        : {}),
      hostId: intentHostId(deps, args.environmentIntent),
      threadId: thread.id,
    });
    createThreadDispatchHold(deps, {
      threadId: thread.id,
      environmentId: args.environmentId,
      holder: args.hold.holder,
      payload: {
        kind: "inline",
        input: args.request.input,
        execution,
        pluginInputs: args.request.pluginInputs ?? {},
      },
      reason: args.hold.reason,
      resumeAt: args.hold.resumeAt,
      userReleasable: args.hold.userReleasable,
      threadStartContext: {
        environmentIntent: args.environmentIntent,
        fork: args.fork?.descriptor ?? null,
        ...(args.providerInput !== undefined
          ? { providerInput: args.providerInput }
          : {}),
        startedOnBehalfOf: args.request.startedOnBehalfOf,
        titleProvided: Boolean(args.request.title),
      },
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
    pluginAmended: args.pluginAmended,
    request: args.request,
  });
  return getThreadSafe(deps, thread.id);
}

interface ResolveCreateThreadVisibilityArgs {
  parentThread: Pick<Thread, "visibility"> | null;
  requestedVisibility: ThreadVisibility | undefined;
}

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
    providerInput?: ThreadCreateServiceRequestInput["input"];
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
  const requestInput = {
    ...rawRequestInput,
    environment:
      rawRequestInput.environment.type === "project-default"
        ? await resolveProjectDefaultThreadEnvironment(deps, {
            projectId: rawRequestInput.projectId,
          })
        : rawRequestInput.environment,
  };
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
  await deps.providerRegistry.whenRegistrationsSettled();
  let { executionDefaults, providerId, requestedModel } =
    resolveProjectExecutionDefaultsForCreate(deps, {
      executionInputSources: requestInput.executionInputSources,
      model: requestInput.model,
      projectId: requestInput.projectId,
      providerId: requestInput.providerId,
    });
  // The `thread.create` gate pass: defaults are resolved, nothing is inserted
  // yet, and no environment work has started — so a hold here costs no
  // worktree, no setup script and no host resources.
  //
  // A `holdUntil` request skips it deliberately. That dispatch is not
  // advancing now, and the plan settles that a user hold is not a gate
  // verdict; the pass runs when the timer releases it instead.
  const gateOutcome =
    requestInput.holdUntil === undefined && hasDispatchGates("thread.create")
      ? await runDispatchGatePass(deps, {
          stage: "thread.create",
          thread: null,
          threadResponse: null,
          project,
          // Only a reuse request already names an environment; every other
          // shape resolves one after this pass, so the gate sees null.
          environmentId:
            requestInput.environment.type === "reuse"
              ? requestInput.environment.environmentId
              : null,
          input: requestInput.input,
          requestedExecution: {
            providerId,
            model: requestedModel ?? executionDefaults?.model ?? null,
            reasoningLevel:
              requestInput.reasoningLevel ??
              executionDefaults?.reasoningLevel ??
              null,
            serviceTier:
              requestInput.serviceTier ?? executionDefaults?.serviceTier ?? null,
            permissionMode:
              requestInput.permissionMode ??
              executionDefaults?.permissionMode ??
              null,
          },
          executionSources: dispatchExecutionSources(
            requestInput.executionInputSources ?? {},
          ),
          origin: requestInput.origin,
          originPluginId: requestInput.originPluginId ?? null,
          startedOnBehalfOf: requestInput.startedOnBehalfOf,
          parentThreadId: requestInput.parentThreadId ?? null,
          pluginInputs: requestInput.pluginInputs ?? {},
          release: null,
        })
      : null;
  const amendments: DispatchAmendmentResult | null =
    gateOutcome?.amendments ?? null;
  if (amendments !== null && hasDispatchAmendments(amendments)) {
    if (amendments.input !== null) requestInput.input = amendments.input;
    if (amendments.environment !== null) {
      // A gate may amend to the same `project-default` marker a caller can
      // send, so it resolves through the same server-owned policy the request
      // did rather than reaching provisioning as a marker.
      requestInput.environment =
        amendments.environment.type === "project-default"
          ? await resolveProjectDefaultThreadEnvironment(deps, {
              projectId: requestInput.projectId,
            })
          : amendments.environment;
    }
    if (amendments.reasoningLevel !== null) {
      requestInput.reasoningLevel = amendments.reasoningLevel;
    }
    if (amendments.serviceTier !== null) {
      requestInput.serviceTier = amendments.serviceTier;
    }
    if (amendments.permissionMode !== null) {
      requestInput.permissionMode = amendments.permissionMode;
    }
    if (amendments.providerId !== null || amendments.model !== null) {
      // A new provider brings its own stored defaults, so the whole default
      // resolution is redone rather than patched — the same call, with the
      // amended values marked `plugin` so they are used but never remembered.
      const amended = resolveProjectExecutionDefaultsForCreate(deps, {
        executionInputSources: {
          ...requestInput.executionInputSources,
          ...(amendments.providerId !== null
            ? { providerId: "plugin" as const }
            : {}),
          ...(amendments.model !== null ? { model: "plugin" as const } : {}),
        },
        model: amendments.model ?? requestInput.model,
        projectId: requestInput.projectId,
        providerId: amendments.providerId ?? requestInput.providerId,
      });
      executionDefaults = amended.executionDefaults;
      providerId = amended.providerId;
      requestedModel = amended.requestedModel;
      requestInput.model = amended.requestedModel ?? requestInput.model;
      requestInput.providerId = providerId;
    }
  }
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

  const fork = resolveForkPoint(deps, {
    childHostId,
    originKind: request.originKind ?? null,
    providerId: request.providerId,
    sourceSeqEnd: request.sourceSeqEnd,
    sourceThread,
  });

  if (request.originKind !== null && fork === null) {
    throw new ApiError(
      400,
      "fork_source_session_unavailable",
      "Cannot fork: source has no active session to clone",
    );
  }

  const createArgs = {
    environmentId,
    environmentIntent,
    executionDefaults: resolvedExecutionDefaults,
    fork,
    ...(options.providerInput !== undefined
      ? { providerInput: options.providerInput }
      : {}),
    request,
  };
  const pluginAmended = amendments !== null && hasDispatchAmendments(amendments);
  // Three outcomes, in priority order: a gate held the pass (its verdict owns
  // the row), the caller scheduled the send (`holdUntil`, user-owned), or the
  // thread starts now. A `holdUntil` request never reaches a gate, so the two
  // hold branches cannot both apply.
  const gateHold =
    gateOutcome?.kind === "hold"
      ? ({
          holder: dispatchGateHolder(gateOutcome.holder.pluginId),
          reason: dispatchHoldReasonForPass(gateOutcome),
          resumeAt: gateOutcome.holder.resumeAt,
          // Release-now is how a user overrides a plugin's decision, and the
          // pass that runs then skips the owning gate for exactly that reason.
          userReleasable: true,
        } satisfies HeldThreadDispatchHold)
      : null;
  const scheduledHold =
    request.holdUntil === undefined
      ? null
      : ({
          holder: DISPATCH_HOLD_USER_HOLDER,
          reason: SCHEDULED_DISPATCH_HOLD_REASON,
          resumeAt: request.holdUntil,
          userReleasable: true,
        } satisfies HeldThreadDispatchHold);
  const hold = gateHold ?? scheduledHold;
  const thread =
    hold === null
      ? await createProvisioningThread(deps, { ...createArgs, pluginAmended })
      : await createHeldThread(deps, { ...createArgs, hold, pluginAmended });
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
