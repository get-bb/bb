import type {
  Environment,
  PromptInput,
  ResolvedThreadExecutionOptions,
  Thread,
  ThreadTurnInitiator,
} from "@bb/domain";
import { createThreadProvisioningId } from "@bb/db";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import {
  dispatchManagedEnvironmentReprovision,
  hasActiveManagedEnvironmentProvision,
  MANAGED_REPROVISION_IN_PROGRESS,
  MANAGED_REPROVISION_STARTED,
} from "../environments/environment-provisioning-internal.js";
import { ensureHostSessionReadyForWork } from "../hosts/host-lifecycle.js";
import {
  goneThreadEnvironmentDetails,
  throwEnvironmentNotReady,
  throwThreadEnvironmentUnavailable,
} from "../lib/lifecycle-api-errors.js";
import {
  appendThreadProvisioningEvent,
  getLastProviderThreadId,
} from "./thread-events.js";
import { requestThreadReprovision } from "./thread-provisioning.js";
import { applyLoggedThreadLifecycleEvent } from "./lifecycle-outcome.js";
import { applyLoggedEnvironmentLifecycleEvent } from "../environments/lifecycle-outcome.js";

export interface ReadyThreadEnvironment extends Environment {
  path: string;
  status: "ready";
}

export interface DispatchTurnDuringReprovisionArgs {
  deps: LoggedPendingInteractionWorkSessionDeps;
  environment: Environment;
  execution: ResolvedThreadExecutionOptions;
  initiator: ThreadTurnInitiator;
  input: PromptInput[];
  onStarted?: () => void;
  senderThreadId: string | null;
  thread: Thread;
}

type ThreadTurnDispatchReadDeps = Pick<
  LoggedPendingInteractionWorkSessionDeps,
  "db"
>;

function reprovisionStartedText(
  workspaceProvisionType: Environment["workspaceProvisionType"],
): string {
  switch (workspaceProvisionType) {
    case "managed-worktree":
      return "Restoring worktree";
    case "personal":
      return "Restoring personal workspace";
    case "unmanaged":
      return "Restoring environment";
  }
}

function canRecoverPreStartErroredThread(
  deps: ThreadTurnDispatchReadDeps,
  thread: Thread,
): boolean {
  return (
    thread.status === "error" &&
    getLastProviderThreadId(deps, thread.id) === null
  );
}

export function requireReadyThreadEnvironment(
  environment: Environment,
): ReadyThreadEnvironment {
  if (environment.status !== "ready" || !environment.path) {
    throwEnvironmentNotReady(environment);
  }

  return {
    ...environment,
    path: environment.path,
    status: "ready",
  };
}

export async function dispatchTurnDuringReprovision(
  args: DispatchTurnDuringReprovisionArgs,
): Promise<boolean> {
  if (args.environment.status === "ready" && args.environment.path) {
    return false;
  }

  if (args.environment.status === "retiring") {
    applyLoggedEnvironmentLifecycleEvent(args.deps, {
      environmentId: args.environment.id,
      event: { type: "retire.cancelled" },
    });
    return false;
  }

  // A destroying/destroyed environment is gone and is never reprovisioned.
  // Surface the "environment is gone" condition the frontend banner keys off
  // instead of dispatching a reprovision. Error-recovery reprovision for an
  // `error`-status environment is still legitimate and falls through.
  const goneDetails = goneThreadEnvironmentDetails(args.environment);
  if (goneDetails) {
    throwThreadEnvironmentUnavailable(goneDetails);
  }

  if (!args.environment.managed || args.environment.status === "provisioning") {
    throwEnvironmentNotReady(args.environment);
  }
  if (
    hasActiveManagedEnvironmentProvision(args.deps, {
      environmentId: args.environment.id,
    })
  ) {
    throw new ApiError(
      409,
      "invalid_request",
      "Environment is already provisioning",
    );
  }
  await ensureHostSessionReadyForWork(args.deps, {
    hostId: args.environment.hostId,
  });

  // Stronger than the run.preparing table cell on purpose: an errored
  // thread may reprovision only when it never started (no provider thread id),
  // an event-log condition the thread row cannot express.
  if (
    args.thread.status === "idle" ||
    canRecoverPreStartErroredThread(args.deps, args.thread)
  ) {
    applyLoggedThreadLifecycleEvent(args.deps, {
      event: { type: "run.preparing" },
      threadId: args.thread.id,
    });
  }
  const provisioningId = createThreadProvisioningId();
  const provisionEventSequence = appendThreadProvisioningEvent(args.deps, {
    threadId: args.thread.id,
    environmentId: args.environment.id,
    provisioningId,
    status: "active",
    entries: [
      {
        type: "step",
        key: "workspace-restore-started",
        text: reprovisionStartedText(args.environment.workspaceProvisionType),
        status: "started",
      },
    ],
  });

  requestThreadReprovision(args.deps, {
    thread: args.thread,
    environment: args.environment,
    provisionEventSequence,
    input: args.input,
    execution: args.execution,
    initiator: args.initiator,
    provisioningId,
    senderThreadId: args.senderThreadId,
  });

  const reprovisionResult = await dispatchManagedEnvironmentReprovision(
    args.deps,
    {
      environment: args.environment,
      projectId: args.thread.projectId,
      provisionEventSequence,
      provisioningId,
      threadId: args.thread.id,
    },
  );
  if (reprovisionResult === MANAGED_REPROVISION_IN_PROGRESS) {
    throw new ApiError(
      409,
      "invalid_request",
      "Environment is already provisioning",
    );
  }
  if (reprovisionResult.status !== MANAGED_REPROVISION_STARTED) {
    throw new ApiError(500, "internal_error", "Unexpected reprovision result");
  }

  args.onStarted?.();
  return true;
}
