import {
  getEnvironment,
  getHost,
  type DbConnection,
  type EnvironmentRow,
} from "@bb/db";
import {
  resolveEnvironmentHostLifecycle,
  type EnvironmentProviderSelection,
  type Thread,
} from "@bb/domain";
import { ApiError } from "../../errors.js";
import {
  threadEnvironmentUnavailableDetails,
  threadNotWritableReasonForStatus,
  throwThreadEnvironmentUnavailable,
  throwThreadNotWritable,
} from "../lib/lifecycle-api-errors.js";
import { getEnvironmentProvider } from "../plugins/plugin-environment-provider-registry.js";

export interface ThreadEnvironmentRestoreDeps {
  db: DbConnection;
}

/**
 * Why a thread cannot be handed a fresh workspace in place of the destroyed
 * one it still points at.
 *
 * `not_destroyed` is the "nothing to do" refusal — the thread still has a
 * workspace, ready or being prepared — while `unrecoverable` is the terminal
 * one: the provider that built the workspace, or the machine it stood on, is
 * no longer here to build it again.
 */
export type ThreadEnvironmentRestoreRefusal =
  | "never_attached"
  | "not_destroyed"
  | "thread_busy"
  | "unrecoverable";

export interface ThreadEnvironmentRestoreTarget {
  environment: EnvironmentRow;
  environmentProviderId: string;
  selection: EnvironmentProviderSelection;
}

export type ThreadEnvironmentRestoreResolution =
  | { restorable: true; target: ThreadEnvironmentRestoreTarget }
  | { restorable: false; refusal: ThreadEnvironmentRestoreRefusal };

type RestoreCandidateThread = Pick<
  Thread,
  "archivedAt" | "deletedAt" | "environmentId" | "status"
>;

function isRestoreReadyThreadStatus(status: Thread["status"]): boolean {
  return status === "idle" || status === "error";
}

/**
 * Whether the thread's destroyed workspace can be rebuilt, and with what.
 *
 * A managed workspace outlives its files: the environment row keeps the branch
 * the work was committed to, the provider that created it and the machine it
 * ran on, so provisioning can create a second workspace on that same branch and
 * attach it to the thread. That is only true while all three parts are still
 * here — hence the provider registration and machine checks rather than a bare
 * `status === "destroyed"` test.
 */
export function resolveThreadEnvironmentRestore(
  deps: ThreadEnvironmentRestoreDeps,
  args: { thread: RestoreCandidateThread },
): ThreadEnvironmentRestoreResolution {
  const { thread } = args;
  if (thread.deletedAt !== null || thread.archivedAt !== null) {
    return { restorable: false, refusal: "thread_busy" };
  }
  if (!isRestoreReadyThreadStatus(thread.status)) {
    return { restorable: false, refusal: "thread_busy" };
  }
  if (thread.environmentId === null) {
    return { restorable: false, refusal: "never_attached" };
  }
  const environment = getEnvironment(deps.db, thread.environmentId);
  if (environment === null) {
    return { restorable: false, refusal: "never_attached" };
  }
  if (environment.status !== "destroyed") {
    return { restorable: false, refusal: "not_destroyed" };
  }
  const { environmentProviderId, environmentProviderSelection } = environment;
  if (environmentProviderId === null || environmentProviderSelection === null) {
    return { restorable: false, refusal: "unrecoverable" };
  }
  const record = getEnvironmentProvider(environmentProviderId);
  if (
    record === undefined ||
    record.pluginId !== environment.environmentProviderPluginId
  ) {
    return { restorable: false, refusal: "unrecoverable" };
  }
  if (
    resolveEnvironmentHostLifecycle(getHost(deps.db, environment.hostId)) !==
    "active"
  ) {
    return { restorable: false, refusal: "unrecoverable" };
  }
  return {
    restorable: true,
    target: {
      environment,
      environmentProviderId,
      selection: environmentProviderSelection,
    },
  };
}

export function canRestoreThreadEnvironment(
  deps: ThreadEnvironmentRestoreDeps,
  args: { thread: RestoreCandidateThread },
): boolean {
  return resolveThreadEnvironmentRestore(deps, args).restorable;
}

export function throwThreadEnvironmentRestoreRefusal(
  refusal: ThreadEnvironmentRestoreRefusal,
  thread: Pick<Thread, "archivedAt" | "deletedAt" | "status">,
): never {
  switch (refusal) {
    case "never_attached":
      return throwThreadEnvironmentUnavailable(
        threadEnvironmentUnavailableDetails("never_attached", null),
      );
    case "not_destroyed":
      throw new ApiError(
        409,
        "invalid_request",
        "Thread workspace is not destroyed, so there is nothing to restore",
      );
    case "thread_busy":
      return throwThreadNotWritable(
        thread,
        threadNotWritableReasonForStatus(thread.status),
        "Thread must be settled to restore its workspace",
      );
    case "unrecoverable":
      return throwThreadEnvironmentUnavailable(
        threadEnvironmentUnavailableDetails("destroyed", "destroyed"),
      );
  }
}
