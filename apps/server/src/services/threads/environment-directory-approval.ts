import {
  createEventId,
  getEnvironment,
  getProjectSourceByHost,
  getStoredTurnRequestEventForTurn,
  getThread,
  listEnvironments,
  type EnvironmentRow,
} from "@bb/db";
import {
  ENVIRONMENT_DIRECTORY_APPROVAL_OPERATION,
  isHostPathWithin,
  threadScope,
  turnScope,
  type PermissionMode,
  type ServerApprovalPendingInteraction,
  type Thread,
  type ThreadEventScope,
  type ToolCallResponse,
} from "@bb/domain";
import {
  HOST_RESOLVE_DIRECTORIES_MAX_PATHS,
  type HostResolveDirectoriesResult,
} from "@bb/host-daemon-contract";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import type { AppDeps } from "../../types.js";
import { clampPermissionModeToHost } from "../hosts/permission-ceiling.js";
import { callHostRetryableOnlineRpc } from "../hosts/online-rpc.js";
import { deferAfterResponse } from "../lib/response-deferral.js";
import { deliverDetachedToolResult } from "../plugins/detached-tool-result-delivery.js";
import { queueChildThreadNeedsAttentionNotificationBestEffort } from "./child-thread-notifications.js";
import { isParentNotifiableChildThread } from "./thread-parent.js";
import { resolveExistingThreadPermissionMode } from "./thread-execution-plan.js";
import {
  moveThreadToDirectory,
  threadWritableFailure,
  toolCallFailure,
  toolCallSuccess,
  UPDATE_ENVIRONMENT_DIRECTORY_TOOL_NAME,
} from "./thread-environment-directory.js";
import {
  appendThreadEvent,
  parseStoredTurnRequestEvent,
} from "./thread-events.js";

type ResolvedDirectory = HostResolveDirectoriesResult["entries"][number];

export type EnvironmentDirectoryMovePlacement =
  | { kind: "move"; path: string }
  | { kind: "needs_approval"; path: string }
  | { kind: "refused"; message: string };

interface ResolvePlacementArgs {
  currentEnvironment: EnvironmentRow;
  path: string;
  thread: Thread;
  turnId: string;
}

interface RequestMoveApprovalArgs extends ResolvePlacementArgs {
  callId: string;
}

const MOVE_APPROVAL_DETAIL =
  "It's outside this project and its worktrees. In Accept edits, the agent edits files there without asking.";

function effectiveTurnPermissionMode(
  deps: AppDeps,
  args: { hostId: string; thread: Thread; turnId: string },
): PermissionMode | null {
  const row = getStoredTurnRequestEventForTurn(deps.db, {
    threadId: args.thread.id,
    turnId: args.turnId,
  });
  if (!row) {
    try {
      return resolveExistingThreadPermissionMode(deps, args.thread.id);
    } catch {
      return null;
    }
  }
  const recorded = parseStoredTurnRequestEvent(row).execution.permissionMode;
  if (
    recorded !== "accept-edits" &&
    recorded !== "auto" &&
    recorded !== "full"
  ) {
    return null;
  }
  try {
    return clampPermissionModeToHost(deps, {
      hostId: args.hostId,
      permissionMode: recorded,
      providerId: args.thread.providerId,
    });
  } catch {
    return null;
  }
}

function projectRootPaths(
  deps: AppDeps,
  args: { hostId: string; projectId: string },
): string[] {
  const checkoutPath =
    getProjectSourceByHost(deps.db, args.projectId, args.hostId)?.path ?? null;
  const managedPaths = listEnvironments(deps.db, {
    hostId: args.hostId,
    projectId: args.projectId,
    statuses: ["ready"],
  }).flatMap((environment) =>
    environment.environmentProviderId !== null && environment.path !== null
      ? [environment.path]
      : [],
  );
  return [
    ...new Set([
      ...(checkoutPath === null ? [] : [checkoutPath]),
      ...managedPaths,
    ]),
  ];
}

async function resolveHostDirectories(
  deps: AppDeps,
  args: { hostId: string; paths: string[] },
): Promise<ResolvedDirectory[]> {
  const entries: ResolvedDirectory[] = [];
  for (
    let offset = 0;
    offset < args.paths.length;
    offset += HOST_RESOLVE_DIRECTORIES_MAX_PATHS
  ) {
    const result = await callHostRetryableOnlineRpc(deps, {
      hostId: args.hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: {
        type: "host.resolve_directories",
        paths: args.paths.slice(
          offset,
          offset + HOST_RESOLVE_DIRECTORIES_MAX_PATHS,
        ),
      },
    });
    entries.push(...result.entries);
  }
  return entries;
}

function isInsideProject(
  target: ResolvedDirectory & { realPath: string },
  roots: readonly ResolvedDirectory[],
): boolean {
  return roots.some(
    (root) =>
      root.realPath !== null &&
      (isHostPathWithin({
        rootPath: root.realPath,
        candidatePath: target.realPath,
      }) ||
        (root.gitCommonDir !== null &&
          root.gitCommonDir === target.gitCommonDir)),
  );
}

export async function resolveEnvironmentDirectoryMovePlacement(
  deps: AppDeps,
  args: ResolvePlacementArgs,
): Promise<EnvironmentDirectoryMovePlacement> {
  const hostId = args.currentEnvironment.hostId;
  const mode = effectiveTurnPermissionMode(deps, {
    hostId,
    thread: args.thread,
    turnId: args.turnId,
  });
  if (mode === "auto" || mode === "full") {
    return { kind: "move", path: args.path };
  }

  let resolved: ResolvedDirectory[];
  try {
    resolved = await resolveHostDirectories(deps, {
      hostId,
      paths: [
        args.path,
        ...projectRootPaths(deps, { hostId, projectId: args.thread.projectId }),
      ],
    });
  } catch {
    return { kind: "needs_approval", path: args.path };
  }
  const [target, ...roots] = resolved;
  if (!target || target.realPath === null) {
    return {
      kind: "refused",
      message: `${args.path} does not exist or is not a directory on this machine.`,
    };
  }
  const resolvedTarget = { ...target, realPath: target.realPath };
  return isInsideProject(resolvedTarget, roots)
    ? { kind: "move", path: resolvedTarget.realPath }
    : { kind: "needs_approval", path: resolvedTarget.realPath };
}

function appendApprovalOperation(
  deps: AppDeps,
  args: {
    environmentId: string | null;
    message: string;
    scope: ThreadEventScope;
    status: "completed" | "failed";
    threadId: string;
  },
): void {
  appendThreadEvent(deps, {
    threadId: args.threadId,
    environmentId: args.environmentId,
    type: "system/operation",
    scope: args.scope,
    data: {
      operation: ENVIRONMENT_DIRECTORY_APPROVAL_OPERATION,
      operationId: createEventId(),
      status: args.status,
      message: args.message,
    },
  });
}

function notifyParentOfPendingMove(
  deps: AppDeps,
  args: { path: string; threadId: string },
): void {
  const childThread = getThread(deps.db, args.threadId);
  if (
    !childThread ||
    !isParentNotifiableChildThread(childThread, "needs-attention")
  ) {
    return;
  }
  const parentThreadId = childThread.parentThreadId;
  deferAfterResponse({
    config: deps.config,
    context: { childThreadId: childThread.id, parentThreadId },
    logger: deps.logger,
    name: "Directory move approval notification",
    work: () =>
      queueChildThreadNeedsAttentionNotificationBestEffort(deps, {
        blockerSummary: `Blocked on approval to move to ${args.path}, which is outside the project.`,
        childThread,
        parentThreadId,
      }),
  });
}

export function requestEnvironmentDirectoryMoveApproval(
  deps: AppDeps,
  args: RequestMoveApprovalArgs,
): ToolCallResponse {
  deps.pendingInteractions.requestServerApproval({
    threadId: args.thread.id,
    request: {
      kind: "environment_directory_move",
      path: args.path,
      fromEnvironmentId: args.currentEnvironment.id,
      requestTurnId: args.turnId,
    },
    payload: {
      kind: "approval",
      subject: {
        kind: "tool_use",
        itemId: args.callId,
        tool: UPDATE_ENVIRONMENT_DIRECTORY_TOOL_NAME,
        presentation: {
          label: {
            pending: "Moving the thread directory",
            completed: "Moved the thread directory",
          },
          icon: { glyph: "FolderOpen" },
          title: args.path,
          detail: MOVE_APPROVAL_DETAIL,
        },
      },
      reason: "Move this thread to a directory outside the project?",
      availableDecisions: ["allow_once", "deny"],
    },
  });
  appendApprovalOperation(deps, {
    environmentId: args.currentEnvironment.id,
    message: `Waiting for approval to move to ${args.path}`,
    scope: turnScope(args.turnId),
    status: "completed",
    threadId: args.thread.id,
  });
  notifyParentOfPendingMove(deps, {
    path: args.path,
    threadId: args.thread.id,
  });
  return toolCallSuccess(
    `${args.path} is outside this project, so moving there needs the user's approval. bb asked them; the thread has not moved. End your turn now. If they approve, bb moves the thread and starts your next turn there; if they deny, you'll be told.`,
  );
}

function responseText(response: ToolCallResponse): string {
  return response.contentItems
    .flatMap((item) => (item.type === "inputText" ? [item.text] : []))
    .join(" ");
}

async function settleMoveApproval(
  deps: AppDeps,
  interaction: ServerApprovalPendingInteraction,
): Promise<void> {
  const { request } = interaction;
  const thread = getThread(deps.db, interaction.threadId);
  if (!thread || threadWritableFailure(thread) !== null) {
    return;
  }
  const scope = threadScope();
  if (interaction.resolution?.decision !== "allow_once") {
    appendApprovalOperation(deps, {
      environmentId: thread.environmentId,
      message: `Move to ${request.path} denied`,
      scope,
      status: "completed",
      threadId: thread.id,
    });
    await deliverDetachedToolResult(deps, {
      deliverFailureToIdleThread: true,
      threadId: thread.id,
      toolName: UPDATE_ENVIRONMENT_DIRECTORY_TOOL_NAME,
      presentation: null,
      response: toolCallFailure(
        `The user denied moving this thread to ${request.path}. It stays in its current directory; continue there or ask the user what they want.`,
      ),
    });
    return;
  }

  const currentEnvironment =
    thread.environmentId === request.fromEnvironmentId
      ? getEnvironment(deps.db, request.fromEnvironmentId)
      : null;
  const response = currentEnvironment
    ? await moveThreadToDirectory(deps, {
        currentEnvironment,
        path: request.path,
        scope,
        thread,
      })
    : toolCallFailure(
        "the thread's directory changed after the move was requested",
      );
  if (!response.success) {
    appendApprovalOperation(deps, {
      environmentId: thread.environmentId,
      message: `Move to ${request.path} failed: ${responseText(response)}`,
      scope,
      status: "failed",
      threadId: thread.id,
    });
    return;
  }
  await deliverDetachedToolResult(deps, {
    deliverFailureToIdleThread: false,
    threadId: thread.id,
    toolName: UPDATE_ENVIRONMENT_DIRECTORY_TOOL_NAME,
    presentation: null,
    response: toolCallSuccess(
      `The user approved the move. This thread now runs in ${request.path}; continue the task you were working on before the move.`,
    ),
  });
}

export function handleResolvedServerApproval(
  deps: AppDeps,
  interaction: ServerApprovalPendingInteraction,
): void {
  deferAfterResponse({
    config: deps.config,
    context: { interactionId: interaction.id, threadId: interaction.threadId },
    logger: deps.logger,
    name: "Directory move approval",
    work: () => settleMoveApproval(deps, interaction),
  });
}
