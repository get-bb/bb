import { createHash } from "node:crypto";

import {
  getEnvironment,
  getLatestThreadSequence,
  getThread,
  getWorkTogetherRoomResourceReservation,
} from "@bb/db";
import type { Principal } from "@bb/domain";
import type { AppDeps } from "../types.js";
import { buildThreadTimeline } from "../services/threads/timeline.js";
import { DEFAULT_MAX_INLINE_OUTPUT_CHARS } from "../services/threads/timeline-output-truncation.js";
import {
  RoomDistributionUnavailableError,
  type RoomDistributionContextV1,
  type RoomDistributionSubscriptionV1,
  type RoomJsonObject,
  type RoomJsonValue,
  type WorkTogetherRoomDistributionV1,
} from "./room-distribution-port.js";

const CURSOR = /^s\.([0-9]|[1-9][0-9]{0,15})$/u;
const MAX_TASK_PROJECTION_BYTES = 131_072;
const INITIAL_TIMELINE_SEGMENTS = 20;
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

function parseCursor(cursor: string | null): number {
  if (cursor === null) return 0;
  const match = CURSOR.exec(cursor);
  if (!match) unavailable("not_found");
  const sequence = Number(match[1]);
  if (!Number.isSafeInteger(sequence)) unavailable("not_found");
  return sequence;
}

function cursorFor(sequence: number): string {
  return `s.${sequence}`;
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
  environmentId?: string;
  projectId?: string;
}>;

function projectString(value: string, scope: ProjectionScope): string {
  let projected = value;
  if (scope.threadId !== undefined) {
    projected = projected.replaceAll(scope.threadId, scope.bindingId);
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
 * Binding-backed read distribution. SQLite remains the sole execution/event
 * authority while the injected WT task port owns canonical task projection.
 * Mutation commands remain deliberately unavailable until S4.4.
 */
export function createBindingBackedRoomDistributionV1(
  deps: Pick<AppDeps, "config" | "db" | "hub">,
  taskProjection: WorkTogetherRoomTaskProjectionPortV1,
): WorkTogetherRoomDistributionV1 {
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

  function timeline(bindingId: string, thread: ReturnType<typeof getThread>) {
    if (thread === null) unavailable();
    const maxSeq = getLatestThreadSequence(deps.db, { threadId: thread.id });
    const response = buildThreadTimeline(deps.db, thread, {
      eventBudget: deps.config.featureFlags.timelineWindowEventBudget,
      includeProviderUnhandledOperations: false,
      includeNestedRows: false,
      maxInlineOutputChars: DEFAULT_MAX_INLINE_OUTPUT_CHARS,
      maxSeq,
      page: { kind: "latest", segmentLimit: INITIAL_TIMELINE_SEGMENTS },
      providerDisplayName: "Agent",
      summaryOnly: false,
    });
    return {
      maxSeq,
      projection: projectObject(response, {
        bindingId,
        threadId: thread.id,
        environmentId: thread.environmentId ?? undefined,
        projectId: thread.projectId,
      }),
    };
  }

  return Object.freeze({
    async bootstrap(context: RoomDistributionContextV1) {
      const { reservation, thread, environment } = resolve(context.bindingId);
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
      return Object.freeze({
        schemaVersion: 1,
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
        capabilities: [],
        timeline: current.projection,
        cursor: cursorFor(current.maxSeq),
      });
    },

    async execute() {
      unavailable("not_found");
    },

    async events(context: RoomDistributionContextV1, cursor: string | null) {
      const after = parseCursor(cursor);
      const { thread } = resolve(context.bindingId);
      const current = timeline(context.bindingId, thread);
      if (after > current.maxSeq) unavailable("not_found");
      return Object.freeze({
        schemaVersion: 1,
        cursor: cursorFor(current.maxSeq),
        changed: current.maxSeq > after,
        timeline: current.maxSeq > after ? current.projection : null,
      });
    },

    async subscribe(
      context: RoomDistributionContextV1,
      cursor: string | null,
      emit: (event: RoomJsonObject) => void,
    ) {
      const after = parseCursor(cursor);
      const { thread } = resolve(context.bindingId);
      const current = getLatestThreadSequence(deps.db, { threadId: thread.id });
      if (after > current) unavailable("not_found");
      let closed = false;
      let delivered = after;
      emit(Object.freeze({ type: "ready", cursor: cursorFor(current) }));
      delivered = current;
      const unsubscribe = deps.hub.onChangedMessage((message) => {
        if (closed || message.entity !== "thread" || message.id !== thread.id)
          return;
        const latest = getLatestThreadSequence(deps.db, {
          threadId: thread.id,
        });
        if (latest <= delivered) return;
        delivered = latest;
        emit(Object.freeze({ type: "changed", cursor: cursorFor(latest) }));
      });
      const subscription: RoomDistributionSubscriptionV1 = Object.freeze({
        close() {
          if (closed) return;
          closed = true;
          unsubscribe();
        },
      });
      return subscription;
    },
  });
}
