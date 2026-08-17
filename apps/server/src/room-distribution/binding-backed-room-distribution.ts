import { createHash } from "node:crypto";

import {
  getActiveStoredTurnId,
  getEnvironment,
  getLatestThreadSequence,
  getThread,
  getWorkTogetherRoomResourceReservation,
  InvalidWorkTogetherRoomAssistantExcerptError,
  InvalidWorkTogetherRoomRootTurnOutcomeError,
  listLatestCompletedAgentMessageExcerptsByThreadIds,
  listLatestRootTurnTerminalOutcomesByThreadIds,
  listNonDeletedChildThreads,
  PendingInteractionThreadIdBoundError,
} from "@bb/db";
import {
  isApprovalPendingInteractionPayload,
  isUserQuestionPendingInteractionPayload,
  type ChangedMessage,
  type Principal,
  type ThreadChangeKind,
} from "@bb/domain";
import type { ThreadTimelineResponse } from "@bb/server-contract";
import { ApiError } from "../errors.js";
import { productionErrorLogFields } from "../services/lib/error-log-fields.js";
import type { AppDeps } from "../types.js";
import { buildThreadTimeline } from "../services/threads/timeline.js";
import { DEFAULT_MAX_INLINE_OUTPUT_CHARS } from "../services/threads/timeline-output-truncation.js";
import { isParentNotifiableChildThread } from "../services/threads/thread-parent.js";
import type {
  WorkTogetherRoomChildAttachmentPortV1,
  WorkTogetherRoomChildAttachmentV1,
} from "./work-together-room-child-attachments.js";
import {
  createBindingBackedRoomCommandHandler,
  parseRoomCommandStreamV2,
} from "./binding-backed-room-commands.js";
import type {
  WorkTogetherRoomCommandAuthorityPortV1,
  WorkTogetherRoomCommandAuthorityV1,
} from "./work-together-room-command-authority.js";
import {
  deriveWorkTogetherRoomSubagentAttentionV1,
  projectWorkTogetherRoomSubagentPublicContract,
  type RoomSubagentAttentionKindV1,
  type RoomSubagentPendingInteractionKindV1,
  type RoomSubagentV1,
  type WorkTogetherRoomSubagentPublicAttachmentInputV1,
  type WorkTogetherRoomSubagentPublicParentInputV1,
} from "./work-together-room-subagent-public-contract.js";
import {
  RoomDistributionUnavailableError,
  type RoomDistributionContextV1,
  type RoomDistributionOlderTimelineTargetV1,
  type RoomDistributionStreamTargetV1,
  type RoomDistributionSubscriptionV1,
  type RoomJsonObject,
  type RoomJsonValue,
  type WorkTogetherRoomDistributionV1,
} from "./room-distribution-port.js";
import { projectWorkTogetherRoomTimeline } from "./work-together-room-timeline-projection.js";

const CURSOR = /^s\.([0-9]|[1-9][0-9]{0,15})$/u;
/** Public older-page cursor: sequence only, never private anchor identity. */
const PUBLIC_OLDER_CURSOR = /^p\.([1-9][0-9]{0,15})$/u;
/**
 * Non-leaking placeholder for the private builder's required anchorId. The
 * builder pages by extant sequence even when anchor identity disagrees.
 */
const OLDER_PAGE_ANCHOR_PLACEHOLDER = "work-together-room-older-page";
const MAX_TASK_PROJECTION_BYTES = 131_072;
const INITIAL_TIMELINE_SEGMENTS = 20;
const MAX_ROOM_CHILDREN = 64;
const LIST_RELEVANT_SUBAGENT_CHANGE_KINDS = new Set<ThreadChangeKind>([
  "archived-changed",
  "interactions-changed",
  "parent-changed",
  "status-changed",
  "thread-deleted",
  "title-changed",
]);
const LIST_RELEVANT_COMPLETED_EVENT_TYPES = new Set([
  "item/completed",
  "turn/completed",
]);
const FORBIDDEN_TASK_IDENTITY_KEYS = new Set([
  "clerkid",
  "email",
  "membershiprevision",
  "principalid",
  "subject",
  "userid",
]);

export interface WorkTogetherRoomTaskProjectionPortV1 {
  read(input: {
    bindingId: string;
    workspaceId: string;
    taskId: string;
    principal: Principal;
  }): Promise<RoomJsonObject>;
}

function unavailable(kind: "not_found" | "unavailable" = "unavailable"): never {
  throw new RoomDistributionUnavailableError(kind);
}

function mapKnownProjectionQueryError(error: unknown): never {
  if (error instanceof RoomDistributionUnavailableError) throw error;
  if (
    error instanceof InvalidWorkTogetherRoomRootTurnOutcomeError ||
    error instanceof InvalidWorkTogetherRoomAssistantExcerptError ||
    error instanceof PendingInteractionThreadIdBoundError
  ) {
    unavailable();
  }
  throw error;
}

function copyPublicSubagents(
  subagents: readonly RoomSubagentV1[],
): RoomJsonObject[] {
  return subagents.map(
    (subagent): RoomJsonObject =>
      Object.freeze({
        ...subagent,
        capabilities: [...subagent.capabilities],
      }),
  );
}

function subagentListSignature(subagents: readonly RoomSubagentV1[]): string {
  return JSON.stringify(subagents);
}

function isObservedSubagentListRelevant(
  message: Extract<ChangedMessage, { entity: "thread" }>,
): boolean {
  for (const change of message.changes) {
    if (LIST_RELEVANT_SUBAGENT_CHANGE_KINDS.has(change)) return true;
  }
  if (!message.changes.includes("events-appended")) return false;
  const eventTypes = message.metadata?.eventTypes;
  if (eventTypes === undefined) return true;
  for (const eventType of eventTypes) {
    if (LIST_RELEVANT_COMPLETED_EVENT_TYPES.has(eventType)) return true;
  }
  return false;
}

function subagentParentInput(
  reservation: NonNullable<
    ReturnType<typeof getWorkTogetherRoomResourceReservation>
  >,
  attachment: WorkTogetherRoomChildAttachmentV1,
  attachmentsByChildThreadId: ReadonlyMap<
    string,
    WorkTogetherRoomChildAttachmentV1
  >,
): WorkTogetherRoomSubagentPublicParentInputV1 {
  if (attachment.parentThreadId === reservation.primaryThreadId) {
    return Object.freeze({ kind: "primary" });
  }
  const parentAttachment = attachmentsByChildThreadId.get(
    attachment.parentThreadId,
  );
  if (parentAttachment === undefined) unavailable();
  return Object.freeze({ kind: "subagent", id: parentAttachment.id });
}

function parseCursor(cursor: string | null): number | null {
  if (cursor === null) return null;
  const match = CURSOR.exec(cursor);
  if (!match) unavailable("not_found");
  const sequence = Number(match[1]);
  if (!Number.isSafeInteger(sequence)) unavailable("not_found");
  return sequence;
}

function cursorFor(sequence: number): string {
  return `s.${sequence}`;
}

function parsePublicOlderCursor(before: string): number {
  const match = PUBLIC_OLDER_CURSOR.exec(before);
  if (!match) unavailable("not_found");
  const sequence = Number(match[1]);
  if (!Number.isSafeInteger(sequence) || sequence < 1) unavailable("not_found");
  return sequence;
}

function publicOlderCursor(
  privateCursor: ThreadTimelineResponse["timelinePage"]["olderCursor"],
  hasOlder: boolean,
): string | null {
  if (!hasOlder) return null;
  if (
    privateCursor === null ||
    !Number.isSafeInteger(privateCursor.anchorSeq) ||
    privateCursor.anchorSeq < 1
  ) {
    unavailable();
  }
  return `p.${privateCursor.anchorSeq}`;
}

function collaborationState(presenceCount: number): RoomJsonObject {
  return Object.freeze({
    control: Object.freeze({ mode: "shared" }),
    presenceCount,
  });
}

function collaborationEvent(presenceCount: number): RoomJsonObject {
  return Object.freeze({
    type: "collaboration",
    collaboration: collaborationState(presenceCount),
  });
}

type PrimaryPresenceEntry = Readonly<{
  principalId: string;
  emit: (event: RoomJsonObject) => void;
}>;

/**
 * Process-local unique-principal presence for primary-room subscriptions only.
 * Advisory and ephemeral; not a controller lease and not durable.
 */
function createRoomPresenceRegistry() {
  const rooms = new Map<string, Map<object, PrimaryPresenceEntry>>();

  function uniqueCount(bindingId: string): number {
    const entries = rooms.get(bindingId);
    if (entries === undefined || entries.size === 0) return 0;
    const principals = new Set<string>();
    for (const entry of entries.values()) {
      principals.add(entry.principalId);
    }
    return principals.size;
  }

  function broadcast(bindingId: string): void {
    const entries = rooms.get(bindingId);
    if (entries === undefined || entries.size === 0) return;
    const event = collaborationEvent(uniqueCount(bindingId));
    for (const entry of entries.values()) {
      try {
        entry.emit(event);
      } catch {
        // Emit is best-effort; a closed socket must not block other peers.
      }
    }
  }

  return {
    count(bindingId: string): number {
      return uniqueCount(bindingId);
    },
    join(
      bindingId: string,
      principalId: string,
      emit: (event: RoomJsonObject) => void,
    ): { leave(): void } {
      let entries = rooms.get(bindingId);
      if (entries === undefined) {
        entries = new Map();
        rooms.set(bindingId, entries);
      }
      const token = Object.freeze({});
      entries.set(token, Object.freeze({ principalId, emit }));
      broadcast(bindingId);
      let left = false;
      return Object.freeze({
        leave() {
          if (left) return;
          left = true;
          const current = rooms.get(bindingId);
          if (current === undefined) return;
          if (!current.delete(token)) return;
          if (current.size === 0) {
            rooms.delete(bindingId);
            return;
          }
          broadcast(bindingId);
        },
      });
    },
  };
}

function participantId(bindingId: string, principalId: string): string {
  return `participant_${createHash("sha256")
    .update("work-together-room-participant-v1\0")
    .update(bindingId)
    .update("\0")
    .update(principalId)
    .digest("base64url")
    .slice(0, 22)}`;
}

type ProjectionScope = Readonly<{
  bindingId: string;
  threadId?: string;
  publicStreamId?: string;
  environmentId?: string;
  projectId?: string;
}>;

function projectString(value: string, scope: ProjectionScope): string {
  let projected = value;
  if (scope.threadId !== undefined) {
    projected = projected.replaceAll(
      scope.threadId,
      scope.publicStreamId ?? scope.bindingId,
    );
  }
  if (scope.environmentId !== undefined) {
    projected = projected.replaceAll(
      scope.environmentId,
      `${scope.bindingId}:environment`,
    );
  }
  if (scope.projectId !== undefined) {
    projected = projected.replaceAll(
      scope.projectId,
      `${scope.bindingId}:project`,
    );
  }
  return projected;
}

function projectValue(value: unknown, scope: ProjectionScope): RoomJsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    if (typeof value === "string") return projectString(value, scope);
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) unavailable();
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => projectValue(entry, scope));
  }
  if (typeof value !== "object") unavailable();

  const record = value as Record<string, unknown>;
  if (
    typeof record.principalId === "string" &&
    typeof record.principalKind === "string" &&
    typeof record.displayName === "string"
  ) {
    return {
      participantId: participantId(scope.bindingId, record.principalId),
      kind: record.principalKind,
      displayName: record.displayName,
    };
  }

  const projected: Record<string, RoomJsonValue> = {};
  for (const [childKey, childValue] of Object.entries(record)) {
    if (childKey === "senderThreadId") {
      projected[childKey] = null;
      continue;
    }
    projected[childKey] = projectValue(childValue, scope);
  }
  return projected;
}

function projectObject(value: unknown, scope: ProjectionScope): RoomJsonObject {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    unavailable();
  }
  let serializable: unknown;
  try {
    serializable = JSON.parse(serialized) as unknown;
  } catch {
    unavailable();
  }
  const projected = projectValue(serializable, scope);
  if (
    projected === null ||
    typeof projected !== "object" ||
    Array.isArray(projected)
  ) {
    unavailable();
  }
  return projected;
}

function validateTaskProjection(
  value: RoomJsonObject,
  bindingId: string,
): RoomJsonObject {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    unavailable();
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_TASK_PROJECTION_BYTES) {
    unavailable();
  }
  assertNoRawTaskIdentity(value);
  return projectObject(value, { bindingId });
}

function assertNoRawTaskIdentity(value: unknown, depth = 0): void {
  if (depth > 32) unavailable();
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const entry of value) assertNoRawTaskIdentity(entry, depth + 1);
    return;
  }
  const record = value as Record<string, unknown>;
  const isActorProjection =
    typeof record.principalId === "string" &&
    typeof record.principalKind === "string" &&
    typeof record.displayName === "string";
  for (const [key, child] of Object.entries(record)) {
    const token = key.toLowerCase().replaceAll(/[-_]/gu, "");
    if (FORBIDDEN_TASK_IDENTITY_KEYS.has(token) && !isActorProjection) {
      unavailable();
    }
    assertNoRawTaskIdentity(child, depth + 1);
  }
}

function primaryRun(status: string): string {
  switch (status) {
    case "idle":
      return "idle";
    case "starting":
      return "starting";
    case "active":
      return "active";
    case "stopping":
      return "stopping";
    case "error":
      return "failed";
    default:
      unavailable();
  }
}

/**
 * Binding-backed Room distribution. SQLite remains the sole execution/event
 * authority while the injected WT ports own canonical task and command policy.
 */
export function createBindingBackedRoomDistributionV1(
  deps: AppDeps,
  taskProjection: WorkTogetherRoomTaskProjectionPortV1,
  childAttachments: WorkTogetherRoomChildAttachmentPortV1,
  commandAuthority: WorkTogetherRoomCommandAuthorityPortV1,
): WorkTogetherRoomDistributionV1 {
  const commands = createBindingBackedRoomCommandHandler(
    deps,
    commandAuthority,
    taskProjection,
  );
  const presence = createRoomPresenceRegistry();

  function resolve(bindingId: string) {
    let reservation;
    try {
      reservation = getWorkTogetherRoomResourceReservation(deps.db, bindingId);
    } catch {
      unavailable("not_found");
    }
    if (reservation === null) unavailable("not_found");
    const thread = getThread(deps.db, reservation.primaryThreadId);
    const environment = getEnvironment(deps.db, reservation.environmentId);
    if (
      thread === null ||
      thread.deletedAt !== null ||
      thread.archivedAt !== null ||
      thread.projectId !== reservation.projectId ||
      thread.environmentId !== reservation.environmentId ||
      environment === null ||
      environment.projectId !== reservation.projectId ||
      environment.branchName !== reservation.generatedBranch ||
      environment.baseBranch !== reservation.baseBranch
    ) {
      unavailable();
    }
    return { reservation, thread, environment };
  }

  function buildTimelineOptions(
    thread: NonNullable<ReturnType<typeof getThread>>,
    maxSeq: number,
    page:
      | { kind: "latest"; segmentLimit: number }
      | {
          kind: "older";
          segmentLimit: number;
          beforeCursor: { anchorSeq: number; anchorId: string };
        },
  ) {
    return {
      eventBudget: deps.config.featureFlags.timelineWindowEventBudget,
      includeProviderUnhandledOperations: false,
      includeNestedRows: true,
      maxInlineOutputChars: DEFAULT_MAX_INLINE_OUTPUT_CHARS,
      maxSeq,
      page,
      providerDisplayName: "Agent",
      summaryOnly: false,
    } as const;
  }

  function withPublicTimelineMeta(
    projection: RoomJsonObject,
    response: ThreadTimelineResponse,
  ): RoomJsonObject {
    const hasOlder = response.timelinePage.hasOlderRows;
    return Object.freeze({
      ...projection,
      hasOlder,
      olderCursor: publicOlderCursor(
        response.timelinePage.olderCursor,
        hasOlder,
      ),
    });
  }

  function timeline(
    bindingId: string,
    thread: ReturnType<typeof getThread>,
    publicStreamId = bindingId,
  ) {
    if (thread === null) unavailable();
    const maxSeq = getLatestThreadSequence(deps.db, { threadId: thread.id });
    const response = buildThreadTimeline(
      deps.db,
      thread,
      buildTimelineOptions(thread, maxSeq, {
        kind: "latest",
        segmentLimit: INITIAL_TIMELINE_SEGMENTS,
      }),
    );
    const projected = projectWorkTogetherRoomTimeline({
      bindingId,
      privateThreadId: thread.id,
      publicStreamId,
      environmentId: thread.environmentId ?? unavailable(),
      projectId: thread.projectId,
      threadStatus: thread.status,
      privateActiveTurnId: getActiveStoredTurnId(deps.db, thread.id),
      timeline: response,
    });
    return {
      maxSeq,
      response,
      projection: withPublicTimelineMeta(projected, response),
    };
  }

  function olderTimeline(
    bindingId: string,
    thread: NonNullable<ReturnType<typeof getThread>>,
    beforeSequence: number,
    publicStreamId: string,
  ) {
    const maxSeq = getLatestThreadSequence(deps.db, { threadId: thread.id });
    if (beforeSequence > maxSeq) unavailable("not_found");
    let response: ThreadTimelineResponse;
    try {
      response = buildThreadTimeline(
        deps.db,
        thread,
        buildTimelineOptions(thread, maxSeq, {
          kind: "older",
          segmentLimit: INITIAL_TIMELINE_SEGMENTS,
          beforeCursor: {
            anchorSeq: beforeSequence,
            anchorId: OLDER_PAGE_ANCHOR_PLACEHOLDER,
          },
        }),
      );
    } catch (error) {
      // Stale/invalid private cursor → non-enumerating not_found.
      if (error instanceof ApiError) unavailable("not_found");
      throw error;
    }
    const projected = projectWorkTogetherRoomTimeline({
      bindingId,
      privateThreadId: thread.id,
      publicStreamId,
      environmentId: thread.environmentId ?? unavailable(),
      projectId: thread.projectId,
      threadStatus: "idle",
      // Older pages never carry the live active turn tail.
      privateActiveTurnId: null,
      timeline: response,
    });
    return withPublicTimelineMeta(projected, response);
  }

  function localChildren(
    reservation: NonNullable<
      ReturnType<typeof getWorkTogetherRoomResourceReservation>
    >,
  ) {
    const children: NonNullable<ReturnType<typeof getThread>>[] = [];
    const visited = new Set<string>([reservation.primaryThreadId]);
    const pending = [reservation.primaryThreadId];
    while (pending.length > 0) {
      const parentThreadId = pending.shift();
      if (parentThreadId === undefined) unavailable();
      const direct = listNonDeletedChildThreads(deps.db, {
        parentThreadId,
      }).sort((left, right) => left.id.localeCompare(right.id));
      for (const child of direct) {
        if (!isParentNotifiableChildThread(child)) continue;
        if (
          child.projectId !== reservation.projectId ||
          child.environmentId !== reservation.environmentId
        ) {
          unavailable();
        }
        if (visited.has(child.id)) unavailable();
        visited.add(child.id);
        children.push(child);
        pending.push(child.id);
        if (children.length > MAX_ROOM_CHILDREN) unavailable();
      }
    }
    return children;
  }

  function validateAttachedChild(
    reservation: NonNullable<
      ReturnType<typeof getWorkTogetherRoomResourceReservation>
    >,
    attachment: WorkTogetherRoomChildAttachmentV1,
  ) {
    const thread = getThread(deps.db, attachment.childThreadId);
    if (
      thread === null ||
      thread.deletedAt !== null ||
      thread.projectId !== reservation.projectId ||
      thread.environmentId !== reservation.environmentId ||
      !isParentNotifiableChildThread(thread) ||
      thread.parentThreadId !== attachment.parentThreadId
    ) {
      unavailable("not_found");
    }
    let ancestorId = attachment.parentThreadId;
    const visited = new Set<string>([thread.id]);
    while (ancestorId !== reservation.primaryThreadId) {
      if (visited.has(ancestorId)) unavailable("not_found");
      visited.add(ancestorId);
      const ancestor = getThread(deps.db, ancestorId);
      if (
        ancestor === null ||
        ancestor.deletedAt !== null ||
        ancestor.projectId !== reservation.projectId ||
        ancestor.environmentId !== reservation.environmentId ||
        !isParentNotifiableChildThread(ancestor)
      ) {
        unavailable("not_found");
      }
      ancestorId = ancestor.parentThreadId;
    }
    return thread;
  }

  function tryResolveAttachedChild(
    reservation: NonNullable<
      ReturnType<typeof getWorkTogetherRoomResourceReservation>
    >,
    attachment: WorkTogetherRoomChildAttachmentV1,
  ) {
    try {
      return validateAttachedChild(reservation, attachment);
    } catch (error) {
      if (
        error instanceof RoomDistributionUnavailableError &&
        error.kind === "not_found"
      ) {
        return null;
      }
      throw error;
    }
  }

  function pendingSubagentAttentionByThreadIds(
    threadIds: readonly string[],
  ): Map<string, RoomSubagentAttentionKindV1> {
    const interactionsByThreadId =
      deps.pendingInteractions.listPendingThreadInteractionsByThreadIds(
        threadIds,
      );
    const attentionByThreadId = new Map<string, RoomSubagentAttentionKindV1>();
    for (const threadId of threadIds) {
      const kinds: RoomSubagentPendingInteractionKindV1[] = [];
      for (const interaction of interactionsByThreadId.get(threadId) ?? []) {
        if (interaction.status !== "pending") continue;
        if (isUserQuestionPendingInteractionPayload(interaction.payload)) {
          kinds.push("question");
        } else if (isApprovalPendingInteractionPayload(interaction.payload)) {
          kinds.push("approval");
        }
      }
      attentionByThreadId.set(
        threadId,
        deriveWorkTogetherRoomSubagentAttentionV1(kinds),
      );
    }
    return attentionByThreadId;
  }

  function projectSubagentAttachments(
    reservation: NonNullable<
      ReturnType<typeof getWorkTogetherRoomResourceReservation>
    >,
    attachments: readonly WorkTogetherRoomChildAttachmentV1[],
  ): readonly WorkTogetherRoomSubagentPublicAttachmentInputV1[] {
    const attachmentsByChildThreadId = new Map(
      attachments.map((attachment) => [attachment.childThreadId, attachment]),
    );
    const resolved = attachments.map((attachment) => {
      const parent = subagentParentInput(
        reservation,
        attachment,
        attachmentsByChildThreadId,
      );
      return {
        attachment,
        parent,
        thread: tryResolveAttachedChild(reservation, attachment),
      };
    });
    const resolvedThreadIds = resolved.flatMap((entry) =>
      entry.thread === null ? [] : [entry.thread.id],
    );
    let outcomeByThreadId: Map<string, "completed" | "failed" | "interrupted">;
    let excerptByThreadId: Map<string, string>;
    let attentionByThreadId: Map<string, RoomSubagentAttentionKindV1>;
    try {
      outcomeByThreadId = new Map(
        listLatestRootTurnTerminalOutcomesByThreadIds(
          deps.db,
          resolvedThreadIds,
        ).map((row) => [row.threadId, row.outcome]),
      );
      excerptByThreadId = new Map(
        listLatestCompletedAgentMessageExcerptsByThreadIds(
          deps.db,
          resolvedThreadIds,
        ).map((row) => [row.threadId, row.excerpt]),
      );
      attentionByThreadId =
        pendingSubagentAttentionByThreadIds(resolvedThreadIds);
    } catch (error) {
      mapKnownProjectionQueryError(error);
    }
    return resolved.map(({ attachment, parent, thread }) => {
      if (thread === null) {
        return Object.freeze({
          id: attachment.id,
          parent,
          thread: null,
        });
      }
      return Object.freeze({
        id: attachment.id,
        parent,
        thread: Object.freeze({
          archivedAt: thread.archivedAt,
          attention:
            attentionByThreadId.get(thread.id) ??
            deriveWorkTogetherRoomSubagentAttentionV1([]),
          latestPublicAssistantExcerpt:
            excerptByThreadId.get(thread.id) ?? null,
          latestRootTurnOutcome: outcomeByThreadId.get(thread.id) ?? null,
          privateThreadId: thread.id,
          status: thread.status,
          title: thread.title,
          titleFallback: thread.titleFallback,
        }),
      });
    });
  }

  async function authoritativeChildren(
    context: RoomDistributionContextV1,
    reservation: NonNullable<
      ReturnType<typeof getWorkTogetherRoomResourceReservation>
    >,
    reconcile: boolean,
  ): Promise<readonly WorkTogetherRoomChildAttachmentV1[]> {
    if (reconcile) {
      for (const child of localChildren(reservation)) {
        await childAttachments.attach({
          bindingId: context.bindingId,
          workspaceId: reservation.workspaceId,
          parentThreadId: child.parentThreadId ?? unavailable(),
          childThreadId: child.id,
        });
      }
    }
    return childAttachments.list({
      bindingId: context.bindingId,
      workspaceId: reservation.workspaceId,
      principal: context.principal,
    });
  }

  async function projectCurrentSubagentList(input: {
    authority: WorkTogetherRoomCommandAuthorityV1;
    context: RoomDistributionContextV1;
    reconcile: boolean;
    reservation: NonNullable<
      ReturnType<typeof getWorkTogetherRoomResourceReservation>
    >;
  }): Promise<{
    observedPrivateThreadIds: ReadonlySet<string>;
    subagents: readonly RoomSubagentV1[];
  }> {
    const attachments = await authoritativeChildren(
      input.context,
      input.reservation,
      input.reconcile,
    );
    const projectedAttachments = projectSubagentAttachments(
      input.reservation,
      attachments,
    );
    const environmentId = input.reservation.environmentId;
    if (environmentId.length === 0) unavailable();
    const subagents = projectWorkTogetherRoomSubagentPublicContract({
      attachments: projectedAttachments,
      authority: input.authority,
      bindingId: input.context.bindingId,
      environmentId,
      projectId: input.reservation.projectId,
    });
    const observedPrivateThreadIds = new Set<string>([
      input.reservation.primaryThreadId,
    ]);
    for (const attachment of projectedAttachments) {
      if (attachment.thread !== null) {
        observedPrivateThreadIds.add(attachment.thread.privateThreadId);
      }
    }
    return { observedPrivateThreadIds, subagents };
  }

  async function resolveStream(
    context: RoomDistributionContextV1,
    subagentId: string | null,
  ) {
    const resolved = resolve(context.bindingId);
    if (subagentId === null) {
      return {
        ...resolved,
        kind: "primary" as const,
        publicStreamId: context.bindingId,
      };
    }
    const attachments = await authoritativeChildren(
      context,
      resolved.reservation,
      false,
    );
    const attachment = attachments.find((entry) => entry.id === subagentId);
    if (attachment === undefined) unavailable("not_found");
    return {
      ...resolved,
      kind: "subagent" as const,
      thread: validateAttachedChild(resolved.reservation, attachment),
      publicStreamId: attachment.id,
    };
  }

  return Object.freeze({
    async bootstrap(context: RoomDistributionContextV1) {
      const { reservation, thread, environment } = resolve(context.bindingId);
      const commandScope = {
        bindingId: context.bindingId,
        publicStream: Object.freeze({ kind: "primary" as const }),
        publicStreamId: context.bindingId,
        workspaceId: reservation.workspaceId,
        taskId: reservation.taskId,
        principal: context.principal,
        thread,
      };
      const authority = await commands.readAuthority(commandScope);
      const capabilities = commands.capabilities(commandScope, authority);
      const task = validateTaskProjection(
        await taskProjection.read({
          bindingId: context.bindingId,
          workspaceId: reservation.workspaceId,
          taskId: reservation.taskId,
          principal: context.principal,
        }),
        context.bindingId,
      );
      const current = timeline(context.bindingId, thread);
      const currentList = await projectCurrentSubagentList({
        authority,
        context,
        reconcile: true,
        reservation,
      });
      const subagents = copyPublicSubagents(currentList.subagents);
      return Object.freeze({
        schemaVersion: 2,
        binding: { id: context.bindingId, state: "active" },
        cell: { connection: "ready" },
        task,
        repository: {
          bindingId: reservation.repositoryBindingId,
          bindingVersion: reservation.repositoryBindingVersion,
          providerRepositoryId: reservation.providerRepositoryId,
          baseBranch: reservation.baseBranch,
          generatedBranch: reservation.generatedBranch,
        },
        environment: {
          template: reservation.environmentTemplate,
          status: environment.status,
        },
        primaryRun: primaryRun(thread.status),
        capabilities,
        subagents,
        collaboration: collaborationState(presence.count(context.bindingId)),
        timeline: current.projection,
        cursor: cursorFor(current.maxSeq),
      });
    },

    async execute(
      context: RoomDistributionContextV1,
      rawCommand: RoomJsonObject,
    ) {
      // Parse only the exact V2 stream target first so unknown/stale/cross-Room
      // Subagents fail the same generic unavailable as a malformed body.
      const stream = parseRoomCommandStreamV2(rawCommand.stream);
      const resolved = await resolveStream(
        context,
        stream.kind === "subagent" ? stream.id : null,
      );
      return commands.execute(
        {
          bindingId: context.bindingId,
          publicStream: stream,
          publicStreamId: resolved.publicStreamId,
          workspaceId: resolved.reservation.workspaceId,
          taskId: resolved.reservation.taskId,
          principal: context.principal,
          thread: resolved.thread,
        },
        rawCommand,
      );
    },

    async events(
      context: RoomDistributionContextV1,
      target: RoomDistributionStreamTargetV1,
    ) {
      const after = parseCursor(target.cursor);
      const { thread, publicStreamId } = await resolveStream(
        context,
        target.subagentId,
      );
      const current = timeline(context.bindingId, thread, publicStreamId);
      if (after !== null && after > current.maxSeq) unavailable("not_found");
      const changed = after === null || current.maxSeq > after;
      return Object.freeze({
        schemaVersion: 1,
        cursor: cursorFor(current.maxSeq),
        changed,
        timeline: changed ? current.projection : null,
      });
    },

    async timeline(
      context: RoomDistributionContextV1,
      target: RoomDistributionOlderTimelineTargetV1,
    ) {
      const beforeSequence = parsePublicOlderCursor(target.before);
      const { thread, publicStreamId } = await resolveStream(
        context,
        target.subagentId,
      );
      const projection = olderTimeline(
        context.bindingId,
        thread,
        beforeSequence,
        publicStreamId,
      );
      return Object.freeze({
        schemaVersion: 1,
        timeline: projection,
      });
    },

    async subscribe(
      context: RoomDistributionContextV1,
      target: RoomDistributionStreamTargetV1,
      emit: (event: RoomJsonObject) => void,
    ) {
      const after = parseCursor(target.cursor) ?? 0;
      const resolved = await resolveStream(context, target.subagentId);
      const { kind, reservation, thread } = resolved;
      const current = getLatestThreadSequence(deps.db, { threadId: thread.id });
      if (after > current) unavailable("not_found");
      let closed = false;
      let delivered = after;
      const isPrimary = kind === "primary";
      let leavePresence: (() => void) | null = null;
      let readyEmitted = false;
      let observedPrivateThreadIds = new Set<string>([thread.id]);
      let listSignature = "";
      let queuedListWork: "none" | "reproject" | "reconcile" = "none";
      let listProjectionActive = false;
      let cachedAuthority: WorkTogetherRoomCommandAuthorityV1 | null = null;
      const retainedUnknownListHints = new Map<
        string,
        { reconcile: boolean; reproject: boolean }
      >();

      function emitSafe(event: RoomJsonObject): void {
        if (closed) return;
        try {
          emit(event);
        } catch {
          // Emit is best-effort; a closed socket must not break the observer.
        }
      }

      function considerTimeline(message: ChangedMessage): void {
        if (message.entity !== "thread" || message.id !== thread.id) return;
        const latest = getLatestThreadSequence(deps.db, {
          threadId: thread.id,
        });
        if (latest <= delivered) return;
        delivered = latest;
        if (!readyEmitted) return;
        emitSafe(Object.freeze({ type: "changed", cursor: cursorFor(latest) }));
      }

      function queueObservedListHint(
        threadId: string,
        message: Extract<ChangedMessage, { entity: "thread" }>,
      ): void {
        if (message.changes.includes("children-changed")) {
          queuedListWork = "reconcile";
          if (readyEmitted) void flushListProjection();
          return;
        }
        if (threadId === reservation.primaryThreadId) return;
        if (!isObservedSubagentListRelevant(message)) return;
        if (queuedListWork !== "reconcile") queuedListWork = "reproject";
        if (readyEmitted) void flushListProjection();
      }

      function retainUnknownListHint(
        threadId: string,
        message: Extract<ChangedMessage, { entity: "thread" }>,
      ): void {
        if (readyEmitted) {
          if (
            !listProjectionActive ||
            !message.changes.includes("children-changed")
          ) {
            return;
          }
        }
        if (
          !retainedUnknownListHints.has(threadId) &&
          retainedUnknownListHints.size >= MAX_ROOM_CHILDREN
        ) {
          if (!readyEmitted) {
            retainedUnknownListHints.clear();
            queuedListWork = "reconcile";
          }
          return;
        }
        const current = retainedUnknownListHints.get(threadId) ?? {
          reconcile: false,
          reproject: false,
        };
        if (message.changes.includes("children-changed")) {
          current.reconcile = true;
        } else if (
          threadId !== reservation.primaryThreadId &&
          isObservedSubagentListRelevant(message)
        ) {
          current.reproject = true;
        } else {
          return;
        }
        retainedUnknownListHints.set(threadId, current);
      }

      function replayRetainedListHints(): void {
        for (const [threadId, hint] of [...retainedUnknownListHints]) {
          if (!observedPrivateThreadIds.has(threadId)) {
            if (readyEmitted) retainedUnknownListHints.delete(threadId);
            continue;
          }
          retainedUnknownListHints.delete(threadId);
          if (hint.reconcile) {
            queuedListWork = "reconcile";
            continue;
          }
          if (hint.reproject && queuedListWork !== "reconcile") {
            queuedListWork = "reproject";
          }
        }
      }

      function queuedListNeedsReconciliation(): boolean {
        return queuedListWork === "reconcile";
      }

      function considerListHint(message: ChangedMessage): void {
        if (!isPrimary || message.entity !== "thread") return;
        const threadId = message.id;
        if (threadId === undefined) return;
        if (!observedPrivateThreadIds.has(threadId)) {
          retainUnknownListHint(threadId, message);
          return;
        }
        queueObservedListHint(threadId, message);
      }

      async function applyListProjection(reconcile: boolean): Promise<void> {
        if (cachedAuthority === null) unavailable();
        const projected = await projectCurrentSubagentList({
          authority: cachedAuthority,
          context,
          reconcile,
          reservation,
        });
        observedPrivateThreadIds = new Set(projected.observedPrivateThreadIds);
        replayRetainedListHints();
        const signature = subagentListSignature(projected.subagents);
        if (signature === listSignature) return;
        listSignature = signature;
        if (!readyEmitted) return;
        emitSafe(
          Object.freeze({
            type: "subagents.changed",
            subagents: copyPublicSubagents(projected.subagents),
          }),
        );
      }

      async function flushListProjection(): Promise<void> {
        if (listProjectionActive || closed || !readyEmitted) return;
        listProjectionActive = true;
        try {
          while (queuedListWork !== "none" && !closed) {
            const work = queuedListWork;
            queuedListWork = "none";
            try {
              await applyListProjection(work === "reconcile");
            } catch (error) {
              deps.logger.warn(
                productionErrorLogFields(error),
                "Room primary subagent list projection failed",
              );
            }
          }
        } finally {
          listProjectionActive = false;
        }
        if (queuedListWork !== "none" && !closed) {
          await flushListProjection();
        }
      }

      const unsubscribe = deps.hub.onChangedMessage((message) => {
        if (closed) return;
        considerTimeline(message);
        considerListHint(message);
      });

      try {
        if (isPrimary) {
          cachedAuthority = await commands.readAuthority({
            bindingId: context.bindingId,
            publicStream: Object.freeze({ kind: "primary" as const }),
            publicStreamId: context.bindingId,
            workspaceId: reservation.workspaceId,
            taskId: reservation.taskId,
            principal: context.principal,
            thread,
          });
          const snapshot = await projectCurrentSubagentList({
            authority: cachedAuthority,
            context,
            reconcile: true,
            reservation,
          });
          observedPrivateThreadIds = new Set(snapshot.observedPrivateThreadIds);
          replayRetainedListHints();
          const recheck = await projectCurrentSubagentList({
            authority: cachedAuthority,
            context,
            reconcile: queuedListNeedsReconciliation(),
            reservation,
          });
          observedPrivateThreadIds = new Set(recheck.observedPrivateThreadIds);
          listSignature = subagentListSignature(recheck.subagents);
          replayRetainedListHints();
          const readySeq = getLatestThreadSequence(deps.db, {
            threadId: thread.id,
          });
          delivered = Math.max(delivered, readySeq);
          emit(
            Object.freeze({
              type: "ready",
              cursor: cursorFor(delivered),
              subagents: copyPublicSubagents(recheck.subagents),
            }),
          );
        } else {
          delivered = Math.max(delivered, current);
          emit(Object.freeze({ type: "ready", cursor: cursorFor(delivered) }));
        }
        readyEmitted = true;
        if (isPrimary) {
          replayRetainedListHints();
          const handle = presence.join(
            context.bindingId,
            context.principal.id,
            emit,
          );
          leavePresence = () => handle.leave();
          await flushListProjection();
        }
      } catch (error) {
        closed = true;
        unsubscribe();
        leavePresence?.();
        leavePresence = null;
        throw error;
      }

      const subscription: RoomDistributionSubscriptionV1 = Object.freeze({
        close() {
          if (closed) return;
          closed = true;
          unsubscribe();
          leavePresence?.();
          leavePresence = null;
        },
      });
      return subscription;
    },
  });
}
