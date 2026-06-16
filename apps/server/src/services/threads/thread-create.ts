import {
  deleteThread,
  findEnvironmentByHostPath,
  hasNonTerminalThreadInEnvironment,
} from "@bb/db";
import type { Project } from "@bb/domain";
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
  ThreadProvisionContext,
  ThreadProvisionEnvironmentIntent,
} from "./thread-provisioning-context.js";
import { resolveManagedDefaultBaseBranchSpec } from "../projects/worktree-base-branch.js";

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
  request: ThreadCreateServiceRequest;
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
      input: args.request.input,
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

  const thread = await createProvisioningThread(deps, {
    environmentId,
    environmentIntent,
    executionDefaults,
    request,
  });
  deps.telemetry.capture({
    name: "thread_created",
    properties: {
      is_child_thread: parentThread !== null,
      provider: request.providerId,
    },
  });
  return thread;
}
