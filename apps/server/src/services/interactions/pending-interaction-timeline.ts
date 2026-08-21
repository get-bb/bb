import { assertNever } from "@bb/core-ui";
import type {
  ApprovalPendingInteractionResolution,
  PendingInteraction,
  ProviderPendingInteraction,
  PendingInteractionApprovalSubject,
  PendingInteractionPermissionGrantApprovalSubject,
  ThreadEventItemApprovalStatus,
  ThreadEventItem,
  UserQuestionPendingInteractionResolution,
} from "@bb/domain";
import {
  isApprovalPendingInteractionPayload,
  isApprovalPendingInteractionResolution,
  isUserQuestionPendingInteractionPayload,
  isUserQuestionPendingInteractionResolution,
  turnScope,
  threadScope,
  isPluginPendingInteraction,
} from "@bb/domain";
import { getThread, type DbNotifier, type DbTransaction } from "@bb/db";
import type { AppDeps } from "../../types.js";
import {
  appendThreadEvent,
  appendThreadEventInTransaction,
} from "../threads/thread-events.js";

interface PendingInteractionTimelineTransactionDeps {
  db: DbTransaction;
  hub: DbNotifier;
}

type ApprovalTimelineItem = Extract<
  ThreadEventItem,
  { type: "commandExecution" | "fileChange" }
>;
/**
 * Subjects that own a timeline item of their own. Permission grants get a
 * lifecycle event instead, and plan reviews reuse the provider's ExitPlanMode
 * tool-call item, so neither belongs here.
 */
type ApprovalTimelineItemSubject = Exclude<
  PendingInteractionApprovalSubject,
  { kind: "permission_grant" } | { kind: "plan" } | { kind: "tool_use" }
>;
type ApprovalTimelineItemStatus = Extract<
  ApprovalTimelineItem["status"],
  "pending" | "interrupted"
>;

function getApprovalResolution(
  interaction: ProviderPendingInteraction,
): ApprovalPendingInteractionResolution | null {
  if (interaction.resolution === null) {
    return null;
  }
  if (isApprovalPendingInteractionResolution(interaction.resolution)) {
    return interaction.resolution;
  }
  throw new Error(
    `Interaction ${interaction.id} has a user-answer resolution on an approval timeline event`,
  );
}

function getUserQuestionResolution(
  interaction: ProviderPendingInteraction,
): UserQuestionPendingInteractionResolution | null {
  if (interaction.resolution === null) {
    return null;
  }
  if (isUserQuestionPendingInteractionResolution(interaction.resolution)) {
    return interaction.resolution;
  }
  throw new Error(
    `Interaction ${interaction.id} has an approval resolution on a user-question timeline event`,
  );
}

function appendPermissionGrantTimelineEvent(
  deps: Pick<AppDeps, "db" | "hub">,
  interaction: ProviderPendingInteraction,
  subject: PendingInteractionPermissionGrantApprovalSubject,
): void {
  const thread = getThread(deps.db, interaction.threadId);
  appendThreadEvent(deps, {
    threadId: interaction.threadId,
    environmentId: thread?.environmentId ?? null,
    type: "system/permissionGrant/lifecycle",
    scope: turnScope(interaction.turnId),
    data: {
      status: interaction.status,
      resolution: getApprovalResolution(interaction),
      interactionId: interaction.id,
      providerId: interaction.providerId,
      providerRequestId: interaction.providerRequestId,
      statusReason: interaction.statusReason,
      subject,
    },
  });
}

function appendPermissionGrantTimelineEventInTransaction(
  deps: PendingInteractionTimelineTransactionDeps,
  interaction: ProviderPendingInteraction,
  subject: PendingInteractionPermissionGrantApprovalSubject,
): void {
  const thread = getThread(deps.db, interaction.threadId);
  appendThreadEventInTransaction(deps.db, {
    threadId: interaction.threadId,
    environmentId: thread?.environmentId ?? null,
    type: "system/permissionGrant/lifecycle",
    scope: turnScope(interaction.turnId),
    data: {
      status: interaction.status,
      resolution: getApprovalResolution(interaction),
      interactionId: interaction.id,
      providerId: interaction.providerId,
      providerRequestId: interaction.providerRequestId,
      statusReason: interaction.statusReason,
      subject,
    },
  });
  deps.hub.notifyThread(interaction.threadId, ["events-appended"], {
    eventTypes: ["system/permissionGrant/lifecycle"],
  });
}

function appendUserQuestionTimelineEvent(
  deps: Pick<AppDeps, "db" | "hub">,
  interaction: ProviderPendingInteraction,
): void {
  if (!isUserQuestionPendingInteractionPayload(interaction.payload)) {
    return;
  }
  const thread = getThread(deps.db, interaction.threadId);
  appendThreadEvent(deps, {
    threadId: interaction.threadId,
    environmentId: thread?.environmentId ?? null,
    type: "system/userQuestion/lifecycle",
    scope: turnScope(interaction.turnId),
    data: {
      status: interaction.status,
      resolution: getUserQuestionResolution(interaction),
      interactionId: interaction.id,
      providerId: interaction.providerId,
      providerRequestId: interaction.providerRequestId,
      statusReason: interaction.statusReason,
      payload: interaction.payload,
    },
  });
}

function appendUserQuestionTimelineEventInTransaction(
  deps: PendingInteractionTimelineTransactionDeps,
  interaction: ProviderPendingInteraction,
): void {
  if (!isUserQuestionPendingInteractionPayload(interaction.payload)) {
    return;
  }
  const thread = getThread(deps.db, interaction.threadId);
  appendThreadEventInTransaction(deps.db, {
    threadId: interaction.threadId,
    environmentId: thread?.environmentId ?? null,
    type: "system/userQuestion/lifecycle",
    scope: turnScope(interaction.turnId),
    data: {
      status: interaction.status,
      resolution: getUserQuestionResolution(interaction),
      interactionId: interaction.id,
      providerId: interaction.providerId,
      providerRequestId: interaction.providerRequestId,
      statusReason: interaction.statusReason,
      payload: interaction.payload,
    },
  });
  deps.hub.notifyThread(interaction.threadId, ["events-appended"]);
}

function appendApprovalItemEvent(
  deps: Pick<AppDeps, "db" | "hub">,
  interaction: ProviderPendingInteraction,
  item: ApprovalTimelineItem,
): void {
  const thread = getThread(deps.db, interaction.threadId);
  appendThreadEvent(deps, {
    threadId: interaction.threadId,
    environmentId: thread?.environmentId ?? null,
    type: item.status === "pending" ? "item/started" : "item/completed",
    providerThreadId: interaction.providerThreadId,
    scope: turnScope(interaction.turnId),
    data: {
      providerThreadId: interaction.providerThreadId,
      item,
    },
  });
}

function appendApprovalItemEventInTransaction(
  deps: PendingInteractionTimelineTransactionDeps,
  interaction: ProviderPendingInteraction,
  item: ApprovalTimelineItem,
): void {
  const thread = getThread(deps.db, interaction.threadId);
  appendThreadEventInTransaction(deps.db, {
    threadId: interaction.threadId,
    environmentId: thread?.environmentId ?? null,
    type: item.status === "pending" ? "item/started" : "item/completed",
    providerThreadId: interaction.providerThreadId,
    scope: turnScope(interaction.turnId),
    data: {
      providerThreadId: interaction.providerThreadId,
      item,
    },
  });
  deps.hub.notifyThread(interaction.threadId, ["events-appended"], {
    eventTypes: [item.status === "pending" ? "item/started" : "item/completed"],
  });
}

function appendApprovalSubjectItemEvent(
  deps: Pick<AppDeps, "db" | "hub">,
  interaction: ProviderPendingInteraction,
  subject: ApprovalTimelineItemSubject,
  status: ApprovalTimelineItemStatus,
  approvalStatus: ThreadEventItemApprovalStatus,
): void {
  switch (subject.kind) {
    case "command":
      appendApprovalItemEvent(deps, interaction, {
        type: "commandExecution",
        id: subject.itemId,
        command: subject.command,
        cwd: subject.cwd ?? "",
        status,
        approvalStatus,
      });
      return;
    case "file_change":
      appendApprovalItemEvent(deps, interaction, {
        type: "fileChange",
        id: subject.itemId,
        changes: [],
        status,
        approvalStatus,
      });
      return;
    default:
      return assertNever(
        subject,
        "Unsupported approval subject for timeline item",
      );
  }
}

function appendApprovalSubjectItemEventInTransaction(
  deps: PendingInteractionTimelineTransactionDeps,
  interaction: ProviderPendingInteraction,
  subject: ApprovalTimelineItemSubject,
  status: ApprovalTimelineItemStatus,
  approvalStatus: ThreadEventItemApprovalStatus,
): void {
  switch (subject.kind) {
    case "command":
      appendApprovalItemEventInTransaction(deps, interaction, {
        type: "commandExecution",
        id: subject.itemId,
        command: subject.command,
        cwd: subject.cwd ?? "",
        status,
        approvalStatus,
      });
      return;
    case "file_change":
      appendApprovalItemEventInTransaction(deps, interaction, {
        type: "fileChange",
        id: subject.itemId,
        changes: [],
        status,
        approvalStatus,
      });
      return;
    default:
      return assertNever(
        subject,
        "Unsupported approval subject for timeline item",
      );
  }
}

function appendPermissionGrantLifecycleTimelineEvent(
  deps: Pick<AppDeps, "db" | "hub">,
  interaction: ProviderPendingInteraction,
  subject: PendingInteractionPermissionGrantApprovalSubject,
): void {
  switch (interaction.status) {
    case "pending":
    case "resolving":
    case "resolved":
    case "interrupted":
      appendPermissionGrantTimelineEvent(deps, interaction, subject);
      return;
  }
}

function appendPermissionGrantLifecycleTimelineEventInTransaction(
  deps: PendingInteractionTimelineTransactionDeps,
  interaction: ProviderPendingInteraction,
  subject: PendingInteractionPermissionGrantApprovalSubject,
): void {
  switch (interaction.status) {
    case "pending":
    case "resolving":
    case "resolved":
    case "interrupted":
      appendPermissionGrantTimelineEventInTransaction(
        deps,
        interaction,
        subject,
      );
      return;
  }
}

function appendItemLifecycleTimelineEvent(
  deps: Pick<AppDeps, "db" | "hub">,
  interaction: ProviderPendingInteraction,
  subject: ApprovalTimelineItemSubject,
): void {
  switch (interaction.status) {
    case "pending":
      appendApprovalSubjectItemEvent(
        deps,
        interaction,
        subject,
        "pending",
        "waiting_for_approval",
      );
      return;
    case "resolving":
      return;
    case "resolved":
      if (getApprovalResolution(interaction)?.decision === "deny") {
        appendApprovalSubjectItemEvent(
          deps,
          interaction,
          subject,
          "interrupted",
          "denied",
        );
      }
      return;
    case "interrupted":
      appendApprovalSubjectItemEvent(
        deps,
        interaction,
        subject,
        "interrupted",
        null,
      );
      return;
  }
}

function appendItemLifecycleTimelineEventInTransaction(
  deps: PendingInteractionTimelineTransactionDeps,
  interaction: ProviderPendingInteraction,
  subject: ApprovalTimelineItemSubject,
): void {
  switch (interaction.status) {
    case "pending":
      appendApprovalSubjectItemEventInTransaction(
        deps,
        interaction,
        subject,
        "pending",
        "waiting_for_approval",
      );
      return;
    case "resolving":
      return;
    case "resolved":
      if (getApprovalResolution(interaction)?.decision === "deny") {
        appendApprovalSubjectItemEventInTransaction(
          deps,
          interaction,
          subject,
          "interrupted",
          "denied",
        );
      }
      return;
    case "interrupted":
      appendApprovalSubjectItemEventInTransaction(
        deps,
        interaction,
        subject,
        "interrupted",
        null,
      );
      return;
  }
}

export function appendPendingInteractionTimelineEvent(
  deps: Pick<AppDeps, "db" | "hub">,
  interaction: PendingInteraction,
): void {
  if (isPluginPendingInteraction(interaction)) {
    const thread = getThread(deps.db, interaction.threadId);
    appendThreadEvent(deps, {
      threadId: interaction.threadId,
      environmentId: thread?.environmentId ?? null,
      type: "system/operation",
      scope: threadScope(),
      data: {
        operation: "plugin_interaction",
        status: interaction.status,
        message: "Plugin interaction lifecycle changed",
        operationId: interaction.id,
        metadata: {
          interactionId: interaction.id,
          pluginId: interaction.origin.pluginId,
          rendererId: interaction.origin.rendererId,
        },
      },
    });
    return;
  }
  if (!isApprovalPendingInteractionPayload(interaction.payload)) {
    appendUserQuestionTimelineEvent(deps, interaction);
    return;
  }
  const subject = interaction.payload.subject;
  switch (subject.kind) {
    case "permission_grant":
      appendPermissionGrantLifecycleTimelineEvent(deps, interaction, subject);
      return;
    case "command":
    case "file_change":
      appendItemLifecycleTimelineEvent(deps, interaction, subject);
      return;
    // The provider already streams the ExitPlanMode tool call as a timeline
    // item, and it carries the plan and the verdict. A second event would
    // duplicate it.
    case "plan":
      return;
    // A tool-use approval has no timeline item of its own: the provider's own
    // tool call (the ACP agent's tool_call with the same id) is the timeline
    // record, and the banner renders the subject's presentation. The single
    // interaction-lifecycle event it will ride is WS5's (interactions).
    case "tool_use":
      return;
    default:
      return assertNever(subject, "Unsupported approval subject for timeline");
  }
}

export function appendPendingInteractionTimelineEventInTransaction(
  deps: PendingInteractionTimelineTransactionDeps,
  interaction: PendingInteraction,
): void {
  if (isPluginPendingInteraction(interaction)) {
    const thread = getThread(deps.db, interaction.threadId);
    appendThreadEventInTransaction(deps.db, {
      threadId: interaction.threadId,
      environmentId: thread?.environmentId ?? null,
      type: "system/operation",
      scope: threadScope(),
      data: {
        operation: "plugin_interaction",
        status: interaction.status,
        message: "Plugin interaction lifecycle changed",
        operationId: interaction.id,
        metadata: {
          interactionId: interaction.id,
          pluginId: interaction.origin.pluginId,
          rendererId: interaction.origin.rendererId,
        },
      },
    });
    deps.hub.notifyThread(interaction.threadId, ["events-appended"], {
      eventTypes: ["system/operation"],
    });
    return;
  }
  if (!isApprovalPendingInteractionPayload(interaction.payload)) {
    appendUserQuestionTimelineEventInTransaction(deps, interaction);
    return;
  }
  const subject = interaction.payload.subject;
  switch (subject.kind) {
    case "permission_grant":
      appendPermissionGrantLifecycleTimelineEventInTransaction(
        deps,
        interaction,
        subject,
      );
      return;
    case "command":
    case "file_change":
      appendItemLifecycleTimelineEventInTransaction(deps, interaction, subject);
      return;
    // See appendPendingInteractionTimelineEvent: the ExitPlanMode tool call is
    // already the timeline record.
    case "plan":
      return;
    // See appendPendingInteractionTimelineEvent: the provider's own tool call
    // is the timeline record.
    case "tool_use":
      return;
    default:
      return assertNever(subject, "Unsupported approval subject for timeline");
  }
}
