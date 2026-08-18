import {
  parseThreadEventRow,
  type PromptInput,
  type PendingInteraction,
  type PendingInteractionResolution,
  type JsonValue,
  type ResolvedThreadExecutionOptions,
  type ThreadEventRow,
  type ThreadEventType,
  type ThreadQueuedMessage,
  type ThreadStatus,
} from "@bb/domain";
import { threadTabsResponseSchema } from "@bb/server-contract";
import type {
  CreateQueuedMessageRequest,
  CreateThreadRequest,
  EditMessageRequest,
  EditMessageResponse,
  ForkThreadRequest,
  DeleteThreadRequest,
  PromptHistoryResponse,
  SendQueuedMessageResponse,
  ThreadArchiveAllResponse,
  ThreadChildSummaryResponse,
  ThreadConversationOutlineResponse,
  ThreadListResponse,
  ThreadOpenResponse,
  ThreadPaneAction,
  ThreadPaneActionResponse,
  ThreadPendingInteractionsResponse,
  ThreadQueuedMessageListResponse,
  ThreadResponse,
  ThreadSearchResponse,
  ThreadStorageFileListResponse,
  ThreadStoragePathListResponse,
  ThreadTabsResponse,
  ThreadTimelineResponse,
  ThreadWithIncludesResponse,
  TimelineTurnSummaryDetailsResponse,
  ThreadOpenFile,
  ThreadOpenSplit,
  PromptHistoryQuery,
  ReorderPinnedThreadRequest,
  ReorderQueuedMessageRequest,
  ResolveThreadMentionsRequest,
  ResolveThreadMentionsResponse,
  SendMessageRequest,
  SendQueuedMessageRequest,
  SetQueuedMessageGroupBoundaryRequest,
  ThreadEventsQuery,
  ThreadEventWaitQuery,
  ThreadGetQuery,
  ThreadListQuery,
  ThreadSearchQuery,
  ThreadStorageFilesQuery,
  ThreadStoragePathsQuery,
  ThreadTimelineQuery,
  TimelineTurnSummaryDetailsQuery,
  UpdateThreadTabsRequest,
  UpdateThreadRequest,
  UpdateQueuedMessageRequest,
} from "@bb/server-contract";
import { signalRequestArgs, type CreateSdkAreaArgs } from "./common.js";

export const DEFAULT_THREAD_WAIT_TIMEOUT_MS = 20 * 60 * 1000;
export const DEFAULT_THREAD_WAIT_POLL_INTERVAL_MS = 250;

export interface ThreadListArgs {
  archived?: boolean;
  sectionId?: string;
  hasParent?: boolean;
  includeHidden?: boolean;
  limit?: number;
  offset?: number;
  originKind?: ThreadListQuery["originKind"];
  originPluginId?: string;
  parentThreadId?: string;
  projectId?: string;
  signal?: AbortSignal;
  sourceThreadId?: string;
  unsectioned?: boolean;
}

export interface ThreadSearchArgs extends ThreadSearchQuery {
  signal?: AbortSignal;
}

export interface ThreadResolveMentionsArgs extends ResolveThreadMentionsRequest {
  signal?: AbortSignal;
}

export interface ThreadGetArgs {
  include?: ThreadGetQuery["include"];
  signal?: AbortSignal;
  threadId: string;
}

export type ThreadGetResult = ThreadResponse | ThreadWithIncludesResponse;
export type ThreadListResult = ThreadListResponse;
export type ThreadSearchResult = ThreadSearchResponse;
export type ThreadResolveMentionsResult = ResolveThreadMentionsResponse;
export interface ThreadOutputResponse {
  output: string | null;
}
export type ThreadMutationResult = ThreadResponse;
export type ThreadSpawnResult = ThreadResponse;
export type ThreadForkResult = ThreadResponse;
export type ThreadInteractionGetResult = PendingInteraction;
export type ThreadInteractionListResult = ThreadPendingInteractionsResponse;
export type ThreadInteractionResolveResult = PendingInteraction;
export type ThreadInteractionRespondResult = PendingInteraction;
export type ThreadInteractionCancelResult = PendingInteraction;
export type ThreadEventsListResult = ThreadEventRow[];
export type ThreadEventWaitResult = ThreadEventRow | null;
export type ThreadTimelineResult = ThreadTimelineResponse;
export type ThreadArchiveResult = ThreadArchiveAllResponse;
export type ThreadOpenResult = ThreadOpenResponse;
export type ThreadPaneActionResult = ThreadPaneActionResponse;
export type ThreadDeleteResult = { ok: true };
export type ThreadSendResult = { ok: true };
export type ThreadEditMessageResult = EditMessageResponse;
export type ThreadStopResult = { ok: true };
export type ThreadCompactResult = { ok: true };
export type ThreadBannerActionResult = { ok: true };
export type ThreadUnarchiveResult = { ok: true };
export type ThreadArchiveAllResult = ThreadArchiveAllResponse;
export type ThreadReadStateResult = ThreadResponse;
export type ThreadPinOrderResult = ThreadListResponse;
export type ThreadPromptHistoryResult = PromptHistoryResponse;
export type ThreadQueuedMessagesResult = ThreadQueuedMessageListResponse;
export type ThreadQueuedMessageCreateResult = ThreadQueuedMessage;
export type ThreadQueuedMessageUpdateResult = ThreadQueuedMessage;
export type ThreadQueuedMessageDeleteResult = { ok: true };
export type ThreadQueuedMessageReorderResult = ThreadQueuedMessageListResponse;
export type ThreadQueuedMessageSendResult = SendQueuedMessageResponse;
export type ThreadQueuedMessageGroupBoundaryResult =
  ThreadQueuedMessageListResponse;
export type ThreadTabsResult = ThreadTabsResponse;
export type ThreadTabsUpdateResult = ThreadTabsResponse;
export type ThreadStorageFilesResult = ThreadStorageFileListResponse;
export type ThreadStoragePathsResult = ThreadStoragePathListResponse;
export type ThreadChildSummaryResult = ThreadChildSummaryResponse;
export type ThreadDefaultExecutionOptionsResult =
  ResolvedThreadExecutionOptions | null;
export type ThreadConversationOutlineResult = ThreadConversationOutlineResponse;
export type ThreadTimelineTurnSummaryDetailsResult =
  TimelineTurnSummaryDetailsResponse;

export interface ThreadSpawnBaseArgs extends Omit<
  CreateThreadRequest,
  "input" | "origin" | "originKind" | "startedOnBehalfOf"
> {
  origin?: CreateThreadRequest["origin"];
  originKind?: CreateThreadRequest["originKind"];
  startedOnBehalfOf?: CreateThreadRequest["startedOnBehalfOf"];
}

export type ThreadSpawnArgs = ThreadSpawnBaseArgs &
  (
    | {
        input: CreateThreadRequest["input"];
        prompt?: never;
      }
    | {
        input?: never;
        prompt: string;
      }
  );

export interface ThreadForkArgs extends Omit<
  ForkThreadRequest,
  "origin" | "visibility" | "workspace"
> {
  origin?: ForkThreadRequest["origin"];
  visibility?: ForkThreadRequest["visibility"];
  workspace?: ForkThreadRequest["workspace"];
}

export interface ThreadUpdateArgs extends UpdateThreadRequest {
  threadId: string;
}

export interface ThreadDeleteArgs extends DeleteThreadRequest {
  threadId: string;
}

export interface ThreadSendArgs extends SendMessageRequest {
  threadId: string;
}

export interface ThreadEditMessageArgs extends EditMessageRequest {
  threadId: string;
}

export interface ThreadActionArgs {
  threadId: string;
}

export interface ThreadStatusArgs extends ThreadActionArgs {
  signal?: AbortSignal;
}

export interface ThreadPromptHistoryArgs extends PromptHistoryQuery {
  signal?: AbortSignal;
  threadId: string;
}

export interface ThreadPinOrderArgs extends ReorderPinnedThreadRequest {
  threadId: string;
}

export interface ThreadQueuedMessageArgs {
  signal?: AbortSignal;
  threadId: string;
}

export interface ThreadQueuedMessageCreateArgs extends CreateQueuedMessageRequest {
  threadId: string;
}

export interface ThreadQueuedMessageUpdateArgs
  extends ThreadQueuedMessageTargetArgs, UpdateQueuedMessageRequest {}

export interface ThreadQueuedMessageTargetArgs {
  queuedMessageId: string;
  threadId: string;
}

export interface ThreadQueuedMessageSendArgs
  extends ThreadQueuedMessageTargetArgs, SendQueuedMessageRequest {}

export interface ThreadQueuedMessageReorderArgs
  extends ThreadQueuedMessageTargetArgs, ReorderQueuedMessageRequest {}

export interface ThreadQueuedMessageGroupBoundaryArgs extends SetQueuedMessageGroupBoundaryRequest {
  threadId: string;
}

export interface ThreadStorageFilesArgs extends ThreadStorageFilesQuery {
  signal?: AbortSignal;
  threadId: string;
}

export interface ThreadStoragePathsArgs extends ThreadStoragePathsQuery {
  signal?: AbortSignal;
  threadId: string;
}

export interface ThreadTimelineTurnSummaryDetailsArgs extends TimelineTurnSummaryDetailsQuery {
  signal?: AbortSignal;
  threadId: string;
}

export interface ThreadTabsUpdateArgs extends UpdateThreadTabsRequest {
  threadId: string;
}

export interface ThreadOpenArgs {
  threadId: string;
  split?: ThreadOpenSplit;
  file: ThreadOpenFile | null;
}

export interface ThreadPaneActionArgs {
  action: ThreadPaneAction;
  threadId: string;
}

export interface ThreadEventsListArgs {
  /** Return only events with a sequence greater than this value. */
  afterSeq?: string;
  /** Return only events with a sequence less than this value. */
  beforeSeq?: string;
  limit?: string;
  /** Defaults to ascending sequence order. */
  order?: "asc" | "desc";
  signal?: AbortSignal;
  threadId: string;
  /** Return only these event types. */
  types?: readonly [ThreadEventType, ...ThreadEventType[]];
}

export interface ThreadEventWaitArgs {
  afterSeq?: string;
  signal?: AbortSignal;
  threadId: string;
  type: string;
  waitMs: string;
}

export interface ThreadTimelineArgs extends ThreadTimelineQuery {
  signal?: AbortSignal;
  threadId: string;
}

export interface ThreadOutputArgs {
  signal?: AbortSignal;
  threadId: string;
}

export interface ThreadInteractionListArgs {
  signal?: AbortSignal;
  threadId: string;
}

export interface ThreadInteractionTargetArgs {
  interactionId: string;
  threadId: string;
}

export interface ThreadInteractionGetArgs extends ThreadInteractionTargetArgs {
  signal?: AbortSignal;
}

export interface ThreadInteractionResolveArgs extends ThreadInteractionTargetArgs {
  resolution: PendingInteractionResolution;
}

export interface ThreadInteractionRespondArgs extends ThreadInteractionTargetArgs {
  value: JsonValue;
}

export type ThreadWaitTarget =
  | { kind: "status"; status: ThreadStatus }
  | { kind: "event"; eventType: string };

export interface ThreadWaitArgs {
  event?: string;
  pollIntervalMs?: number;
  signal?: AbortSignal;
  status?: ThreadStatus;
  threadId: string;
  timeoutMs?: number;
}

export type ThreadWaitResult =
  | {
      event: NonNullable<ThreadEventWaitResult>;
      matched: true;
      target: Extract<ThreadWaitTarget, { kind: "event" }>;
      threadId: string;
    }
  | {
      matched: true;
      target: Extract<ThreadWaitTarget, { kind: "status" }>;
      thread: ThreadGetResult;
      threadId: string;
    };

export class ThreadWaitTimeoutError extends Error {
  readonly target: ThreadWaitTarget;
  readonly threadId: string;

  constructor(args: { target: ThreadWaitTarget; threadId: string }) {
    super(formatThreadWaitTimeoutMessage(args));
    this.name = "ThreadWaitTimeoutError";
    this.target = args.target;
    this.threadId = args.threadId;
  }
}

export class ThreadWaitUnreachableError extends Error {
  readonly currentStatus: ThreadStatus;
  readonly target: Extract<ThreadWaitTarget, { kind: "status" }>;
  readonly threadId: string;

  constructor(args: {
    currentStatus: ThreadStatus;
    target: Extract<ThreadWaitTarget, { kind: "status" }>;
    threadId: string;
  }) {
    super(
      `Thread ${args.threadId} is in status ${args.currentStatus} and will not reach idle by waiting alone. ` +
        `Inspect it with 'bb thread show ${args.threadId}' and recover by sending a follow-up.`,
    );
    this.name = "ThreadWaitUnreachableError";
    this.currentStatus = args.currentStatus;
    this.target = args.target;
    this.threadId = args.threadId;
  }
}

export interface ThreadInteractionsArea {
  cancel(
    args: ThreadInteractionTargetArgs,
  ): Promise<ThreadInteractionCancelResult>;
  get(args: ThreadInteractionGetArgs): Promise<ThreadInteractionGetResult>;
  list(args: ThreadInteractionListArgs): Promise<ThreadInteractionListResult>;
  resolve(
    args: ThreadInteractionResolveArgs,
  ): Promise<ThreadInteractionResolveResult>;
  respond(
    args: ThreadInteractionRespondArgs,
  ): Promise<ThreadInteractionRespondResult>;
}

export interface ThreadEventsArea {
  list(args: ThreadEventsListArgs): Promise<ThreadEventsListResult>;
  wait(args: ThreadEventWaitArgs): Promise<ThreadEventWaitResult>;
}

export interface ThreadQueuedMessagesArea {
  create(
    args: ThreadQueuedMessageCreateArgs,
  ): Promise<ThreadQueuedMessageCreateResult>;
  delete(
    args: ThreadQueuedMessageTargetArgs,
  ): Promise<ThreadQueuedMessageDeleteResult>;
  list(args: ThreadQueuedMessageArgs): Promise<ThreadQueuedMessagesResult>;
  reorder(
    args: ThreadQueuedMessageReorderArgs,
  ): Promise<ThreadQueuedMessageReorderResult>;
  send(
    args: ThreadQueuedMessageSendArgs,
  ): Promise<ThreadQueuedMessageSendResult>;
  setGroupBoundary(
    args: ThreadQueuedMessageGroupBoundaryArgs,
  ): Promise<ThreadQueuedMessageGroupBoundaryResult>;
  update(
    args: ThreadQueuedMessageUpdateArgs,
  ): Promise<ThreadQueuedMessageUpdateResult>;
}

export interface ThreadTabsArea {
  get(args: ThreadStatusArgs): Promise<ThreadTabsResult>;
  update(args: ThreadTabsUpdateArgs): Promise<ThreadTabsUpdateResult>;
}

export interface ThreadsArea {
  archive(args: ThreadActionArgs): Promise<ThreadArchiveResult>;
  archiveAll(args: ThreadActionArgs): Promise<ThreadArchiveAllResult>;
  childSummary(args: ThreadStatusArgs): Promise<ThreadChildSummaryResult>;
  compact(args: ThreadActionArgs): Promise<ThreadCompactResult>;
  cancelPlan(args: ThreadActionArgs): Promise<ThreadBannerActionResult>;
  clearGoal(args: ThreadActionArgs): Promise<ThreadBannerActionResult>;
  conversationOutline(
    args: ThreadStatusArgs,
  ): Promise<ThreadConversationOutlineResult>;
  defaultExecutionOptions(
    args: ThreadStatusArgs,
  ): Promise<ThreadDefaultExecutionOptionsResult>;
  delete(args: ThreadDeleteArgs): Promise<ThreadDeleteResult>;
  editMessage(args: ThreadEditMessageArgs): Promise<ThreadEditMessageResult>;
  events: ThreadEventsArea;
  fork(args: ThreadForkArgs): Promise<ThreadForkResult>;
  get(args: ThreadGetArgs): Promise<ThreadGetResult>;
  interactions: ThreadInteractionsArea;
  list(args?: ThreadListArgs): Promise<ThreadListResult>;
  markRead(args: ThreadActionArgs): Promise<ThreadReadStateResult>;
  markUnread(args: ThreadActionArgs): Promise<ThreadReadStateResult>;
  open(args: ThreadOpenArgs): Promise<ThreadOpenResult>;
  paneAction(args: ThreadPaneActionArgs): Promise<ThreadPaneActionResult>;
  output(args: ThreadOutputArgs): Promise<ThreadOutputResponse>;
  pin(args: ThreadActionArgs): Promise<ThreadMutationResult>;
  promptHistory(
    args: ThreadPromptHistoryArgs,
  ): Promise<ThreadPromptHistoryResult>;
  queuedMessages: ThreadQueuedMessagesArea;
  reorderPinned(args: ThreadPinOrderArgs): Promise<ThreadPinOrderResult>;
  resolveMentions(
    args: ThreadResolveMentionsArgs,
  ): Promise<ThreadResolveMentionsResult>;
  search(args: ThreadSearchArgs): Promise<ThreadSearchResult>;
  send(args: ThreadSendArgs): Promise<ThreadSendResult>;
  spawn(args: ThreadSpawnArgs): Promise<ThreadSpawnResult>;
  /**
   * Stop active work and release the loaded agent runtime. This operation is
   * idempotent and preserves thread history for a later resume.
   */
  stop(args: ThreadActionArgs): Promise<ThreadStopResult>;
  tabs: ThreadTabsArea;
  timeline(args: ThreadTimelineArgs): Promise<ThreadTimelineResult>;
  timelineTurnSummaryDetails(
    args: ThreadTimelineTurnSummaryDetailsArgs,
  ): Promise<ThreadTimelineTurnSummaryDetailsResult>;
  storageFiles(args: ThreadStorageFilesArgs): Promise<ThreadStorageFilesResult>;
  storagePaths(args: ThreadStoragePathsArgs): Promise<ThreadStoragePathsResult>;
  unarchive(args: ThreadActionArgs): Promise<ThreadUnarchiveResult>;
  unpin(args: ThreadActionArgs): Promise<ThreadMutationResult>;
  update(args: ThreadUpdateArgs): Promise<ThreadMutationResult>;
  wait(args: ThreadWaitArgs): Promise<ThreadWaitResult>;
}

function listQuery(args: ThreadListArgs | undefined): ThreadListQuery {
  return {
    ...(args?.projectId ? { projectId: args.projectId } : {}),
    ...(args?.parentThreadId ? { parentThreadId: args.parentThreadId } : {}),
    ...(args?.sourceThreadId ? { sourceThreadId: args.sourceThreadId } : {}),
    ...(args?.sectionId ? { sectionId: args.sectionId } : {}),
    ...(args?.originKind ? { originKind: args.originKind } : {}),
    ...(args?.originPluginId ? { originPluginId: args.originPluginId } : {}),
    ...(args?.archived === undefined
      ? {}
      : { archived: args.archived ? "true" : "false" }),
    ...(args?.unsectioned === undefined
      ? {}
      : { unsectioned: args.unsectioned ? "true" : "false" }),
    ...(args?.includeHidden === undefined
      ? {}
      : { includeHidden: args.includeHidden ? "true" : "false" }),
    ...(args?.limit === undefined ? {} : { limit: String(args.limit) }),
    ...(args?.offset === undefined ? {} : { offset: String(args.offset) }),
    ...(args?.hasParent === undefined
      ? {}
      : { hasParent: args.hasParent ? "true" : "false" }),
  };
}

function updateJson(args: ThreadUpdateArgs): UpdateThreadRequest {
  return {
    title: args.title,
    sectionId: args.sectionId,
    parentThreadId: args.parentThreadId,
    model: args.model,
    reasoningLevel: args.reasoningLevel,
    visibility: args.visibility,
  };
}

function sendJson(args: ThreadSendArgs): SendMessageRequest {
  return {
    input: args.input,
    mode: args.mode,
    model: args.model,
    permissionMode: args.permissionMode,
    reasoningLevel: args.reasoningLevel,
    senderThreadId: args.senderThreadId,
    serviceTier: args.serviceTier,
    executionInputSources: args.executionInputSources,
  };
}

function spawnInput(input: ThreadSpawnArgs): PromptInput[] {
  if (input.input !== undefined && input.prompt !== undefined) {
    throw new Error("Provide only one of input or prompt.");
  }
  if (input.input !== undefined) {
    return input.input;
  }
  return [{ type: "text", text: input.prompt, mentions: [] }];
}

function spawnJson(args: ThreadSpawnArgs): CreateThreadRequest {
  const {
    input: _input,
    origin,
    originKind,
    prompt: _prompt,
    startedOnBehalfOf,
    ...request
  } = args;
  return {
    ...request,
    input: spawnInput(args),
    origin: origin ?? "sdk",
    startedOnBehalfOf: startedOnBehalfOf ?? null,
    originKind: originKind ?? null,
  };
}

function forkJson(args: ThreadForkArgs): ForkThreadRequest {
  return {
    ...args,
    origin: args.origin ?? "sdk",
    visibility: args.visibility ?? "visible",
    workspace: args.workspace ?? "isolated",
  };
}

function eventsListQuery(args: ThreadEventsListArgs): ThreadEventsQuery {
  return {
    ...(args.afterSeq !== undefined ? { afterSeq: args.afterSeq } : {}),
    ...(args.beforeSeq !== undefined ? { beforeSeq: args.beforeSeq } : {}),
    ...(args.limit !== undefined ? { limit: args.limit } : {}),
    ...(args.order !== undefined ? { order: args.order } : {}),
    ...(args.types !== undefined ? { types: args.types.join(",") } : {}),
  };
}

function eventWaitQuery(args: ThreadEventWaitArgs): ThreadEventWaitQuery {
  return {
    ...(args.afterSeq !== undefined ? { afterSeq: args.afterSeq } : {}),
    type: args.type,
    waitMs: args.waitMs,
  };
}

function searchQuery(args: ThreadSearchArgs): ThreadSearchQuery {
  return {
    limitPerGroup: args.limitPerGroup,
    query: args.query,
  };
}

function timelineQuery(args: ThreadTimelineArgs): ThreadTimelineQuery {
  return {
    ...(args.includeNestedRows !== undefined
      ? { includeNestedRows: args.includeNestedRows }
      : {}),
    ...(args.summaryOnly !== undefined
      ? { summaryOnly: args.summaryOnly }
      : {}),
    ...(args.segmentLimit !== undefined
      ? { segmentLimit: args.segmentLimit }
      : {}),
    ...(args.beforeAnchorSeq !== undefined
      ? { beforeAnchorSeq: args.beforeAnchorSeq }
      : {}),
    ...(args.beforeAnchorId !== undefined
      ? { beforeAnchorId: args.beforeAnchorId }
      : {}),
    ...(args.afterSequence !== undefined
      ? { afterSequence: args.afterSequence }
      : {}),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveThreadWaitTarget(args: ThreadWaitArgs): ThreadWaitTarget {
  const hasStatus = args.status !== undefined;
  const hasEvent = args.event !== undefined;
  if (hasStatus && hasEvent) {
    throw new Error("Provide only one of status or event.");
  }
  if (hasEvent) {
    return { kind: "event", eventType: args.event ?? "" };
  }
  return { kind: "status", status: args.status ?? "idle" };
}

function validateThreadWaitArgs(args: ThreadWaitArgs): {
  pollIntervalMs: number;
  target: ThreadWaitTarget;
  timeoutMs: number;
} {
  const timeoutMs = args.timeoutMs ?? DEFAULT_THREAD_WAIT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new RangeError(
      "Timeout must be a non-negative number of milliseconds.",
    );
  }
  const pollIntervalMs =
    args.pollIntervalMs ?? DEFAULT_THREAD_WAIT_POLL_INTERVAL_MS;
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 1) {
    throw new RangeError(
      "Poll interval must be a positive integer number of milliseconds.",
    );
  }
  return {
    pollIntervalMs,
    target: resolveThreadWaitTarget(args),
    timeoutMs,
  };
}

function formatThreadWaitTimeoutMessage(args: {
  target: ThreadWaitTarget;
  threadId: string;
}): string {
  if (args.target.kind === "status") {
    return `Timed out waiting for thread ${args.threadId} to reach status ${args.target.status}.`;
  }
  return `Timed out waiting for thread ${args.threadId} event ${args.target.eventType}.`;
}

function isThreadWaitTargetUnreachable(
  currentStatus: ThreadStatus,
  target: ThreadWaitTarget,
): target is Extract<ThreadWaitTarget, { kind: "status" }> {
  return (
    target.kind === "status" &&
    target.status === "idle" &&
    currentStatus === "error"
  );
}

export function createThreadsArea(args: CreateSdkAreaArgs): ThreadsArea {
  const { transport } = args;
  const getThread = (input: ThreadGetArgs) =>
    transport.readJson(
      transport.api.v1.threads[":id"].$get(
        {
          param: { id: input.threadId },
          ...(input.include === undefined
            ? {}
            : { query: { include: input.include } }),
        },
        ...signalRequestArgs(input.signal),
      ),
    );
  const events: ThreadEventsArea = {
    async list(input) {
      return transport.readJson(
        transport.api.v1.threads[":id"].events.$get(
          {
            param: { id: input.threadId },
            query: eventsListQuery(input),
          },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async wait(input) {
      const response = await transport.resolve(
        transport.api.v1.threads[":id"].events.wait.$get(
          {
            param: { id: input.threadId },
            query: eventWaitQuery(input),
          },
          ...signalRequestArgs(input.signal),
        ),
      );
      const statusCode: number = response.status;
      if (statusCode === 204) {
        return null;
      }
      return parseThreadEventRow(await response.json());
    },
  };
  const interactions: ThreadInteractionsArea = {
    async cancel(input) {
      return transport.readJson(
        transport.api.v1.threads[":id"].interactions[
          ":interactionId"
        ].cancel.$post({
          param: { id: input.threadId, interactionId: input.interactionId },
        }),
      );
    },
    async get(input) {
      return transport.readJson(
        transport.api.v1.threads[":id"].interactions[":interactionId"].$get(
          {
            param: {
              id: input.threadId,
              interactionId: input.interactionId,
            },
          },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async list(input) {
      return transport.readJson(
        transport.api.v1.threads[":id"].interactions.$get(
          { param: { id: input.threadId } },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async resolve(input) {
      return transport.readJson(
        transport.api.v1.threads[":id"].interactions[
          ":interactionId"
        ].resolve.$post({
          param: {
            id: input.threadId,
            interactionId: input.interactionId,
          },
          json: input.resolution,
        }),
      );
    },
    async respond(input) {
      return transport.readJson(
        transport.api.v1.threads[":id"].interactions[
          ":interactionId"
        ].respond.$post({
          param: { id: input.threadId, interactionId: input.interactionId },
          json: { value: input.value },
        }),
      );
    },
  };
  const queuedMessages: ThreadQueuedMessagesArea = {
    async create(input) {
      const { threadId, ...json } = input;
      return transport.readJson(
        transport.api.v1.threads[":id"]["queued-messages"].$post({
          param: { id: threadId },
          json,
        }),
      );
    },
    async delete(input) {
      await transport.readVoid(
        transport.api.v1.threads[":id"]["queued-messages"][
          ":queuedMessageId"
        ].$delete({
          param: {
            id: input.threadId,
            queuedMessageId: input.queuedMessageId,
          },
        }),
      );
      return { ok: true };
    },
    async list(input) {
      return transport.readJson(
        transport.api.v1.threads[":id"]["queued-messages"].$get(
          { param: { id: input.threadId } },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async reorder(input) {
      return transport.readJson(
        transport.api.v1.threads[":id"]["queued-messages"][
          ":queuedMessageId"
        ].order.$patch({
          param: {
            id: input.threadId,
            queuedMessageId: input.queuedMessageId,
          },
          json: {
            previousQueuedMessageId: input.previousQueuedMessageId,
            nextQueuedMessageId: input.nextQueuedMessageId,
            groupBoundaryQueuedMessageId: input.groupBoundaryQueuedMessageId,
          },
        }),
      );
    },
    async send(input) {
      return transport.readJson(
        transport.api.v1.threads[":id"]["queued-messages"][
          ":queuedMessageId"
        ].send.$post({
          param: {
            id: input.threadId,
            queuedMessageId: input.queuedMessageId,
          },
          json: { mode: input.mode },
        }),
      );
    },
    async setGroupBoundary(input) {
      return transport.readJson(
        transport.api.v1.threads[":id"]["queued-messages"][
          "group-boundary"
        ].$patch({
          param: { id: input.threadId },
          json: {
            expectedGroupedPrefixQueuedMessageIds:
              input.expectedGroupedPrefixQueuedMessageIds,
            groupBoundaryQueuedMessageId: input.groupBoundaryQueuedMessageId,
          },
        }),
      );
    },
    async update(input) {
      const { queuedMessageId, threadId, ...json } = input;
      return transport.readJson(
        transport.api.v1.threads[":id"]["queued-messages"][
          ":queuedMessageId"
        ].$patch({
          param: { id: threadId, queuedMessageId },
          json,
        }),
      );
    },
  };
  const tabs: ThreadTabsArea = {
    async get(input) {
      const body = await transport.readJson(
        transport.api.v1.threads[":id"].tabs.$get(
          { param: { id: input.threadId } },
          ...signalRequestArgs(input.signal),
        ),
      );
      return threadTabsResponseSchema.parse(body);
    },
    async update(input) {
      const body = await transport.readJson(
        transport.api.v1.threads[":id"].tabs.$put({
          param: { id: input.threadId },
          json: {
            expectedRevision: input.expectedRevision,
            tabs: input.tabs,
          },
        }),
      );
      return threadTabsResponseSchema.parse(body);
    },
  };
  return {
    async archive(input) {
      // Match the UI: archiving a parent also archives assigned children and
      // source-derived side chats via the cascade archive-all route.
      return transport.readJson(
        transport.api.v1.threads[":id"]["archive-all"].$post({
          param: { id: input.threadId },
        }),
      );
    },
    async archiveAll(input) {
      return transport.readJson(
        transport.api.v1.threads[":id"]["archive-all"].$post({
          param: { id: input.threadId },
        }),
      );
    },
    async childSummary(input) {
      return transport.readJson(
        transport.api.v1.threads[":id"]["child-summary"].$get(
          { param: { id: input.threadId } },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async conversationOutline(input) {
      return transport.readJson(
        transport.api.v1.threads[":id"]["conversation-outline"].$get(
          { param: { id: input.threadId } },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async defaultExecutionOptions(input) {
      return transport.readJson(
        transport.api.v1.threads[":id"]["default-execution-options"].$get(
          { param: { id: input.threadId } },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async delete(input) {
      await transport.readVoid(
        transport.api.v1.threads[":id"].$delete({
          param: { id: input.threadId },
          json: {
            childThreadsConfirmed: input.childThreadsConfirmed,
          },
        }),
      );
      return { ok: true };
    },
    async editMessage(input) {
      const { threadId, ...json } = input;
      return transport.readJson(
        transport.api.v1.threads[":id"]["edit-message"].$post({
          param: { id: threadId },
          json,
        }),
      );
    },
    events,
    async fork(input) {
      return transport.readJson(
        transport.api.v1.threads.fork.$post({
          json: forkJson(input),
        }),
      );
    },
    get: getThread,
    interactions,
    async list(input) {
      return transport.readJson(
        transport.api.v1.threads.$get(
          { query: listQuery(input) },
          ...signalRequestArgs(input?.signal),
        ),
      );
    },
    async markRead(input) {
      return transport.readJson(
        transport.api.v1.threads[":id"].read.$post({
          param: { id: input.threadId },
        }),
      );
    },
    async markUnread(input) {
      return transport.readJson(
        transport.api.v1.threads[":id"].unread.$post({
          param: { id: input.threadId },
        }),
      );
    },
    async output(input) {
      return transport.readJson(
        transport.api.v1.threads[":id"].output.$get(
          { param: { id: input.threadId } },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async open(input) {
      return transport.readJson(
        transport.api.v1.threads[":id"].open.$post({
          param: { id: input.threadId },
          json: {
            ...(input.split === undefined ? {} : { split: input.split }),
            file: input.file,
          },
        }),
      );
    },
    async paneAction(input) {
      return transport.readJson(
        transport.api.v1.threads[":id"]["pane-action"].$post({
          param: { id: input.threadId },
          json: { action: input.action },
        }),
      );
    },
    async pin(input) {
      return transport.readJson(
        transport.api.v1.threads[":id"].pin.$post({
          param: { id: input.threadId },
        }),
      );
    },
    async promptHistory(input) {
      return transport.readJson(
        transport.api.v1.threads[":id"]["prompt-history"].$get(
          {
            param: { id: input.threadId },
            query: { limit: input.limit },
          },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    queuedMessages,
    async reorderPinned(input) {
      return transport.readJson(
        transport.api.v1.threads[":id"]["pin-order"].$patch({
          param: { id: input.threadId },
          json: {
            previousThreadId: input.previousThreadId,
            nextThreadId: input.nextThreadId,
          },
        }),
      );
    },
    async resolveMentions(input) {
      return transport.readJson(
        transport.api.v1.threads["resolve-mentions"].$post(
          { json: { threadIds: input.threadIds } },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async search(input) {
      return transport.readJson(
        transport.api.v1.threads.search.$get(
          { query: searchQuery(input) },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async send(input) {
      await transport.readVoid(
        transport.api.v1.threads[":id"].send.$post({
          param: { id: input.threadId },
          json: sendJson(input),
        }),
      );
      return { ok: true };
    },
    async spawn(input) {
      return transport.readJson(
        transport.api.v1.threads.$post({
          json: spawnJson(input),
        }),
      );
    },
    async stop(input) {
      await transport.readVoid(
        transport.api.v1.threads[":id"].stop.$post({
          param: { id: input.threadId },
        }),
      );
      return { ok: true };
    },
    async compact(input) {
      await transport.readVoid(
        transport.api.v1.threads[":id"].compact.$post({
          param: { id: input.threadId },
        }),
      );
      return { ok: true };
    },
    async cancelPlan(input) {
      await transport.readVoid(
        transport.api.v1.threads[":id"].plan.cancel.$post({
          param: { id: input.threadId },
        }),
      );
      return { ok: true };
    },
    async clearGoal(input) {
      await transport.readVoid(
        transport.api.v1.threads[":id"].goal.clear.$post({
          param: { id: input.threadId },
        }),
      );
      return { ok: true };
    },
    tabs,
    async timeline(input) {
      return transport.readJson(
        transport.api.v1.threads[":id"].timeline.$get(
          {
            param: { id: input.threadId },
            query: timelineQuery(input),
          },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async timelineTurnSummaryDetails(input) {
      return transport.readJson(
        transport.api.v1.threads[":id"].timeline["turn-summary-details"].$get(
          {
            param: { id: input.threadId },
            query: {
              turnId: input.turnId,
              sourceSeqStart: input.sourceSeqStart,
              sourceSeqEnd: input.sourceSeqEnd,
            },
          },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async storageFiles(input) {
      return transport.readJson(
        transport.api.v1.threads[":id"]["thread-storage"].files.$get(
          {
            param: { id: input.threadId },
            query: { query: input.query, limit: input.limit },
          },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async storagePaths(input) {
      return transport.readJson(
        transport.api.v1.threads[":id"]["thread-storage"].paths.$get(
          {
            param: { id: input.threadId },
            query: {
              query: input.query,
              limit: input.limit,
              includeFiles: input.includeFiles,
              includeDirectories: input.includeDirectories,
            },
          },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async unarchive(input) {
      await transport.readVoid(
        transport.api.v1.threads[":id"].unarchive.$post({
          param: { id: input.threadId },
        }),
      );
      return { ok: true };
    },
    async unpin(input) {
      return transport.readJson(
        transport.api.v1.threads[":id"].unpin.$post({
          param: { id: input.threadId },
        }),
      );
    },
    async update(input) {
      return transport.readJson(
        transport.api.v1.threads[":id"].$patch({
          param: { id: input.threadId },
          json: updateJson(input),
        }),
      );
    },
    async wait(input) {
      const { pollIntervalMs, target, timeoutMs } =
        validateThreadWaitArgs(input);
      const deadline = Date.now() + timeoutMs;
      while (true) {
        if (target.kind === "status") {
          const thread = await getThread({
            signal: input.signal,
            threadId: input.threadId,
          });
          if (thread.status === target.status) {
            return {
              matched: true,
              target,
              thread,
              threadId: input.threadId,
            };
          }
          if (isThreadWaitTargetUnreachable(thread.status, target)) {
            throw new ThreadWaitUnreachableError({
              currentStatus: thread.status,
              target,
              threadId: input.threadId,
            });
          }
          if (Date.now() >= deadline) {
            throw new ThreadWaitTimeoutError({
              target,
              threadId: input.threadId,
            });
          }
          await sleep(pollIntervalMs);
          continue;
        }

        const remainingMs = Math.max(0, deadline - Date.now());
        const waitMs = Math.floor(Math.min(remainingMs, 30_000));
        const event = await events.wait({
          signal: input.signal,
          threadId: input.threadId,
          type: target.eventType,
          waitMs: String(waitMs),
        });
        if (event !== null) {
          return {
            event,
            matched: true,
            target,
            threadId: input.threadId,
          };
        }
        if (Date.now() >= deadline) {
          throw new ThreadWaitTimeoutError({
            target,
            threadId: input.threadId,
          });
        }
        await sleep(pollIntervalMs);
      }
    },
  };
}
