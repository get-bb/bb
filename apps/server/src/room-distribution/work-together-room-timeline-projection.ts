import { createHash } from "node:crypto";

import type {
  ThreadTimelineResponse,
  TimelineApprovalWorkRow,
  TimelineConversationRow,
  TimelineQuestionWorkRow,
  TimelineRow,
  TimelineSourceRow,
  TimelineSystemRow,
  TimelineWorkRow,
  TimelineWorkflowWorkRow,
} from "@bb/server-contract";
import type { ActorStamp, ThreadStatus } from "@bb/domain";

import {
  RoomDistributionUnavailableError,
  type RoomJsonObject,
} from "./room-distribution-port.js";

type RoomActivityKind =
  | "command"
  | "tool"
  | "file_change"
  | "web_search"
  | "web_fetch"
  | "image_view"
  | "delegation"
  | "workflow";

type RoomActivityStatus = "running" | "completed" | "error" | "interrupted";

type RoomActivityLabel =
  | "Command"
  | "Tool"
  | "File change"
  | "Web search"
  | "Web fetch"
  | "Image review"
  | "Delegated work"
  | "Workflow";

type RoomActivityRow = {
  kind: "activity";
  id: string;
  activityKind: RoomActivityKind;
  status: RoomActivityStatus;
  label: RoomActivityLabel;
  startedAt: number;
  completedAt: number | null;
};

type RoomActor = {
  participantId: string;
  kind: "human" | "agent" | "machine" | "system";
  displayName: string;
};

type RoomConversationRow = {
  kind: "conversation";
  id: string;
  role: "user" | "assistant";
  text: string;
  actor: RoomActor | null;
  createdAt: number;
};

type RoomQuestion = {
  id: string;
  prompt: string;
  shortLabel?: string;
  multiSelect: boolean;
  options: RoomQuestionOption[];
  allowFreeText: boolean;
};

type RoomQuestionOption = {
  value: string;
  label: string;
  description?: string;
};

type RoomQuestionInteractionRow = {
  kind: "work";
  workKind: "question";
  id: string;
  interactionId: string;
  status: "pending";
  lifecycle: "pending" | "resolving";
  createdAt: number;
  questions: RoomQuestion[];
};

type RoomApprovalInteractionRow = {
  kind: "work";
  workKind: "approval";
  id: string;
  interactionId: string;
  status: "pending";
  lifecycle: "pending" | "resolving";
  createdAt: number;
  label: "Approve this request?";
  decisions: ["allow_once", "deny"];
};

type RoomNoticeKind =
  | "error"
  | "interrupted"
  | "reconnecting"
  | "interaction_unavailable"
  | "message_unavailable"
  | "activity_truncated";

type RoomNoticeLabel =
  | "Work failed"
  | "Work interrupted"
  | "Reconnecting…"
  | "A response is unavailable"
  | "A message is unavailable"
  | "Earlier activity omitted";

type RoomNoticeRow = {
  kind: "notice";
  id: string;
  noticeKind: RoomNoticeKind;
  label: RoomNoticeLabel;
  createdAt: number;
};

type RoomTimelineRow =
  | RoomActivityRow
  | RoomConversationRow
  | RoomQuestionInteractionRow
  | RoomApprovalInteractionRow
  | RoomNoticeRow;

export type RoomTimeline = {
  rows: RoomTimelineRow[];
  working: boolean;
  activeTurnId: string | null;
};

export type ProjectWorkTogetherRoomTimelineInput = {
  bindingId: string;
  privateThreadId: string;
  publicStreamId: string;
  environmentId: string;
  projectId: string;
  threadStatus: ThreadStatus;
  privateActiveTurnId: string | null;
  timeline: ThreadTimelineResponse;
};

type ProjectionEntry = {
  row: RoomTimelineRow;
  privateRowId: string;
  sourceCreatedAt: number;
};

type TimelineActivitySourceRow = Exclude<
  TimelineWorkRow,
  TimelineApprovalWorkRow | TimelineQuestionWorkRow
>;

const MAX_ACTIVITY_ROWS = 512;
const MAX_TOTAL_ROWS = 768;
const MAX_SERIALIZED_BYTES = 2_097_152;
const MAX_CONVERSATION_TEXT_BYTES = 65_536;
const MAX_DISPLAY_NAME_BYTES = 400;
const MAX_QUESTIONS = 4;
const MAX_OPTIONS = 4;
const MAX_QUESTION_ID_BYTES = 256;
const MAX_PROMPT_BYTES = 2_048;
const MAX_SHORT_LABEL_BYTES = 160;
const MAX_OPTION_VALUE_BYTES = 256;
const MAX_OPTION_LABEL_BYTES = 256;
const MAX_OPTION_DESCRIPTION_BYTES = 512;
const DISALLOWED_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const PENDING_INTERACTION_ID = /^pint_[23456789abcdefghijkmnpqrstuvwxyz]{10}$/u;

const ACTIVITY_LABELS = {
  command: "Command",
  tool: "Tool",
  file_change: "File change",
  web_search: "Web search",
  web_fetch: "Web fetch",
  image_view: "Image review",
  delegation: "Delegated work",
  workflow: "Workflow",
} as const satisfies Record<RoomActivityKind, RoomActivityLabel>;

class RowUnavailableError extends Error {
  constructor() {
    super("Room timeline row unavailable");
    this.name = "RowUnavailableError";
  }
}

function unavailable(): never {
  throw new RoomDistributionUnavailableError("unavailable");
}

function rowUnavailable(): never {
  throw new RowUnavailableError();
}

function finiteTimestamp(value: number): number {
  if (!Number.isFinite(value) || value < 0) unavailable();
  return value;
}

function privateRowIdentity(value: string): string {
  if (value.length === 0) unavailable();
  return value;
}

function validateInput(input: ProjectWorkTogetherRoomTimelineInput): void {
  privateRowIdentity(input.bindingId);
  privateRowIdentity(input.privateThreadId);
  privateRowIdentity(input.publicStreamId);
  privateRowIdentity(input.environmentId);
  privateRowIdentity(input.projectId);
}

function validateSourceBase(
  row: TimelineRow,
  input: ProjectWorkTogetherRoomTimelineInput,
): void {
  privateRowIdentity(row.id);
  if (
    row.threadId !== input.privateThreadId ||
    !Number.isSafeInteger(row.sourceSeqStart) ||
    row.sourceSeqStart < 0 ||
    !Number.isSafeInteger(row.sourceSeqEnd) ||
    row.sourceSeqEnd < row.sourceSeqStart
  ) {
    unavailable();
  }
  finiteTimestamp(row.startedAt);
  finiteTimestamp(row.createdAt);
}

function hashPublicId(
  domain: "row" | "turn",
  input: Pick<
    ProjectWorkTogetherRoomTimelineInput,
    "bindingId" | "publicStreamId"
  >,
  privateIdentity: string,
): string {
  const prefix = domain === "row" ? "roomrow_" : "turn_";
  return `${prefix}${createHash("sha256")
    .update(`work-together-room-${domain}-v1\0`)
    .update(input.bindingId)
    .update("\0")
    .update(input.publicStreamId)
    .update("\0")
    .update(privateIdentity)
    .digest("base64url")}`;
}

export function deriveWorkTogetherRoomPublicTurnId(input: {
  bindingId: string;
  privateTurnId: string;
  publicStreamId: string;
}): string {
  privateRowIdentity(input.bindingId);
  privateRowIdentity(input.publicStreamId);
  return hashPublicId("turn", input, privateRowIdentity(input.privateTurnId));
}

function rowId(
  input: ProjectWorkTogetherRoomTimelineInput,
  privateIdentity: string,
): string {
  return hashPublicId("row", input, privateRowIdentity(privateIdentity));
}

function noticeId(
  input: ProjectWorkTogetherRoomTimelineInput,
  privateIdentity: string,
  kind: Extract<
    RoomNoticeKind,
    "interaction_unavailable" | "message_unavailable" | "activity_truncated"
  >,
): string {
  return rowId(
    input,
    `notice\0${kind}\0${privateRowIdentity(privateIdentity)}`,
  );
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

function validateVisibleText(
  value: string,
  input: ProjectWorkTogetherRoomTimelineInput,
  maxBytes: number,
  requireNonBlank: boolean,
): string {
  let projected = value.normalize("NFC");
  projected = projected.replaceAll(input.privateThreadId, input.publicStreamId);
  projected = projected.replaceAll(
    input.environmentId,
    `${input.bindingId}:environment`,
  );
  projected = projected.replaceAll(
    input.projectId,
    `${input.bindingId}:project`,
  );
  if (
    DISALLOWED_CONTROL.test(projected) ||
    Buffer.byteLength(projected, "utf8") > maxBytes ||
    (requireNonBlank && projected.trim().length === 0)
  ) {
    rowUnavailable();
  }
  return projected;
}

function validateCorrelation(
  value: string,
  input: ProjectWorkTogetherRoomTimelineInput,
  maxBytes: number,
): string {
  if (
    value.normalize("NFC") !== value ||
    value.trim().length === 0 ||
    DISALLOWED_CONTROL.test(value) ||
    Buffer.byteLength(value, "utf8") > maxBytes ||
    value.includes(input.privateThreadId) ||
    value.includes(input.environmentId) ||
    value.includes(input.projectId)
  ) {
    rowUnavailable();
  }
  return value;
}

function projectActor(
  actor: ActorStamp,
  input: ProjectWorkTogetherRoomTimelineInput,
): RoomActor {
  privateRowIdentity(actor.principalId);
  let displayName: string;
  try {
    displayName = validateVisibleText(
      actor.displayName,
      input,
      MAX_DISPLAY_NAME_BYTES,
      false,
    );
  } catch (error) {
    if (!(error instanceof RowUnavailableError)) throw error;
    displayName = "Participant";
  }
  return {
    participantId: participantId(input.bindingId, actor.principalId),
    kind: actor.principalKind,
    displayName,
  };
}

function activityStatus(status: TimelineWorkRow["status"]): RoomActivityStatus {
  switch (status) {
    case "pending":
      return "running";
    case "completed":
      return "completed";
    case "error":
      return "error";
    case "interrupted":
      return "interrupted";
  }
}

function activityKind(row: TimelineActivitySourceRow): RoomActivityKind {
  switch (row.workKind) {
    case "command":
      return "command";
    case "tool":
      return "tool";
    case "file-change":
      return "file_change";
    case "web-search":
      return "web_search";
    case "web-fetch":
      return "web_fetch";
    case "image-view":
      return "image_view";
    case "delegation":
      return "delegation";
    case "workflow":
      return "workflow";
  }
}

function completedAt(row: TimelineActivitySourceRow): number | null {
  switch (row.workKind) {
    case "file-change":
      return row.status === "pending" ? null : finiteTimestamp(row.createdAt);
    case "command":
    case "tool":
    case "web-search":
    case "web-fetch":
    case "image-view":
    case "delegation":
    case "workflow":
      return row.completedAt === null ? null : finiteTimestamp(row.completedAt);
  }
}

function projectActivity(
  row: TimelineActivitySourceRow,
  input: ProjectWorkTogetherRoomTimelineInput,
): RoomActivityRow {
  const kind = activityKind(row);
  return {
    kind: "activity",
    id: rowId(input, row.id),
    activityKind: kind,
    status: activityStatus(row.status),
    label: ACTIVITY_LABELS[kind],
    startedAt: finiteTimestamp(row.startedAt),
    completedAt: completedAt(row),
  };
}

function projectQuestion(
  row: TimelineQuestionWorkRow,
  input: ProjectWorkTogetherRoomTimelineInput,
): RoomQuestionInteractionRow | null {
  switch (row.lifecycle) {
    case "answered":
    case "interrupted":
      return null;
    case "pending":
    case "resolving":
      break;
  }
  if (
    row.status !== "pending" ||
    !PENDING_INTERACTION_ID.test(row.interactionId) ||
    row.questions.length === 0 ||
    row.questions.length > MAX_QUESTIONS
  ) {
    rowUnavailable();
  }
  const questionIds = new Set<string>();
  const questions = row.questions.map((question): RoomQuestion => {
    const id = validateCorrelation(question.id, input, MAX_QUESTION_ID_BYTES);
    if (questionIds.has(id)) rowUnavailable();
    questionIds.add(id);
    const sourceOptions = question.options ?? [];
    if (sourceOptions.length > MAX_OPTIONS) rowUnavailable();
    const optionValues = new Set<string>();
    const options = sourceOptions.map((option): RoomQuestionOption => {
      const value = validateCorrelation(
        option.value,
        input,
        MAX_OPTION_VALUE_BYTES,
      );
      if (optionValues.has(value)) rowUnavailable();
      optionValues.add(value);
      return {
        value,
        label: validateVisibleText(
          option.label,
          input,
          MAX_OPTION_LABEL_BYTES,
          true,
        ),
        ...(option.description === undefined
          ? {}
          : {
              description: validateVisibleText(
                option.description,
                input,
                MAX_OPTION_DESCRIPTION_BYTES,
                true,
              ),
            }),
      };
    });
    if (!question.allowFreeText && options.length === 0) rowUnavailable();
    return {
      id,
      prompt: validateVisibleText(
        question.prompt,
        input,
        MAX_PROMPT_BYTES,
        true,
      ),
      ...(question.shortLabel === undefined
        ? {}
        : {
            shortLabel: validateVisibleText(
              question.shortLabel,
              input,
              MAX_SHORT_LABEL_BYTES,
              true,
            ),
          }),
      multiSelect: question.multiSelect,
      options,
      allowFreeText: question.allowFreeText,
    };
  });
  return {
    kind: "work",
    workKind: "question",
    id: rowId(input, row.id),
    interactionId: row.interactionId,
    status: "pending",
    lifecycle: row.lifecycle,
    createdAt: finiteTimestamp(row.createdAt),
    questions,
  };
}

function projectApproval(
  row: TimelineApprovalWorkRow,
  input: ProjectWorkTogetherRoomTimelineInput,
): RoomApprovalInteractionRow | null {
  switch (row.approvalKind) {
    case "file-edit":
      return null;
    case "permission-grant":
      break;
  }
  switch (row.lifecycle) {
    case "granted":
    case "denied":
    case "interrupted":
      return null;
    case "pending":
    case "resolving":
      break;
  }
  if (
    row.status !== "pending" ||
    !PENDING_INTERACTION_ID.test(row.interactionId)
  ) {
    rowUnavailable();
  }
  return {
    kind: "work",
    workKind: "approval",
    id: rowId(input, row.id),
    interactionId: row.interactionId,
    status: "pending",
    lifecycle: row.lifecycle,
    createdAt: finiteTimestamp(row.createdAt),
    label: "Approve this request?",
    decisions: ["allow_once", "deny"],
  };
}

function projectWork(
  row: TimelineWorkRow,
  input: ProjectWorkTogetherRoomTimelineInput,
): RoomTimelineRow | null {
  switch (row.workKind) {
    case "question":
      return projectQuestion(row, input);
    case "approval":
      return projectApproval(row, input);
    case "command":
    case "tool":
    case "file-change":
    case "web-search":
    case "web-fetch":
    case "image-view":
    case "delegation":
    case "workflow":
      return projectActivity(row, input);
  }
}

function generatedNotice(
  kind: "interaction_unavailable" | "message_unavailable",
  source: TimelineRow,
  input: ProjectWorkTogetherRoomTimelineInput,
): RoomNoticeRow {
  return {
    kind: "notice",
    id: noticeId(input, source.id, kind),
    noticeKind: kind,
    label:
      kind === "interaction_unavailable"
        ? "A response is unavailable"
        : "A message is unavailable",
    createdAt: finiteTimestamp(source.createdAt),
  };
}

function projectConversation(
  row: TimelineConversationRow,
  input: ProjectWorkTogetherRoomTimelineInput,
): RoomConversationRow {
  return {
    kind: "conversation",
    id: rowId(input, row.id),
    role: row.role,
    text: validateVisibleText(
      row.text,
      input,
      MAX_CONVERSATION_TEXT_BYTES,
      false,
    ),
    actor: row.role === "user" ? projectActor(row.actor, input) : null,
    createdAt: finiteTimestamp(row.createdAt),
  };
}

function projectSystem(
  row: TimelineSystemRow,
  input: ProjectWorkTogetherRoomTimelineInput,
): RoomNoticeRow | null {
  const createdAt = finiteTimestamp(row.createdAt);
  switch (row.systemKind) {
    case "debug":
      return null;
    case "error":
      return {
        kind: "notice",
        id: rowId(input, row.id),
        noticeKind: "error",
        label: "Work failed",
        createdAt,
      };
    case "reconnect":
      return {
        kind: "notice",
        id: rowId(input, row.id),
        noticeKind: "reconnecting",
        label: "Reconnecting…",
        createdAt,
      };
    case "operation":
      return row.operationKind === "thread-interrupted"
        ? {
            kind: "notice",
            id: rowId(input, row.id),
            noticeKind: "interrupted",
            label: "Work interrupted",
            createdAt,
          }
        : null;
  }
}

function flattenTimelineRows(
  rows: readonly TimelineRow[],
  input: ProjectWorkTogetherRoomTimelineInput,
): TimelineSourceRow[] {
  const flattened: TimelineSourceRow[] = [];
  for (const row of rows) {
    validateSourceBase(row, input);
    if (row.kind !== "turn") {
      flattened.push(row);
      continue;
    }
    if (row.children === null) unavailable();
    for (const child of row.children) {
      validateSourceBase(child, input);
      if (child.kind === "turn") unavailable();
      flattened.push(child);
    }
  }
  return flattened;
}

function mergeSafeTails(
  sourceRows: readonly TimelineSourceRow[],
  activeWorkflows: readonly TimelineWorkflowWorkRow[],
  activeBackgroundCommands: readonly TimelineWorkflowWorkRow[],
  input: ProjectWorkTogetherRoomTimelineInput,
): TimelineSourceRow[] {
  const durableWorkIds = new Set(
    sourceRows.flatMap((row) =>
      row.kind === "work" ? [privateRowIdentity(row.id)] : [],
    ),
  );
  const tailsById = new Map<string, TimelineWorkflowWorkRow>();
  for (const tail of [...activeWorkflows, ...activeBackgroundCommands]) {
    validateSourceBase(tail, input);
    const id = privateRowIdentity(tail.id);
    if (!durableWorkIds.has(id) && !tailsById.has(id)) tailsById.set(id, tail);
  }
  const tails = [...tailsById.values()].sort(
    (left, right) =>
      left.sourceSeqStart - right.sourceSeqStart ||
      left.sourceSeqEnd - right.sourceSeqEnd ||
      left.createdAt - right.createdAt ||
      left.id.localeCompare(right.id),
  );
  const merged: TimelineSourceRow[] = [];
  let tailIndex = 0;
  for (const row of sourceRows) {
    while (
      tailIndex < tails.length &&
      tails[tailIndex].sourceSeqStart <= row.sourceSeqStart
    ) {
      merged.push(tails[tailIndex]);
      tailIndex += 1;
    }
    merged.push(row);
  }
  merged.push(...tails.slice(tailIndex));
  return merged;
}

function projectRow(
  source: TimelineSourceRow,
  input: ProjectWorkTogetherRoomTimelineInput,
): RoomTimelineRow | null {
  switch (source.kind) {
    case "work":
      try {
        return projectWork(source, input);
      } catch (error) {
        if (
          error instanceof RowUnavailableError &&
          (source.workKind === "question" ||
            (source.workKind === "approval" &&
              source.approvalKind === "permission-grant"))
        ) {
          return generatedNotice("interaction_unavailable", source, input);
        }
        throw error;
      }
    case "conversation":
      try {
        return projectConversation(source, input);
      } catch (error) {
        if (error instanceof RowUnavailableError) {
          return generatedNotice("message_unavailable", source, input);
        }
        throw error;
      }
    case "system":
      return projectSystem(source, input);
  }
}

function applyActivityBound(
  entries: readonly ProjectionEntry[],
  input: ProjectWorkTogetherRoomTimelineInput,
): ProjectionEntry[] {
  const activityCount = entries.filter(
    (entry) => entry.row.kind === "activity",
  ).length;
  const omitCount = Math.max(0, activityCount - MAX_ACTIVITY_ROWS);
  if (omitCount === 0) return [...entries];

  const result: ProjectionEntry[] = [];
  let omitted = 0;
  let noticeInserted = false;
  for (const entry of entries) {
    if (entry.row.kind === "activity" && omitted < omitCount) {
      if (!noticeInserted) {
        result.push({
          privateRowId: `notice\0activity_truncated\0${entry.privateRowId}`,
          sourceCreatedAt: entry.sourceCreatedAt,
          row: {
            kind: "notice",
            id: noticeId(input, entry.privateRowId, "activity_truncated"),
            noticeKind: "activity_truncated",
            label: "Earlier activity omitted",
            createdAt: entry.sourceCreatedAt,
          },
        });
        noticeInserted = true;
      }
      omitted += 1;
      continue;
    }
    result.push(entry);
  }
  return result;
}

function isRunningTail(row: TimelineWorkflowWorkRow): boolean {
  return row.status === "pending";
}

export function projectWorkTogetherRoomTimeline(
  input: ProjectWorkTogetherRoomTimelineInput,
): RoomTimeline & RoomJsonObject {
  validateInput(input);
  const flattened = flattenTimelineRows(input.timeline.rows, input);
  const sourceRows = mergeSafeTails(
    flattened,
    input.timeline.activeWorkflows,
    input.timeline.activeBackgroundCommands,
    input,
  );
  const projected: ProjectionEntry[] = [];
  for (const source of sourceRows) {
    const row = projectRow(source, input);
    if (row !== null) {
      projected.push({
        row,
        privateRowId: privateRowIdentity(source.id),
        sourceCreatedAt: finiteTimestamp(source.createdAt),
      });
    }
  }
  const bounded = applyActivityBound(projected, input);
  if (bounded.length > MAX_TOTAL_ROWS) unavailable();

  const output = {
    rows: bounded.map((entry) => entry.row),
    working:
      input.threadStatus === "starting" ||
      input.threadStatus === "active" ||
      input.timeline.activeThinking !== null ||
      input.timeline.activeWorkflows.some(isRunningTail) ||
      input.timeline.activeBackgroundCommands.some(isRunningTail),
    activeTurnId:
      input.privateActiveTurnId === null
        ? null
        : deriveWorkTogetherRoomPublicTurnId({
            bindingId: input.bindingId,
            privateTurnId: input.privateActiveTurnId,
            publicStreamId: input.publicStreamId,
          }),
  } satisfies RoomTimeline;

  let serialized: string;
  try {
    serialized = JSON.stringify(output);
  } catch {
    return unavailable();
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_SERIALIZED_BYTES) {
    return unavailable();
  }
  return output;
}
