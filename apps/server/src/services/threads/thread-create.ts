import {
  deleteThread,
  findEnvironmentByHostPath,
  getEnvironment,
  hasNonTerminalThreadInEnvironment,
} from "@bb/db";
import type { Project } from "@bb/domain";
import type { UnmanagedBranchSpec } from "@bb/server-contract";
import type { AppDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import { requireNonDestroyedHostWithStatus } from "../lib/entity-lookup.js";
import { runtimeErrorLogFields } from "../lib/error-log-fields.js";
import { throwEnvironmentNotReady } from "../lib/lifecycle-api-errors.js";
import { buildExecutionOptions } from "./thread-commands.js";
import {
  prependManagerPreferencesSystemMessageIfChanged,
  recordManagerDynamicFileDelivery,
  withManagerPreferencesDeliveryLock,
} from "./manager-dynamic-file-delivery.js";
import {
  rememberProjectExecutionDefaultsForCreate,
  resolveProjectExecutionDefaultsForCreate,
} from "./project-execution-defaults.js";
import {
  createThreadRecord,
  getThreadSafe,
  requirePublicProjectForThreadCreate,
} from "./thread-create-helpers.js";
import { resolveStableThreadRequestEnvironment } from "./thread-request-eligibility.js";
import { resolveCreateThreadEnvironment } from "./thread-default-policy.js";
import { assertValidManagerParentThread } from "./thread-parent.js";
import {
  type ThreadCreateServiceRequestInput,
  type ThreadCreateServiceRequest,
} from "./thread-create-request.js";
import {
  advanceThreadProvisioning,
  requestThreadProvision,
} from "./thread-provisioning.js";
import type { ThreadProvisionEnvironmentIntent } from "./thread-provisioning-context.js";

type ThreadCreateDeps = Pick<
  AppDeps,
  "config" | "db" | "hub" | "lifecycleDedupers" | "logger" | "machineAuth"
>;

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

interface PrepareManagerThreadInitialInputArgs {
  environmentIntent: ThreadProvisionEnvironmentIntent;
  input: ThreadCreateServiceRequest["input"];
  request: ThreadCreateServiceRequest;
  thread: NonNullable<ReturnType<typeof createThreadRecord>>;
}

function scheduleThreadProvisioningAdvance(
  deps: ThreadCreateDeps,
  threadId: string,
): void {
  void advanceThreadProvisioning(deps, {
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

function resolveProvisionHostId(
  deps: ThreadCreateDeps,
  environmentIntent: ThreadProvisionEnvironmentIntent,
): string {
  switch (environmentIntent.type) {
    case "direct-managed":
    case "direct-personal":
    case "direct-unmanaged":
    case "checkout-unmanaged":
      return environmentIntent.hostId;
    case "reuse": {
      const environment = getEnvironment(
        deps.db,
        environmentIntent.environmentId,
      );
      if (!environment) {
        throw new ApiError(
          404,
          "environment_not_found",
          "Environment not found",
        );
      }
      return environment.hostId;
    }
  }
}

async function prepareManagerThreadInitialInput(
  deps: ThreadCreateDeps,
  args: PrepareManagerThreadInitialInputArgs,
) {
  if (args.thread.type !== "manager") {
    return { input: args.input, stateUpdate: null };
  }

  const hostId = resolveProvisionHostId(deps, args.environmentIntent);
  return prependManagerPreferencesSystemMessageIfChanged(deps, {
    hostId,
    input: args.input,
    mode: "first-boot",
    thread: args.thread,
  });
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
    await withManagerPreferencesDeliveryLock({ thread }, async () => {
      const preparedInput = await prepareManagerThreadInitialInput(deps, {
        environmentIntent: args.environmentIntent,
        input: args.request.input,
        request: args.request,
        thread,
      });
      requestThreadProvision(deps, {
        thread,
        environmentIntent: args.environmentIntent,
        execution,
        input: preparedInput.input,
        titleProvided: Boolean(args.request.title),
      });
      recordManagerDynamicFileDelivery(deps, preparedInput.stateUpdate);
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
      threadId: thread.id,
    });
  } else {
    scheduleThreadProvisioningAdvance(deps, thread.id);
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
    ? assertValidManagerParentThread(deps, {
        parentThreadId: requestInput.parentThreadId,
        projectId: requestInput.projectId,
      })
    : null;
  const { executionDefaults, providerId } =
    resolveProjectExecutionDefaultsForCreate(deps, {
      executionInputSources: requestInput.executionInputSources,
      model: requestInput.model,
      projectId: requestInput.projectId,
      providerId: requestInput.providerId,
      threadType: requestInput.type,
    });
  const request: ThreadCreateServiceRequest = {
    ...requestInput,
    environment: resolveCreateThreadEnvironment({
      parentThread,
      projectId: requestInput.projectId,
      requestedEnvironment: requestInput.environment,
      threadType: requestInput.type,
    }),
    providerId,
  };
  const resolvedEnvironment = resolveStableThreadRequestEnvironment(deps, {
    environment: request.environment,
    projectId: request.projectId,
  });

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

  return createProvisioningThread(deps, {
    environmentId,
    environmentIntent,
    executionDefaults,
    request,
  });
}
