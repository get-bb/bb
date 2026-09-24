import { getThread, listNonDeletedChildThreads } from "@bb/db";
import {
  canThreadAtHierarchyDepthSpawnChild,
  MAX_THREAD_HIERARCHY_DEPTH,
  type Thread,
} from "@bb/domain";
import type { AppDeps } from "../../types.js";
import { throwParentThreadInvalid } from "../lib/lifecycle-api-errors.js";

export function isAgentDelegatedChildThread<
  T extends Pick<Thread, "parentThreadId">,
>(thread: T): thread is T & { parentThreadId: string } {
  return thread.parentThreadId !== null;
}

export function isParentNotifiableChildThread<
  T extends Pick<
    Thread,
    "parentThreadId" | "originKind" | "parentNotificationsMutedAt"
  >,
>(thread: T): thread is T & { parentThreadId: string } {
  // bb-fork(parent-mute): muted children keep the parent link but stay silent
  return (
    isAgentDelegatedChildThread(thread) &&
    thread.originKind === null &&
    thread.parentNotificationsMutedAt === null
  );
}

export type ParentThread = Pick<
  Thread,
  | "archivedAt"
  | "deletedAt"
  | "environmentId"
  | "id"
  | "parentThreadId"
  | "projectId"
> &
  Partial<Pick<Thread, "originKind">>;

interface IsLiveParentThreadArgs {
  parentThread: ParentThread | null;
}

interface AssertValidParentThreadArgs {
  childThreadId?: string;
  parentThreadId: string;
}

interface ResolveParentDepthArgs {
  childThreadId?: string;
  parentThread: ParentThread;
}

interface ResolveThreadSubtreeDepthArgs {
  threadId: string;
  visitedThreadIds: Set<string>;
}

export function isLiveParentThread(args: IsLiveParentThreadArgs): boolean {
  return (
    args.parentThread !== null &&
    args.parentThread.archivedAt === null &&
    args.parentThread.deletedAt === null
  );
}

function resolveParentDepth(
  deps: Pick<AppDeps, "db">,
  args: ResolveParentDepthArgs,
): number {
  let depth = 0;
  let parentThread: ParentThread | null = args.parentThread;
  const visitedThreadIds = new Set<string>();

  while (parentThread !== null) {
    if (args.childThreadId && parentThread.id === args.childThreadId) {
      throwParentThreadInvalid(
        parentThread.id === args.parentThread.id ? "self" : "cycle",
      );
    }
    if (visitedThreadIds.has(parentThread.id)) {
      throwParentThreadInvalid("cycle");
    }
    visitedThreadIds.add(parentThread.id);
    depth += 1;

    if (parentThread.parentThreadId === null) {
      return depth;
    }

    parentThread = getThread(deps.db, parentThread.parentThreadId);
  }

  return depth;
}

function resolveThreadSubtreeDepth(
  deps: Pick<AppDeps, "db">,
  args: ResolveThreadSubtreeDepthArgs,
): number {
  if (args.visitedThreadIds.has(args.threadId)) {
    throwParentThreadInvalid("cycle");
  }
  args.visitedThreadIds.add(args.threadId);

  const childThreads = listNonDeletedChildThreads(deps.db, {
    parentThreadId: args.threadId,
  });
  let maxChildDepth = 0;
  for (const childThread of childThreads) {
    const childDepth = resolveThreadSubtreeDepth(deps, {
      threadId: childThread.id,
      visitedThreadIds: args.visitedThreadIds,
    });
    maxChildDepth = Math.max(maxChildDepth, childDepth);
  }
  args.visitedThreadIds.delete(args.threadId);

  return maxChildDepth + 1;
}

interface CanThreadSpawnChildArgs {
  thread: ParentThread;
}

export function canThreadSpawnChild(
  deps: Pick<AppDeps, "db">,
  args: CanThreadSpawnChildArgs,
): boolean {
  const depth = resolveParentDepth(deps, {
    parentThread: args.thread,
  });
  return canThreadAtHierarchyDepthSpawnChild(depth);
}

export function assertValidParentThread(
  deps: Pick<AppDeps, "db">,
  args: AssertValidParentThreadArgs,
): Thread {
  const parentThread = getThread(deps.db, args.parentThreadId);
  if (parentThread === null) {
    throwParentThreadInvalid("not_found");
  }
  const liveParentThread: Thread = parentThread;

  if (liveParentThread.archivedAt !== null) {
    throwParentThreadInvalid("archived");
  }
  if (liveParentThread.deletedAt !== null) {
    throwParentThreadInvalid("deleted");
  }
  const parentDepth = resolveParentDepth(deps, {
    childThreadId: args.childThreadId,
    parentThread: liveParentThread,
  });
  const childSubtreeDepth = args.childThreadId
    ? resolveThreadSubtreeDepth(deps, {
        threadId: args.childThreadId,
        visitedThreadIds: new Set<string>(),
      })
    : 1;
  if (parentDepth + childSubtreeDepth > MAX_THREAD_HIERARCHY_DEPTH) {
    throwParentThreadInvalid("too_deep");
  }

  return liveParentThread;
}
