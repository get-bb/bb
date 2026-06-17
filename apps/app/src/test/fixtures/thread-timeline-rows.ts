import type {
  TimelineActivityIntent,
  TimelineApprovalStatus,
  TimelineApprovalWorkRow,
  TimelineCommandWorkRow,
  TimelineConversationAttachments,
  TimelineConversationRow,
  TimelineConversationTurnRequest,
  TimelineDelegationWorkRow,
  TimelineDiffStats,
  TimelineFileChange,
  TimelineFileChangeWorkRow,
  TimelineImageViewWorkRow,
  TimelineParentChange,
  TimelineNonOperationSystemRow,
  TimelinePermissionGrantApprovalGrantScope,
  TimelineQuestionWorkRow,
  TimelineRow,
  TimelineRowBase,
  TimelineRowStatus,
  TimelineSystemOperationKind,
  TimelineSystemRow,
  TimelineToolWorkRow,
  TimelineTurnRow,
  TimelineWebFetchWorkRow,
  TimelineWebSearchWorkRow,
  TimelineWorkflowWorkRow,
} from "@bb/server-contract";
import type {
  SystemMessageKind,
  SystemMessageSubject,
  ThreadTurnInitiator,
} from "@bb/domain";

export interface RowBaseOverrideArgs {
  createdAt?: number;
  startedAt?: number;
  threadId?: string;
}

export interface BaseRowArgs extends RowBaseOverrideArgs {
  id: string;
  seq?: number;
  sourceSeqEnd?: number;
  sourceSeqStart?: number;
  turnId?: string | null;
}

export interface ConversationRowArgs extends RowBaseOverrideArgs {
  attachments?: TimelineConversationAttachments | null;
  id?: string;
  initiator?: ThreadTurnInitiator;
  role?: TimelineConversationRow["role"];
  senderThreadId?: string | null;
  seq?: number;
  sourceSeqEnd?: number;
  sourceSeqStart?: number;
  systemMessageKind?: SystemMessageKind;
  systemMessageSubject?: SystemMessageSubject | null;
  text: string;
  turnId?: string | null;
  turnRequest?: TimelineConversationTurnRequest;
}

export interface CommandRowArgs extends RowBaseOverrideArgs {
  activityIntents?: TimelineActivityIntent[];
  approvalStatus?: TimelineApprovalStatus;
  callId?: string;
  command: string;
  cwd?: string | null;
  durationMs?: number | null;
  exitCode?: number | null;
  id?: string;
  output?: string;
  seq?: number;
  source?: string | null;
  sourceSeqEnd?: number;
  sourceSeqStart?: number;
  status?: TimelineRowStatus;
  turnId?: string | null;
}

export interface ToolRowArgs extends RowBaseOverrideArgs {
  activityIntents?: TimelineActivityIntent[];
  approvalStatus?: TimelineApprovalStatus;
  callId?: string;
  durationMs?: number | null;
  id?: string;
  output?: string;
  seq?: number;
  sourceSeqEnd?: number;
  sourceSeqStart?: number;
  status?: TimelineRowStatus;
  toolArgs?: TimelineToolWorkRow["toolArgs"];
  toolName?: string;
  turnId?: string | null;
}

export interface FileChangeRowArgs extends RowBaseOverrideArgs {
  approvalStatus?: TimelineApprovalStatus;
  callId?: string;
  change?: TimelineFileChange;
  diff?: string | null;
  diffStats?: TimelineDiffStats;
  id?: string;
  kind?: string | null;
  movePath?: string | null;
  path?: string;
  seq?: number;
  sourceSeqEnd?: number;
  sourceSeqStart?: number;
  status?: TimelineRowStatus;
  stderr?: string | null;
  stdout?: string | null;
  turnId?: string | null;
}

export interface WebSearchRowArgs extends RowBaseOverrideArgs {
  callId?: string;
  durationMs?: number | null;
  id?: string;
  queries?: string[];
  seq?: number;
  sourceSeqEnd?: number;
  sourceSeqStart?: number;
  status?: TimelineRowStatus;
  turnId?: string | null;
}

export interface WebFetchRowArgs extends RowBaseOverrideArgs {
  callId?: string;
  durationMs?: number | null;
  id?: string;
  pattern?: string | null;
  prompt?: string | null;
  seq?: number;
  sourceSeqEnd?: number;
  sourceSeqStart?: number;
  status?: TimelineRowStatus;
  turnId?: string | null;
  url?: string;
}

export interface ImageViewRowArgs extends RowBaseOverrideArgs {
  callId?: string;
  durationMs?: number | null;
  id?: string;
  path?: string;
  seq?: number;
  sourceSeqEnd?: number;
  sourceSeqStart?: number;
  status?: TimelineRowStatus;
  turnId?: string | null;
}

export interface WorkflowRowArgs extends RowBaseOverrideArgs {
  description?: string;
  durationMs?: number | null;
  error?: string | null;
  id?: string;
  itemId?: string;
  seq?: number;
  sourceSeqEnd?: number;
  sourceSeqStart?: number;
  status?: TimelineRowStatus;
  summary?: string | null;
  taskStatus?: TimelineWorkflowWorkRow["taskStatus"];
  turnId?: string | null;
  usage?: TimelineWorkflowWorkRow["usage"];
  workflow?: TimelineWorkflowWorkRow["workflow"];
  workflowName?: string | null;
}

export interface ApprovalRowArgs extends RowBaseOverrideArgs {
  approvalKind?: TimelineApprovalWorkRow["approvalKind"];
  id?: string;
  interactionId?: string;
  itemId?: string;
  lifecycle?: TimelineApprovalWorkRow["lifecycle"];
  seq?: number;
  sourceSeqEnd?: number;
  sourceSeqStart?: number;
  grantScope?: TimelinePermissionGrantApprovalGrantScope | null;
  status?: TimelineRowStatus;
  statusReason?: string | null;
  toolName?: string | null;
  turnId?: string | null;
}

export interface QuestionRowArgs extends RowBaseOverrideArgs {
  answers?: TimelineQuestionWorkRow["answers"];
  id?: string;
  interactionId?: string;
  lifecycle?: TimelineQuestionWorkRow["lifecycle"];
  questions?: TimelineQuestionWorkRow["questions"];
  seq?: number;
  sourceSeqEnd?: number;
  sourceSeqStart?: number;
  status?: TimelineRowStatus;
  statusReason?: string | null;
  turnId?: string | null;
}

type PermissionGrantApprovalLifecycle = Extract<
  TimelineApprovalWorkRow,
  { approvalKind: "permission-grant" }
>["lifecycle"];

type QuestionLifecycle = TimelineQuestionWorkRow["lifecycle"];

export interface SystemRowArgs extends RowBaseOverrideArgs {
  completedAt?: number | null;
  detail?: string | null;
  durationMs?: number | null;
  id?: string;
  parentChange?: TimelineParentChange;
  operationKind?: TimelineSystemOperationKind;
  seq?: number;
  sourceSeqEnd?: number;
  sourceSeqStart?: number;
  status?: TimelineSystemRow["status"];
  systemKind?: TimelineSystemRow["systemKind"];
  title?: string;
  turnId?: string | null;
}

export interface NonOperationSystemRowArgs
  extends Omit<
    SystemRowArgs,
    "completedAt" | "durationMs" | "parentChange" | "operationKind" | "systemKind"
  > {
  systemKind: TimelineNonOperationSystemRow["systemKind"];
}

interface SystemRowBase extends TimelineRowBase {
  detail: string | null;
  kind: "system";
  status: TimelineSystemRow["status"];
  title: string;
}

export interface DelegationRowArgs extends RowBaseOverrideArgs {
  callId?: string;
  childRows?: TimelineRow[];
  description?: string | null;
  durationMs?: number | null;
  id?: string;
  output?: string;
  seq?: number;
  sourceSeqEnd?: number;
  sourceSeqStart?: number;
  status?: TimelineRowStatus;
  subagentType?: string | null;
  toolName?: string;
  turnId?: string | null;
}

export interface TurnRowArgs extends RowBaseOverrideArgs {
  children?: TimelineRow[] | null;
  durationMs?: number | null;
  id?: string;
  seq?: number;
  sourceSeqEnd?: number;
  sourceSeqStart?: number;
  status?: TimelineRowStatus;
  summaryCount?: number;
  turnId?: string;
}

export interface ReadIntentArgs {
  path: string;
}

export interface SearchIntentArgs {
  path: string | null;
  query: string;
}

export interface UnknownIntentArgs {
  command: string;
}

interface RowSequenceArgs {
  seq: number | undefined;
  sourceSeqStart: number | undefined;
}

interface CommandExitCodeArgs {
  exitCode: number | null | undefined;
  status: TimelineRowStatus;
}

const DEFAULT_THREAD_ID = "thread-1";
const DEFAULT_TURN_ID = "turn-1";
const DEFAULT_COMMAND_ID = "command-1";
const DEFAULT_CONVERSATION_ID = "conversation-1";
const DEFAULT_DELEGATION_ID = "delegation-1";
const DEFAULT_FILE_CHANGE_ID = "file-change-1";
const DEFAULT_QUESTION_ID = "question-1";
const DEFAULT_SYSTEM_ID = "system-1";
const DEFAULT_TOOL_ID = "tool-1";
const DEFAULT_TURN_ROW_ID = "turn-summary-1";
const DEFAULT_WEB_FETCH_ID = "web-fetch-1";
const DEFAULT_WEB_SEARCH_ID = "web-search-1";
const DEFAULT_IMAGE_VIEW_ID = "image-view-1";
const DEFAULT_WORKFLOW_ID = "workflow-1";

function rowSequence({ seq, sourceSeqStart }: RowSequenceArgs): number {
  return seq ?? sourceSeqStart ?? 1;
}

/**
 * Fixture inputs are written in terms of `durationMs` (intuitive when
 * authoring "this run took 2 seconds"). Production rows store
 * `completedAt = startedAt + durationMs`; this helper does the conversion
 * so tests stay readable while the row shape remains canonical.
 */
function completedAtFromDuration(
  startedAt: number,
  durationMs: number | null | undefined,
): number | null {
  if (durationMs === null || durationMs === undefined) return null;
  return startedAt + durationMs;
}

function permissionGrantLifecycleFromStatus(
  status: TimelineRowStatus,
): PermissionGrantApprovalLifecycle {
  switch (status) {
    case "pending":
      return "pending";
    case "completed":
      return "granted";
    case "interrupted":
    case "error":
      return "interrupted";
  }
}

function questionLifecycleFromStatus(
  status: TimelineRowStatus,
): QuestionLifecycle {
  switch (status) {
    case "pending":
      return "pending";
    case "completed":
      return "answered";
    case "interrupted":
    case "error":
      return "interrupted";
  }
}

function questionStatusFromLifecycle(
  lifecycle: QuestionLifecycle,
): TimelineRowStatus {
  switch (lifecycle) {
    case "pending":
    case "resolving":
      return "pending";
    case "answered":
      return "completed";
    case "interrupted":
      return "interrupted";
  }
}

function commandExitCode({
  exitCode,
  status,
}: CommandExitCodeArgs): number | null {
  if (exitCode !== undefined) {
    return exitCode;
  }
  // Story and test fixtures default only the common successful command case.
  // Failure and interruption examples should opt into a concrete exit code
  // when the rendered state depends on it.
  return status === "completed" ? 0 : null;
}

export function baseRow({
  createdAt,
  id,
  seq,
  sourceSeqEnd,
  sourceSeqStart,
  startedAt,
  threadId = DEFAULT_THREAD_ID,
  turnId = DEFAULT_TURN_ID,
}: BaseRowArgs): TimelineRowBase {
  const rowSeq = rowSequence({ seq, sourceSeqStart });
  return {
    id,
    threadId,
    turnId,
    sourceSeqStart: rowSeq,
    sourceSeqEnd: sourceSeqEnd ?? rowSeq,
    startedAt: startedAt ?? rowSeq,
    createdAt: createdAt ?? rowSeq,
  };
}

export function conversationRow({
  attachments = null,
  createdAt,
  id = DEFAULT_CONVERSATION_ID,
  initiator,
  role = "assistant",
  senderThreadId,
  seq,
  sourceSeqEnd,
  sourceSeqStart,
  startedAt,
  systemMessageKind = "unlabeled",
  systemMessageSubject = null,
  text,
  threadId,
  turnId,
  turnRequest,
}: ConversationRowArgs): TimelineConversationRow {
  const rowBase = baseRow({
    createdAt,
    id,
    seq,
    sourceSeqEnd,
    sourceSeqStart,
    startedAt,
    threadId,
    turnId,
  });
  if (role === "user") {
    const resolvedInitiator: ThreadTurnInitiator = initiator ?? "user";
    return {
      ...rowBase,
      kind: "conversation",
      role,
      text,
      mentions: [],
      attachments,
      initiator: resolvedInitiator,
      senderThreadId:
        senderThreadId !== undefined
          ? senderThreadId
          : resolvedInitiator === "agent"
            ? "thr_sender"
            : null,
      systemMessageKind,
      systemMessageSubject,
      turnRequest: turnRequest ?? { kind: "message", status: "accepted" },
    };
  }
  return {
    ...rowBase,
    kind: "conversation",
    role,
    text,
    attachments,
    turnRequest: null,
  };
}

export function readIntent({ path }: ReadIntentArgs): TimelineActivityIntent {
  return {
    type: "read",
    command: `cat ${path}`,
    name: path.split("/").pop() ?? path,
    path,
  };
}

export function searchIntent({
  query,
  path,
}: SearchIntentArgs): TimelineActivityIntent {
  return {
    type: "search",
    command: path ? `rg ${query} ${path}` : `rg ${query}`,
    query,
    path,
  };
}

export function unknownIntent({
  command,
}: UnknownIntentArgs): TimelineActivityIntent {
  return {
    type: "unknown",
    command,
  };
}

export function commandRow({
  activityIntents = [],
  approvalStatus = null,
  callId,
  command,
  createdAt,
  cwd = "/workspace/bb",
  durationMs = 2_300,
  exitCode,
  id = DEFAULT_COMMAND_ID,
  output = "",
  seq,
  source = "exec_command",
  sourceSeqEnd,
  sourceSeqStart,
  startedAt,
  status = "completed",
  threadId,
  turnId,
}: CommandRowArgs): TimelineCommandWorkRow {
  const base = baseRow({
    createdAt,
    id,
    seq,
    sourceSeqEnd,
    sourceSeqStart,
    startedAt,
    threadId,
    turnId,
  });
  return {
    ...base,
    kind: "work",
    workKind: "command",
    status,
    callId: callId ?? id,
    command,
    cwd,
    source,
    output,
    exitCode: commandExitCode({ exitCode, status }),
    completedAt: completedAtFromDuration(base.startedAt, durationMs),
    approvalStatus,
    activityIntents,
  };
}

export function toolRow({
  activityIntents = [],
  approvalStatus = null,
  callId,
  createdAt,
  durationMs = 2_300,
  id = DEFAULT_TOOL_ID,
  output = "",
  seq,
  sourceSeqEnd,
  sourceSeqStart,
  startedAt,
  status = "completed",
  threadId,
  toolArgs = null,
  toolName = "Read",
  turnId,
}: ToolRowArgs = {}): TimelineToolWorkRow {
  const base = baseRow({
    createdAt,
    id,
    seq,
    sourceSeqEnd,
    sourceSeqStart,
    startedAt,
    threadId,
    turnId,
  });
  return {
    ...base,
    kind: "work",
    workKind: "tool",
    status,
    callId: callId ?? id,
    toolName,
    toolArgs,
    output,
    completedAt: completedAtFromDuration(base.startedAt, durationMs),
    approvalStatus,
    activityIntents,
  };
}

function fileChangeFromArgs({
  change,
  diff = "@@ -1 +1 @@\n-before\n+after",
  diffStats = {
    added: 1,
    removed: 1,
  },
  kind = "update",
  movePath = null,
  path = "src/app.ts",
}: FileChangeRowArgs): TimelineFileChange {
  return (
    change ?? {
      path,
      kind,
      movePath,
      diff,
      diffStats,
    }
  );
}

export function fileChangeRow(
  args: FileChangeRowArgs = {},
): TimelineFileChangeWorkRow {
  const {
    approvalStatus = null,
    callId,
    id = DEFAULT_FILE_CHANGE_ID,
    seq,
    sourceSeqEnd,
    sourceSeqStart,
    status = "completed",
    stderr = null,
    stdout = "applied",
    turnId,
  } = args;
  return {
    ...baseRow({
      ...args,
      id,
      seq,
      sourceSeqEnd,
      sourceSeqStart,
      turnId,
    }),
    kind: "work",
    workKind: "file-change",
    status,
    callId: callId ?? id,
    change: fileChangeFromArgs(args),
    stdout,
    stderr,
    approvalStatus,
  };
}

export function webSearchRow({
  callId,
  createdAt,
  durationMs = null,
  id = DEFAULT_WEB_SEARCH_ID,
  queries = ["timeline renderer"],
  seq,
  sourceSeqEnd,
  sourceSeqStart,
  startedAt,
  status = "completed",
  threadId,
  turnId,
}: WebSearchRowArgs = {}): TimelineWebSearchWorkRow {
  const base = baseRow({
    createdAt,
    id,
    seq,
    sourceSeqEnd,
    sourceSeqStart,
    startedAt,
    threadId,
    turnId,
  });
  return {
    ...base,
    kind: "work",
    workKind: "web-search",
    status,
    callId: callId ?? id,
    queries,
    completedAt: completedAtFromDuration(base.startedAt, durationMs),
  };
}

export function webFetchRow({
  callId,
  createdAt,
  durationMs = null,
  id = DEFAULT_WEB_FETCH_ID,
  pattern = null,
  prompt = null,
  seq,
  sourceSeqEnd,
  sourceSeqStart,
  startedAt,
  status = "completed",
  threadId,
  turnId,
  url = "https://example.com/docs",
}: WebFetchRowArgs = {}): TimelineWebFetchWorkRow {
  const base = baseRow({
    createdAt,
    id,
    seq,
    sourceSeqEnd,
    sourceSeqStart,
    startedAt,
    threadId,
    turnId,
  });
  return {
    ...base,
    kind: "work",
    workKind: "web-fetch",
    status,
    callId: callId ?? id,
    url,
    prompt,
    pattern,
    completedAt: completedAtFromDuration(base.startedAt, durationMs),
  };
}

export function imageViewRow({
  callId,
  createdAt,
  durationMs = null,
  id = DEFAULT_IMAGE_VIEW_ID,
  path = "/tmp/dashboard-main.png",
  seq,
  sourceSeqEnd,
  sourceSeqStart,
  startedAt,
  status = "completed",
  threadId,
  turnId,
}: ImageViewRowArgs = {}): TimelineImageViewWorkRow {
  const base = baseRow({
    createdAt,
    id,
    seq,
    sourceSeqEnd,
    sourceSeqStart,
    startedAt,
    threadId,
    turnId,
  });
  return {
    ...base,
    kind: "work",
    workKind: "image-view",
    status,
    callId: callId ?? id,
    path,
    completedAt: completedAtFromDuration(base.startedAt, durationMs),
  };
}

export function workflowRow({
  createdAt,
  description = "Fixture workflow",
  durationMs = null,
  error = null,
  id = DEFAULT_WORKFLOW_ID,
  itemId,
  seq,
  sourceSeqEnd,
  sourceSeqStart,
  startedAt,
  status = "completed",
  summary = null,
  taskStatus = "completed",
  threadId,
  turnId,
  usage = null,
  workflow = null,
  workflowName = "fixture-workflow",
}: WorkflowRowArgs = {}): TimelineWorkflowWorkRow {
  const base = baseRow({
    createdAt,
    id,
    seq,
    sourceSeqEnd,
    sourceSeqStart,
    startedAt,
    threadId,
    turnId,
  });
  return {
    ...base,
    kind: "work",
    workKind: "workflow",
    status,
    itemId: itemId ?? id,
    workflowName,
    description,
    taskStatus,
    workflow,
    usage,
    summary,
    error,
    completedAt: completedAtFromDuration(base.startedAt, durationMs),
  };
}

export function approvalRow({
  approvalKind = "permission-grant",
  createdAt,
  id = "approval-1",
  interactionId = "approval-interaction-1",
  itemId = "approval-item-1",
  lifecycle,
  seq,
  sourceSeqEnd,
  sourceSeqStart,
  startedAt,
  grantScope = null,
  status = "pending",
  statusReason = null,
  threadId,
  toolName = null,
  turnId,
}: ApprovalRowArgs): TimelineApprovalWorkRow {
  if (approvalKind === "file-edit") {
    return {
      ...baseRow({
        createdAt,
        id,
        seq,
        sourceSeqEnd,
        sourceSeqStart,
        startedAt,
        threadId,
        turnId,
      }),
      kind: "work",
      workKind: "approval",
      status,
      interactionId,
      approvalKind,
      lifecycle:
        lifecycle === "denied" || lifecycle === "waiting"
          ? lifecycle
          : status === "pending"
            ? "waiting"
            : "denied",
      target: {
        itemId,
        toolName,
      },
    };
  }
  return {
    ...baseRow({
      createdAt,
      id,
      seq,
      sourceSeqEnd,
      sourceSeqStart,
      startedAt,
      threadId,
      turnId,
    }),
    kind: "work",
    workKind: "approval",
    status,
    interactionId,
    approvalKind,
    lifecycle:
      lifecycle === "pending" ||
      lifecycle === "resolving" ||
      lifecycle === "granted" ||
      lifecycle === "denied" ||
      lifecycle === "interrupted"
        ? lifecycle
        : permissionGrantLifecycleFromStatus(status),
    grantScope,
    statusReason,
    target: {
      itemId,
      toolName,
    },
  };
}

export function questionRow({
  answers = null,
  createdAt,
  id = DEFAULT_QUESTION_ID,
  interactionId = "question-interaction-1",
  lifecycle,
  questions = [
    {
      id: "question-1",
      prompt: "Which path should I take?",
      shortLabel: "Path",
      multiSelect: false,
      options: [
        { value: "simple", label: "Simple" },
        { value: "complete", label: "Complete" },
      ],
      allowFreeText: true,
    },
  ],
  seq,
  sourceSeqEnd,
  sourceSeqStart,
  startedAt,
  status,
  statusReason = null,
  threadId,
  turnId,
}: QuestionRowArgs = {}): TimelineQuestionWorkRow {
  const resolvedLifecycle =
    lifecycle ?? questionLifecycleFromStatus(status ?? "pending");
  return {
    ...baseRow({
      createdAt,
      id,
      seq,
      sourceSeqEnd,
      sourceSeqStart,
      startedAt,
      threadId,
      turnId,
    }),
    kind: "work",
    workKind: "question",
    status: status ?? questionStatusFromLifecycle(resolvedLifecycle),
    interactionId,
    lifecycle: resolvedLifecycle,
    questions,
    answers,
    statusReason,
  };
}

export function systemRow(
  args: NonOperationSystemRowArgs,
): TimelineNonOperationSystemRow;
export function systemRow(args?: SystemRowArgs): TimelineSystemRow;
export function systemRow({
  completedAt,
  createdAt,
  detail = "Running setup\nProvisioned thread (2s)",
  durationMs,
  id = DEFAULT_SYSTEM_ID,
  parentChange,
  operationKind,
  seq,
  sourceSeqEnd,
  sourceSeqStart,
  startedAt,
  status = "completed",
  systemKind = "operation",
  threadId,
  title = "Provisioned thread",
  turnId = null,
}: SystemRowArgs = {}): TimelineSystemRow {
  const base: SystemRowBase = {
    ...baseRow({
      createdAt,
      id,
      seq,
      sourceSeqEnd,
      sourceSeqStart,
      startedAt,
      threadId,
      turnId,
    }),
    kind: "system",
    title,
    detail,
    status,
  };
  if (systemKind !== "operation") {
    return {
      ...base,
      systemKind,
    };
  }
  const resolvedOperationKind =
    operationKind ?? (parentChange ? "parent-change" : "generic");
  const resolvedCompletedAt =
    completedAt !== undefined
      ? completedAt
      : durationMs !== undefined && durationMs !== null
        ? completedAtFromDuration(base.startedAt, durationMs)
        : status === "completed" ||
            status === "error" ||
            status === "interrupted"
          ? base.createdAt
          : null;
  if (resolvedOperationKind === "parent-change") {
    if (status === null) {
      throw new Error("Parent change system row requires a status");
    }
    return {
      ...base,
      systemKind,
      operationKind: resolvedOperationKind,
      status,
      completedAt: resolvedCompletedAt,
      parentChange: parentChange ?? {
        action: "assign",
        previousParentThreadId: null,
        previousParentThreadTitle: null,
        nextParentThreadId: null,
        nextParentThreadTitle: null,
      },
    };
  }
  return {
    ...base,
    systemKind,
    operationKind: resolvedOperationKind,
    completedAt: resolvedCompletedAt,
  };
}

export function delegationRow({
  callId,
  childRows = [
    commandRow({
      id: "delegation-child-command-1",
      command: "rg timeline apps/app",
      seq: 2,
    }),
  ],
  description = "Review renderer",
  durationMs = 2_000,
  id = DEFAULT_DELEGATION_ID,
  output = "Final subagent answer.",
  seq,
  sourceSeqEnd,
  sourceSeqStart,
  startedAt,
  status = "completed",
  subagentType = "general-purpose",
  threadId,
  toolName = "spawnAgent",
  turnId,
  createdAt,
}: DelegationRowArgs = {}): TimelineDelegationWorkRow {
  const base = baseRow({
    createdAt,
    id,
    seq,
    sourceSeqEnd,
    sourceSeqStart,
    startedAt,
    threadId,
    turnId,
  });
  return {
    ...base,
    kind: "work",
    workKind: "delegation",
    status,
    callId: callId ?? id,
    toolName,
    subagentType,
    description,
    output,
    completedAt: completedAtFromDuration(base.startedAt, durationMs),
    childRows,
  };
}

export function turnRow({
  children = null,
  createdAt,
  durationMs = 4_000,
  id = DEFAULT_TURN_ROW_ID,
  seq,
  sourceSeqEnd,
  sourceSeqStart = 10,
  startedAt,
  status = "completed",
  summaryCount = 1,
  threadId,
  turnId = DEFAULT_TURN_ID,
}: TurnRowArgs = {}): TimelineTurnRow {
  const base = baseRow({
    createdAt,
    id,
    seq,
    sourceSeqEnd,
    sourceSeqStart,
    startedAt,
    threadId,
    turnId,
  });
  return {
    ...base,
    kind: "turn",
    turnId,
    status,
    summaryCount,
    completedAt: completedAtFromDuration(base.startedAt, durationMs),
    children,
  };
}
