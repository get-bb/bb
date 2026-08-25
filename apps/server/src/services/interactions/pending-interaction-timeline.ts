import { assertNever } from "@bb/core-ui";
import type {
  ApprovalPendingInteraction,
  PendingInteraction,
  PendingInteractionApprovalSubject,
  ThreadEventItemApprovalStatus,
  ThreadEventItem,
  ThreadEventScope,
} from "@bb/domain";
import {
  isApprovalPendingInteraction,
  toInteractionLifecycle,
  turnScope,
  threadScope,
} from "@bb/domain";
import {
  getThread,
  type AppendStoredThreadEventArgs,
  type DbNotifier,
  type DbTransaction,
} from "@bb/db";
import type { AppDeps } from "../../types.js";
import {
  appendThreadEvent,
  appendThreadEventInTransaction,
} from "../threads/thread-events.js";

/**
 * The timeline record of an interaction (docs/provider-plugin-api.md §4).
 *
 * Every status change of every interaction — any approval subject, a user
 * question, a plugin request — appends one `system/interaction/lifecycle`
 * event carrying the interaction's lifecycle record, with the payload and
 * the resolution paired by kind. The projection decides what to show: a
 * permission grant and a user question get a row of their own; a command or
 * file-change approval shows on the provider's own item, a plan review on
 * the provider's plan tool call, a tool use on the provider's tool call, and
 * a plugin request on the plugin's form.
 *
 * A command or file-change approval additionally writes the provider's item
 * with its approval status (`waiting_for_approval`, `denied`) so the item's
 * row reflects the ask while the provider has not yet streamed the item or
 * never will after a denial. Folding that status into the lifecycle event at
 * read time is the projection change that deletes these item writes.
 */

interface PendingInteractionTimelineTransactionDeps {
  db: DbTransaction;
  hub: DbNotifier;
}

const INTERACTION_LIFECYCLE_EVENT_TYPE =
  "system/interaction/lifecycle" as const;

type ApprovalTimelineItem = Extract<
  ThreadEventItem,
  { type: "commandExecution" | "fileChange" }
>;
/** The approval subjects whose item carries the approval status. */
type ApprovalTimelineItemSubject = Extract<
  PendingInteractionApprovalSubject,
  { kind: "command" | "file_change" }
>;
type ApprovalTimelineItemStatus = Extract<
  ApprovalTimelineItem["status"],
  "pending" | "interrupted"
>;

function interactionScope(interaction: PendingInteraction): ThreadEventScope {
  return interaction.turnId === null
    ? threadScope()
    : turnScope(interaction.turnId);
}

function buildApprovalItem(
  subject: ApprovalTimelineItemSubject,
  status: ApprovalTimelineItemStatus,
  approvalStatus: ThreadEventItemApprovalStatus,
): ApprovalTimelineItem {
  switch (subject.kind) {
    case "command":
      return {
        type: "commandExecution",
        id: subject.itemId,
        command: subject.command,
        cwd: subject.cwd ?? "",
        status,
        approvalStatus,
      };
    case "file_change":
      return {
        type: "fileChange",
        id: subject.itemId,
        changes: [],
        status,
        approvalStatus,
      };
    default:
      return assertNever(
        subject,
        "Unsupported approval subject for timeline item",
      );
  }
}

/**
 * The item write a command or file-change approval makes at this status, or
 * null when the status leaves the item alone: `resolving` is transient, and
 * an allowed item is the provider's to stream.
 */
function approvalItemWrite(
  interaction: ApprovalPendingInteraction,
  subject: ApprovalTimelineItemSubject,
): ApprovalTimelineItem | null {
  switch (interaction.status) {
    case "pending":
      return buildApprovalItem(subject, "pending", "waiting_for_approval");
    case "resolving":
      return null;
    case "resolved":
      return interaction.resolution?.decision === "deny"
        ? buildApprovalItem(subject, "interrupted", "denied")
        : null;
    case "interrupted":
      return buildApprovalItem(subject, "interrupted", null);
    default:
      return assertNever(interaction.status);
  }
}

function approvalItemSubject(
  interaction: ApprovalPendingInteraction,
): ApprovalTimelineItemSubject | null {
  const subject = interaction.payload.subject;
  switch (subject.kind) {
    case "command":
    case "file_change":
      return subject;
    case "permission_grant":
    case "plan":
    case "tool_use":
      return null;
    default:
      return assertNever(subject, "Unsupported approval subject for timeline");
  }
}

function approvalItemWriteFor(interaction: PendingInteraction): {
  interaction: ApprovalPendingInteraction;
  item: ApprovalTimelineItem;
} | null {
  if (!isApprovalPendingInteraction(interaction)) {
    return null;
  }
  const subject = approvalItemSubject(interaction);
  if (subject === null) {
    return null;
  }
  const item = approvalItemWrite(interaction, subject);
  return item === null ? null : { interaction, item };
}

/**
 * The events one status change appends, in order: the lifecycle record, then
 * the provider's item when the status touches it. One thread read serves
 * both: appending the first never changes the thread's environment.
 */
function buildPendingInteractionTimelineWrites(
  db: Pick<AppDeps, "db">["db"] | DbTransaction,
  interaction: PendingInteraction,
): AppendStoredThreadEventArgs[] {
  const environmentId =
    getThread(db, interaction.threadId)?.environmentId ?? null;
  const writes: AppendStoredThreadEventArgs[] = [
    {
      threadId: interaction.threadId,
      environmentId,
      type: INTERACTION_LIFECYCLE_EVENT_TYPE,
      scope: interactionScope(interaction),
      data: { interaction: toInteractionLifecycle(interaction) },
    },
  ];
  const write = approvalItemWriteFor(interaction);
  if (write !== null) {
    const { providerThreadId, turnId } = write.interaction;
    writes.push({
      threadId: interaction.threadId,
      environmentId,
      type: write.item.status === "pending" ? "item/started" : "item/completed",
      providerThreadId,
      scope: turnScope(turnId),
      data: { providerThreadId, item: write.item },
    });
  }
  return writes;
}

export function appendPendingInteractionTimelineEvent(
  deps: Pick<AppDeps, "db" | "hub">,
  interaction: PendingInteraction,
): void {
  for (const write of buildPendingInteractionTimelineWrites(
    deps.db,
    interaction,
  )) {
    appendThreadEvent(deps, write);
  }
}

export function appendPendingInteractionTimelineEventInTransaction(
  deps: PendingInteractionTimelineTransactionDeps,
  interaction: PendingInteraction,
): void {
  const writes = buildPendingInteractionTimelineWrites(deps.db, interaction);
  for (const write of writes) {
    appendThreadEventInTransaction(deps.db, write);
  }
  deps.hub.notifyThread(interaction.threadId, ["events-appended"], {
    eventTypes: writes.map((write) => write.type),
  });
}
