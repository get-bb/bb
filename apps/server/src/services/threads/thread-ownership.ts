import {
  archiveThread,
  getThread,
  listUnarchivedAssignedChildThreads,
  type DbNotifier,
  type DbTransaction,
  updateThread,
} from "@bb/db";
import type { PromptInput, SystemMessageSubject, Thread } from "@bb/domain";
import { renderTemplate } from "@bb/templates";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { NotificationBuffer } from "../lib/notification-buffer.js";
import {
  buildParentSystemInputFromTemplateSlot,
  buildParentSystemThreadMention,
  parentSystemThreadLabel,
  queueParentSystemMessage,
} from "./parent-system-messages.js";
import { systemMessageKindForTemplate } from "./system-message-kind.js";
import {
  appendThreadOwnershipChangeEvent,
  appendThreadOwnershipChangeEventInTransaction,
} from "./thread-events.js";

interface ThreadLabelSource {
  id: string;
  projectId: string;
  title: string | null;
}

type ThreadOwnershipTemplateId =
  | "systemMessageThreadOwnershipAssigned"
  | "systemMessageThreadOwnershipRemoved";

interface QueueParentSystemMessageBestEffortArgs {
  childThreadId: string;
  input: PromptInput[];
  parentThreadId: string;
  reason: "assigned" | "removed";
  templateId: ThreadOwnershipTemplateId;
  threadName: string;
}

interface HandleThreadOwnershipChangeArgs {
  previousThread: Thread;
  updatedThread: Thread;
}

interface ReleaseUnarchivedChildrenFromArchivedThreadArgs {
  parentThreadId: string;
  sectionId: string | null;
}

interface ArchiveThreadAndReleaseChildrenArgs {
  threadId: string;
}

interface ThreadOwnershipTransactionDeps {
  db: DbTransaction;
  hub: DbNotifier;
}

interface PendingOwnershipChange {
  previousParentThreadId: string | null;
  timer: ReturnType<typeof setTimeout>;
}

const pendingOwnershipChanges = new WeakMap<
  LoggedPendingInteractionWorkSessionDeps["db"],
  Map<string, PendingOwnershipChange>
>();
const THREAD_OWNERSHIP_NOTICE_DELAY_MS = 2_000;

const THREAD_OWNERSHIP_MENTION_SLOT = "__BB_THREAD_OWNERSHIP_MENTION__";

async function queueParentSystemMessageBestEffort(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: QueueParentSystemMessageBestEffortArgs,
): Promise<void> {
  try {
    const subject: SystemMessageSubject = {
      kind: "thread",
      threadId: args.childThreadId,
      threadName: args.threadName,
    };
    await queueParentSystemMessage(deps, {
      input: args.input,
      parentThreadId: args.parentThreadId,
      systemMessageKind: systemMessageKindForTemplate(args.templateId),
      systemMessageSubject: subject,
    });
  } catch (error) {
    deps.logger.error(
      {
        childThreadId: args.childThreadId,
        parentThreadId: args.parentThreadId,
        reason: args.reason,
        err: error,
      },
      "Failed to queue parent ownership system message",
    );
  }
}

function buildThreadOwnershipSystemInput(
  templateId: ThreadOwnershipTemplateId,
  thread: ThreadLabelSource,
): PromptInput[] {
  const mention = buildParentSystemThreadMention({ thread });
  const renderedText = renderTemplate(templateId, {
    threadMention: THREAD_OWNERSHIP_MENTION_SLOT,
  });
  return buildParentSystemInputFromTemplateSlot({
    renderedText,
    slot: THREAD_OWNERSHIP_MENTION_SLOT,
    segments: [{ kind: "mention", mention }],
  });
}

export async function handleThreadOwnershipChange(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: HandleThreadOwnershipChangeArgs,
): Promise<void> {
  if (
    args.updatedThread.parentThreadId === args.previousThread.parentThreadId
  ) {
    return;
  }

  appendThreadOwnershipChangeEvent(deps, {
    threadId: args.updatedThread.id,
    environmentId: args.updatedThread.environmentId,
    previousParentThreadId: args.previousThread.parentThreadId,
    nextParentThreadId: args.updatedThread.parentThreadId,
  });

  let pendingChanges = pendingOwnershipChanges.get(deps.db);
  if (!pendingChanges) {
    pendingChanges = new Map();
    pendingOwnershipChanges.set(deps.db, pendingChanges);
  }
  const childThreadId = args.updatedThread.id;
  const pending = pendingChanges.get(childThreadId);
  if (pending) {
    clearTimeout(pending.timer);
  }
  const previousParentThreadId = pending
    ? pending.previousParentThreadId
    : args.previousThread.parentThreadId;
  const timer = setTimeout(() => {
    pendingChanges.delete(childThreadId);
    void sendThreadOwnershipNotices(
      deps,
      childThreadId,
      previousParentThreadId,
    ).catch((error) => {
      deps.logger.error(
        { childThreadId, err: error },
        "Failed to send delayed ownership system messages",
      );
    });
  }, THREAD_OWNERSHIP_NOTICE_DELAY_MS);
  timer.unref();
  pendingChanges.set(childThreadId, { previousParentThreadId, timer });
}

async function sendThreadOwnershipNotices(
  deps: LoggedPendingInteractionWorkSessionDeps,
  childThreadId: string,
  previousParentThreadId: string | null,
): Promise<void> {
  const thread = getThread(deps.db, childThreadId);
  if (
    !thread ||
    thread.deletedAt !== null ||
    thread.archivedAt !== null ||
    thread.parentThreadId === previousParentThreadId
  ) {
    return;
  }

  if (thread.parentThreadId) {
    await queueParentSystemMessageBestEffort(deps, {
      childThreadId: thread.id,
      parentThreadId: thread.parentThreadId,
      input: buildThreadOwnershipSystemInput(
        "systemMessageThreadOwnershipAssigned",
        thread,
      ),
      reason: "assigned",
      templateId: "systemMessageThreadOwnershipAssigned",
      threadName: parentSystemThreadLabel(thread),
    });
  }
  if (previousParentThreadId) {
    await queueParentSystemMessageBestEffort(deps, {
      childThreadId: thread.id,
      parentThreadId: previousParentThreadId,
      input: buildThreadOwnershipSystemInput(
        "systemMessageThreadOwnershipRemoved",
        thread,
      ),
      reason: "removed",
      templateId: "systemMessageThreadOwnershipRemoved",
      threadName: parentSystemThreadLabel(thread),
    });
  }
}

function releaseUnarchivedChildrenFromArchivedThreadInTransaction(
  deps: ThreadOwnershipTransactionDeps,
  args: ReleaseUnarchivedChildrenFromArchivedThreadArgs,
): void {
  const childThreads = listUnarchivedAssignedChildThreads(deps.db, {
    parentThreadId: args.parentThreadId,
  });

  for (const childThread of childThreads) {
    const updatedThread = updateThread(deps.db, deps.hub, childThread.id, {
      parentThreadId: null,
      sectionId: args.sectionId,
    });
    if (!updatedThread) {
      continue;
    }
    appendThreadOwnershipChangeEventInTransaction(deps, {
      threadId: updatedThread.id,
      environmentId: updatedThread.environmentId,
      previousParentThreadId: childThread.parentThreadId,
      nextParentThreadId: updatedThread.parentThreadId,
    });
  }
}

export function archiveThreadAndReleaseChildren(
  deps: Pick<LoggedPendingInteractionWorkSessionDeps, "db" | "hub">,
  args: ArchiveThreadAndReleaseChildrenArgs,
): Thread | null {
  const notificationBuffer = new NotificationBuffer();
  const result = deps.db.transaction(
    (tx) => {
      const archivedThread = archiveThread(
        tx,
        notificationBuffer,
        args.threadId,
      );
      if (!archivedThread) {
        return null;
      }

      releaseUnarchivedChildrenFromArchivedThreadInTransaction(
        {
          db: tx,
          hub: notificationBuffer,
        },
        {
          parentThreadId: archivedThread.id,
          sectionId: archivedThread.sectionId,
        },
      );

      return archivedThread;
    },
    { behavior: "immediate" },
  );

  notificationBuffer.flushInto(deps.hub);
  return result;
}
