import {
  archiveThread,
  getThread,
  listUnarchivedAssignedChildThreads,
  type DbNotifier,
  type DbTransaction,
  updateThread,
} from "@bb/db";
import type {
  PromptInput,
  ResolvedThreadExecutionOptions,
  Thread,
} from "@bb/domain";
import { renderTemplate } from "@bb/templates";
import { z } from "zod";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { NotificationBuffer } from "../lib/notification-buffer.js";
import { emitPluginThreadParentChanged } from "../plugins/plugin-thread-events.js";
import {
  postCoalescedSystemNotice,
  type CoalescedNotice,
} from "./coalesced-system-notices.js";
import {
  buildParentSystemInputFromTemplateSlot,
  buildParentSystemThreadMention,
  parentSystemThreadLabel,
  type ParentSystemInputSegment,
} from "./parent-system-messages.js";
import { requestQueuedMessageDispatchAt } from "./queued-message-dispatch.js";
import { systemMessageKindForTemplate } from "./system-message-kind.js";
import { buildExecutionOptions } from "./thread-commands.js";
import {
  appendThreadOwnershipChangeEvent,
  appendThreadOwnershipChangeEventInTransaction,
} from "./thread-events.js";

const threadOwnershipNoticeChildSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string().nullable(),
});
const threadOwnershipNoticeEntrySchema = z.discriminatedUnion("change", [
  z.object({
    change: z.literal("assigned"),
    childThread: threadOwnershipNoticeChildSchema,
    previousParentThreadId: z.string().nullable(),
  }),
  z.object({
    change: z.literal("removed"),
    childThread: threadOwnershipNoticeChildSchema,
  }),
]);
const threadOwnershipNoticeStateSchema = z.array(
  threadOwnershipNoticeEntrySchema,
);
type ThreadOwnershipNoticeEntry = z.infer<
  typeof threadOwnershipNoticeEntrySchema
>;
type ThreadOwnershipNoticeChild = z.infer<
  typeof threadOwnershipNoticeChildSchema
>;
type ThreadOwnershipChange = ThreadOwnershipNoticeEntry["change"];

type ThreadOwnershipTemplateId =
  | "systemMessageThreadOwnershipAssigned"
  | "systemMessageThreadOwnershipRemoved";

interface HandleThreadOwnershipChangeArgs {
  previousThread: Thread;
  updatedThread: Thread;
}

interface QueueThreadOwnershipNoticesArgs {
  childThread: Thread;
  nextParentThreadId: string | null;
  previousParentThreadId: string | null;
}

interface PostThreadOwnershipNoticeArgs {
  execution: ResolvedThreadExecutionOptions;
  parentThreadId: string;
  update: (
    entries: readonly ThreadOwnershipNoticeEntry[],
  ) => ThreadOwnershipNoticeEntry[];
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

const THREAD_OWNERSHIP_NOTICE_WINDOW_MS = 2_000;
const THREAD_OWNERSHIP_NOTICE_COALESCE_KEY = "thread-ownership";
const THREAD_OWNERSHIP_MENTION_SLOT = "__BB_THREAD_OWNERSHIP_MENTION__";
const THREAD_OWNERSHIP_BATCH_UPDATES_SLOT =
  "__BB_THREAD_OWNERSHIP_BATCH_UPDATES__";
const THREAD_OWNERSHIP_BATCH_HEADINGS: ReadonlyArray<{
  change: ThreadOwnershipChange;
  heading: string;
}> = [
  {
    change: "assigned",
    heading: "These threads are now children of this thread:",
  },
  {
    change: "removed",
    heading: "These threads are no longer children of this thread:",
  },
];

function ownershipTemplateId(
  change: ThreadOwnershipChange,
): ThreadOwnershipTemplateId {
  return change === "assigned"
    ? "systemMessageThreadOwnershipAssigned"
    : "systemMessageThreadOwnershipRemoved";
}

function buildThreadOwnershipSystemInput(
  templateId: ThreadOwnershipTemplateId,
  thread: ThreadOwnershipNoticeChild,
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

function buildThreadOwnershipBatchInput(
  entries: readonly ThreadOwnershipNoticeEntry[],
): PromptInput[] {
  const segments: ParentSystemInputSegment[] = [];
  for (const { change, heading } of THREAD_OWNERSHIP_BATCH_HEADINGS) {
    const group = entries.filter((entry) => entry.change === change);
    if (group.length === 0) continue;
    segments.push({
      kind: "text",
      text: `${segments.length === 0 ? "" : "\n\n"}${heading}\n`,
    });
    for (const entry of group) {
      segments.push({ kind: "text", text: "\n- " });
      segments.push({
        kind: "mention",
        mention: buildParentSystemThreadMention({ thread: entry.childThread }),
      });
    }
  }
  return buildParentSystemInputFromTemplateSlot({
    renderedText: renderTemplate("systemMessageThreadOwnershipBatch", {
      updates: THREAD_OWNERSHIP_BATCH_UPDATES_SLOT,
    }),
    slot: THREAD_OWNERSHIP_BATCH_UPDATES_SLOT,
    segments,
  });
}

function buildThreadOwnershipNotice(
  entries: ThreadOwnershipNoticeEntry[],
): CoalescedNotice<ThreadOwnershipNoticeEntry[]> | null {
  const [single, ...rest] = entries;
  if (!single) return null;
  if (rest.length === 0) {
    const templateId = ownershipTemplateId(single.change);
    return {
      input: buildThreadOwnershipSystemInput(templateId, single.childThread),
      notice: {
        kind: systemMessageKindForTemplate(templateId),
        subject: {
          kind: "thread",
          threadId: single.childThread.id,
          threadName: parentSystemThreadLabel(single.childThread),
        },
      },
      state: entries,
    };
  }
  return {
    input: buildThreadOwnershipBatchInput(entries),
    notice: {
      kind: "ownership-batch",
      subject: { kind: "thread-batch", count: entries.length },
    },
    state: entries,
  };
}

function withoutChild(
  entries: readonly ThreadOwnershipNoticeEntry[],
  childThreadId: string,
): ThreadOwnershipNoticeEntry[] {
  return entries.filter((entry) => entry.childThread.id !== childThreadId);
}

function findChildEntry(
  entries: readonly ThreadOwnershipNoticeEntry[],
  childThreadId: string,
): ThreadOwnershipNoticeEntry | undefined {
  return entries.find((entry) => entry.childThread.id === childThreadId);
}

function postThreadOwnershipNotice(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: PostThreadOwnershipNoticeArgs,
): void {
  const row = postCoalescedSystemNotice<ThreadOwnershipNoticeEntry[]>(deps, {
    coalesceKey: THREAD_OWNERSHIP_NOTICE_COALESCE_KEY,
    execution: args.execution,
    merge: (previous) =>
      buildThreadOwnershipNotice(args.update(previous ?? [])),
    parseState: (stored) =>
      threadOwnershipNoticeStateSchema.parse(JSON.parse(stored)),
    threadId: args.parentThreadId,
    windowMs: THREAD_OWNERSHIP_NOTICE_WINDOW_MS,
  });
  if (row !== null && row.state === "scheduled" && row.sendAt !== null) {
    requestQueuedMessageDispatchAt(deps, row.sendAt);
  }
}

function getWritableParent(
  deps: LoggedPendingInteractionWorkSessionDeps,
  parentThreadId: string | null,
): Thread | null {
  if (parentThreadId === null) return null;
  const parent = getThread(deps.db, parentThreadId);
  return parent && parent.archivedAt === null && parent.deletedAt === null
    ? parent
    : null;
}

async function buildParentExecution(
  deps: LoggedPendingInteractionWorkSessionDeps,
  parent: Thread | null,
): Promise<ResolvedThreadExecutionOptions | null> {
  if (parent === null) return null;
  return buildExecutionOptions(deps, {}, { threadId: parent.id });
}

async function queueThreadOwnershipNotices(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: QueueThreadOwnershipNoticesArgs,
): Promise<void> {
  const previousParent = getWritableParent(deps, args.previousParentThreadId);
  const nextParent = getWritableParent(deps, args.nextParentThreadId);
  const [previousExecution, nextExecution] = await Promise.all([
    buildParentExecution(deps, previousParent),
    buildParentExecution(deps, nextParent),
  ]);
  const childThreadId = args.childThread.id;
  const childThread: ThreadOwnershipNoticeChild = {
    id: childThreadId,
    projectId: args.childThread.projectId,
    title: args.childThread.title,
  };
  const notifiesRemoval = args.childThread.parentNotifications === "auto";
  let baselineParentThreadId = args.previousParentThreadId;

  if (previousParent !== null && previousExecution !== null) {
    postThreadOwnershipNotice(deps, {
      execution: previousExecution,
      parentThreadId: previousParent.id,
      update: (entries) => {
        const pending = findChildEntry(entries, childThreadId);
        if (pending?.change === "assigned") {
          baselineParentThreadId = pending.previousParentThreadId;
          return withoutChild(entries, childThreadId);
        }
        if (!notifiesRemoval) return [...entries];
        return [
          ...withoutChild(entries, childThreadId),
          { change: "removed", childThread },
        ];
      },
    });
  }

  if (nextParent !== null && nextExecution !== null) {
    postThreadOwnershipNotice(deps, {
      execution: nextExecution,
      parentThreadId: nextParent.id,
      update: (entries) => {
        const pending = findChildEntry(entries, childThreadId);
        if (pending?.change === "removed") {
          return withoutChild(entries, childThreadId);
        }
        if (nextParent.id === baselineParentThreadId && !notifiesRemoval) {
          return [...entries];
        }
        return [
          ...withoutChild(entries, childThreadId),
          {
            change: "assigned",
            childThread,
            previousParentThreadId: baselineParentThreadId,
          },
        ];
      },
    });
  }
}

export async function handleThreadOwnershipChange(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: HandleThreadOwnershipChangeArgs,
): Promise<void> {
  const previousParentThreadId = args.previousThread.parentThreadId;
  const nextParentThreadId = args.updatedThread.parentThreadId;
  if (nextParentThreadId === previousParentThreadId) {
    return;
  }

  appendThreadOwnershipChangeEvent(deps, {
    threadId: args.updatedThread.id,
    environmentId: args.updatedThread.environmentId,
    previousParentThreadId,
    nextParentThreadId,
  });
  emitPluginThreadParentChanged(args.updatedThread, previousParentThreadId);

  try {
    await queueThreadOwnershipNotices(deps, {
      childThread: args.updatedThread,
      nextParentThreadId,
      previousParentThreadId,
    });
  } catch (error) {
    deps.logger.error(
      {
        childThreadId: args.updatedThread.id,
        nextParentThreadId,
        previousParentThreadId,
        err: error,
      },
      "Failed to queue parent ownership system messages",
    );
  }
}

function releaseUnarchivedChildrenFromArchivedThreadInTransaction(
  deps: ThreadOwnershipTransactionDeps,
  args: ReleaseUnarchivedChildrenFromArchivedThreadArgs,
): Thread[] {
  const childThreads = listUnarchivedAssignedChildThreads(deps.db, {
    parentThreadId: args.parentThreadId,
  });
  const released: Thread[] = [];

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
    released.push(updatedThread);
  }
  return released;
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

      const released = releaseUnarchivedChildrenFromArchivedThreadInTransaction(
        {
          db: tx,
          hub: notificationBuffer,
        },
        {
          parentThreadId: archivedThread.id,
          sectionId: archivedThread.sectionId,
        },
      );

      return { archivedThread, released };
    },
    { behavior: "immediate" },
  );

  notificationBuffer.flushInto(deps.hub);
  if (result === null) return null;
  for (const thread of result.released) {
    emitPluginThreadParentChanged(thread, result.archivedThread.id);
  }
  return result.archivedThread;
}
