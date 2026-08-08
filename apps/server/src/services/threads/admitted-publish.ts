import {
  admitThreadCommand,
  getEnvironment,
  getThread,
  type AdmitThreadCommandOutcome,
} from "@bb/db";
import type {
  ActorStamp,
  ClientTurnRequestId,
  Environment,
  PersistedThreadCommandAdmission,
  Thread,
  ThreadCommandAdmissionResult,
} from "@bb/domain";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import { ApiError } from "../../errors.js";
import type { AppDeps } from "../../types.js";
import { requireWorkspaceCommandTarget } from "../environments/workspace-command-target.js";
import {
  requireAvailableWorkspaceStatus,
} from "../environments/workspace-rpc-results.js";
import { callEnvironmentWorkspaceStatus } from "../environments/workspace-status.js";
import { runLiveCommandAndWait } from "../hosts/live-command-wait.js";
import { fingerprintBranchPublishRequest } from "./message-send-fingerprint.js";

const DEFAULT_PUBLISH_BODY = "Published from room.";

export interface AdmitBranchPublishArgs {
  actor: ActorStamp;
  /**
   * Default PR title when the client omitted `title` (typically the task
   * title). Must be non-empty; resolved by the room command adapter.
   */
  defaultTitle: string;
  payload: {
    body?: string;
    requestId: ClientTurnRequestId;
    title?: string;
  };
  thread: Thread;
}

export type AdmitBranchPublishResult = {
  kind: "accepted" | "replayed";
  admission: PersistedThreadCommandAdmission;
};

class BranchPublishDiscoverySentinel extends Error {
  readonly name = "BranchPublishDiscoverySentinel";
  constructor() {
    super("Branch publish discovery rollback");
  }
}

function throwIdentityConflict(): never {
  throw new ApiError(
    409,
    "thread_command_admission_conflict",
    "Thread command request identity conflicts with an existing admission",
  );
}

function isNoChangesApiError(error: unknown): boolean {
  return error instanceof ApiError && error.body.code === "no_changes";
}

function headShaFromStatus(
  status: ReturnType<typeof requireAvailableWorkspaceStatus>,
): string | null {
  if (
    status.checkout.kind === "branch" ||
    status.checkout.kind === "detached"
  ) {
    return status.checkout.headSha;
  }
  return null;
}

function requireRoomEnvironment(
  deps: Pick<AppDeps, "db">,
  thread: Thread,
): Environment {
  if (thread.environmentId === null) {
    throw new ApiError(
      409,
      "invalid_request",
      "Thread has no environment to publish",
    );
  }
  const environment = getEnvironment(deps.db, thread.environmentId);
  if (environment === null) {
    throw new ApiError(404, "environment_not_found", "Environment not found");
  }
  if (!environment.isGitRepo) {
    throw new ApiError(
      409,
      "invalid_request",
      "Publish requires a git environment",
    );
  }
  if (
    environment.branchName === null ||
    environment.branchName.length === 0 ||
    environment.baseBranch === null ||
    environment.baseBranch.length === 0
  ) {
    throw new ApiError(
      409,
      "invalid_request",
      "Room environment is missing branch configuration",
    );
  }
  return environment;
}

/**
 * Runs the synchronous publish side effects: commit when dirty, push the room
 * branch, then open or reuse an OPEN PR. Returns the terminal admission result.
 */
async function executeBranchPublishSideEffects(
  deps: AppDeps,
  args: {
    body: string | undefined;
    environment: Environment;
    title: string;
  },
): Promise<ThreadCommandAdmissionResult> {
  const target = requireWorkspaceCommandTarget(args.environment);
  const { workspaceContext } = target;
  const branchName = args.environment.branchName;
  const baseBranch = args.environment.baseBranch;
  if (branchName === null || baseBranch === null) {
    throw new ApiError(
      409,
      "invalid_request",
      "Room environment is missing branch configuration",
    );
  }

  const statusResult = await callEnvironmentWorkspaceStatus(deps, {
    environment: args.environment,
    target,
  });
  const workspaceStatus = requireAvailableWorkspaceStatus(statusResult);

  let commitSha = headShaFromStatus(workspaceStatus);

  if (workspaceStatus.workingTree.hasUncommittedChanges) {
    try {
      const commit = await runLiveCommandAndWait(deps, {
        hostId: target.hostId,
        timeoutMs: COMMAND_TIMEOUT_MS,
        command: {
          type: "workspace.commit",
          environmentId: target.environmentId,
          workspaceContext,
          message: args.title,
        },
      });
      commitSha = commit.commitSha;
    } catch (error) {
      // Concurrent clean: continue with the pre-existing head when present.
      if (!isNoChangesApiError(error)) {
        throw error;
      }
    }
  }

  await runLiveCommandAndWait(deps, {
    hostId: target.hostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: {
      type: "workspace.push",
      environmentId: target.environmentId,
      workspaceContext,
      branch: branchName,
    },
  });

  if (commitSha === null || commitSha.length === 0) {
    const afterPush = requireAvailableWorkspaceStatus(
      await callEnvironmentWorkspaceStatus(deps, {
        environment: args.environment,
        target,
      }),
    );
    commitSha = headShaFromStatus(afterPush);
  }
  if (commitSha === null || commitSha.length === 0) {
    throw new ApiError(
      409,
      "invalid_request",
      "Unable to resolve commit SHA after publish",
    );
  }

  const pullRequest = await runLiveCommandAndWait(deps, {
    hostId: target.hostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: {
      type: "workspace.pull_request_create",
      environmentId: target.environmentId,
      workspaceContext,
      base: baseBranch,
      head: branchName,
      title: args.title,
      ...(args.body !== undefined ? { body: args.body } : {}),
    },
  });

  return {
    disposition: "published",
    provider: pullRequest.provider,
    prNumber: pullRequest.number,
    prUrl: pullRequest.url,
    commitSha,
  };
}

/**
 * Atomically admits `branch.publish` after running the host-side commit → push
 * → PR-create sequence. Discovery rejects exact replays without re-running host
 * work; host `no_changes` surfaces as a typed API error for a clean rejection
 * receipt.
 */
export async function admitBranchPublish(
  deps: AppDeps,
  args: AdmitBranchPublishArgs,
): Promise<AdmitBranchPublishResult> {
  if (args.defaultTitle.length === 0) {
    throw new Error("branch.publish requires a non-empty defaultTitle");
  }

  const requestFingerprint = fingerprintBranchPublishRequest({
    ...(args.payload.title !== undefined ? { title: args.payload.title } : {}),
    ...(args.payload.body !== undefined ? { body: args.payload.body } : {}),
  });
  const title = args.payload.title ?? args.defaultTitle;
  const body = args.payload.body ?? DEFAULT_PUBLISH_BODY;

  try {
    const discovery: AdmitThreadCommandOutcome = admitThreadCommand({
      actor: args.actor,
      commandKind: "branch.publish",
      db: deps.db,
      nowMs: Date.now(),
      requestFingerprint,
      requestId: args.payload.requestId,
      threadId: args.thread.id,
      execute: () => {
        throw new BranchPublishDiscoverySentinel();
      },
    });
    if (discovery.kind === "replayed") {
      return { kind: "replayed", admission: discovery.admission };
    }
    if (discovery.kind === "identity-conflict") {
      throwIdentityConflict();
    }
    throw new Error(
      "Discovery admission for branch.publish unexpectedly accepted",
    );
  } catch (error) {
    if (!(error instanceof BranchPublishDiscoverySentinel)) {
      throw error;
    }
  }

  // Defense in depth: re-assert the thread is idle immediately before the side
  // effects. The room handler already gated on idle, but the discovery admission
  // above rolled back and holds no lock, so a turn could have started since.
  // NOTE: this narrows but does not close the window — a turn can still start
  // between this read and `workspace.commit`, and correctness across concurrent
  // duplicate publishes currently relies on the host push/PR primitives being
  // idempotent. A durable per-thread publish exclusion is the full fix (backlog).
  const current = getThread(deps.db, args.thread.id);
  if (current === null || current.status !== "idle") {
    throw new ApiError(
      409,
      "invalid_request",
      "Publish requires an idle thread",
    );
  }

  const environment = requireRoomEnvironment(deps, args.thread);
  const result = await executeBranchPublishSideEffects(deps, {
    body,
    environment,
    title,
  });

  const outcome = admitThreadCommand({
    actor: args.actor,
    commandKind: "branch.publish",
    db: deps.db,
    nowMs: Date.now(),
    requestFingerprint,
    requestId: args.payload.requestId,
    threadId: args.thread.id,
    execute: () => result,
  });

  if (outcome.kind === "identity-conflict") {
    throwIdentityConflict();
  }
  if (outcome.kind === "replayed") {
    // Side effects already ran; return the durable admission as a replay so the
    // client still receives the original receipt.
    return { kind: "replayed", admission: outcome.admission };
  }

  return { kind: "accepted", admission: outcome.admission };
}
