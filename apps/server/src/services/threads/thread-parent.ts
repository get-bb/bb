import { getThread, listNonDeletedChildThreads } from "@bb/db";
import type { Thread } from "@bb/domain";
import type { AppDeps } from "../../types.js";
import { throwParentThreadInvalid } from "../lib/lifecycle-api-errors.js";

export const MAX_THREAD_HIERARCHY_DEPTH = 4;

/**
 * Whether a thread is an agent-delegated child. Forks and side chats keep
 * provenance in sourceThreadId/originKind instead of parentThreadId, so a
 * non-null parent is now the hierarchy signal.
 */
export function isAgentDelegatedChildThread<
  T extends Pick<Thread, "parentThreadId">,
>(thread: T): thread is T & { parentThreadId: string } {
  return thread.parentThreadId !== null;
}

export type ParentThread = Pick<
  Thread,
  | "archivedAt"
  | "deletedAt"
  | "environmentId"
  | "id"
  | "parentThreadId"
  | "projectId"
>;

export interface IsLiveParentThreadArgs {
  parentThread: ParentThread | null;
  projectId: string;
}

export interface AssertValidParentThreadArgs {
  childThreadId?: string;
  parentThreadId: string;
  projectId: string;
}

interface ResolveParentDepthArgs {
  childThreadId?: string;
  parentThread: ParentThread;
}

interface ResolveThreadSubtreeDepthArgs {
  threadId: string;
  visitedThreadIds: Set<string>;
}

function toParentThread(thread: Thread): ParentThread {
  return thread;
}

export function isLiveParentThread(args: IsLiveParentThreadArgs): boolean {
  return (
    args.parentThread !== null &&
    args.parentThread.projectId === args.projectId &&
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

    const nextParentThread = getThread(deps.db, parentThread.parentThreadId);
    parentThread = nextParentThread ? toParentThread(nextParentThread) : null;
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

export interface CanThreadSpawnChildArgs {
  thread: ParentThread;
}

/**
 * True when a fork/side-chat may be created under this thread, i.e. its current
 * hierarchy depth is below MAX_THREAD_HIERARCHY_DEPTH so a new child would not
 * exceed the cap. Server-derived policy so clients never recompute the cap.
 */
export function canThreadSpawnChild(
  deps: Pick<AppDeps, "db">,
  args: CanThreadSpawnChildArgs,
): boolean {
  const depth = resolveParentDepth(deps, {
    parentThread: args.thread,
  });
  return depth < MAX_THREAD_HIERARCHY_DEPTH;
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

  if (liveParentThread.projectId !== args.projectId) {
    throwParentThreadInvalid("wrong_project");
  }
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
