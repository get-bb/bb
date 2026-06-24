import {
  parseThreadEventRow,
  type PromptInput,
  type PendingInteractionResolution,
  type ThreadStatus,
} from "@bb/domain";
import type {
  CloseTerminalRequest,
  CreateTerminalRequest,
  CreateThreadRequest,
  DeleteThreadRequest,
  PanelFileSource,
  SendMessageRequest,
  TerminalInputRequest,
  TerminalOutputQuery,
  TerminalResizeRequest,
  ThreadEventsQuery,
  ThreadEventWaitQuery,
  ThreadGetQuery,
  ThreadListQuery,
  ThreadTimelineQuery,
  UpdateTerminalRequest,
  UpdateThreadRequest,
} from "@bb/server-contract";
import type { CreateSdkAreaArgs, PublicApiOutput } from "./common.js";

export const DEFAULT_THREAD_WAIT_TIMEOUT_MS = 30_000;
export const DEFAULT_THREAD_WAIT_POLL_INTERVAL_MS = 250;

export interface ThreadListArgs {
  archived?: boolean;
  hasParent?: boolean;
  parentThreadId?: string;
  projectId?: string;
}

export interface ThreadGetArgs {
  include?: ThreadGetQuery["include"];
  threadId: string;
}

export type ThreadGetResult = PublicApiOutput<"/threads/:id", "$get">;
export type ThreadListResult = PublicApiOutput<"/threads", "$get">;
export type ThreadOutputResponse = PublicApiOutput<
  "/threads/:id/output",
  "$get"
>;
export type ThreadMutationResult = PublicApiOutput<"/threads/:id", "$patch">;
export type ThreadSpawnResult = PublicApiOutput<"/threads", "$post">;
export type ThreadInteractionGetResult = PublicApiOutput<
  "/threads/:id/interactions/:interactionId",
  "$get"
>;
export type ThreadInteractionListResult = PublicApiOutput<
  "/threads/:id/interactions",
  "$get"
>;
export type ThreadInteractionResolveResult = PublicApiOutput<
  "/threads/:id/interactions/:interactionId/resolve",
  "$post"
>;
export type ThreadEventsListResult = PublicApiOutput<
  "/threads/:id/events",
  "$get"
>;
export type ThreadEventWaitResult = PublicApiOutput<
  "/threads/:id/events/wait",
  "$get"
>;
export type ThreadTimelineResult = PublicApiOutput<
  "/threads/:id/timeline",
  "$get"
>;
export type ThreadArchiveResult = PublicApiOutput<
  "/threads/:id/archive",
  "$post"
>;
export type ThreadOpenResult = PublicApiOutput<"/threads/:id/open", "$post">;
export type ThreadDeleteResult = PublicApiOutput<"/threads/:id", "$delete">;
export type ThreadSendResult = PublicApiOutput<"/threads/:id/send", "$post">;
export type ThreadStopResult = PublicApiOutput<"/threads/:id/stop", "$post">;
export type ThreadTerminalCloseResult = PublicApiOutput<
  "/terminals/:terminalId/close",
  "$post"
>;
export type ThreadTerminalCreateResult = PublicApiOutput<"/terminals", "$post">;
export type ThreadTerminalInputResult = PublicApiOutput<
  "/terminals/:terminalId/input",
  "$post"
>;
export type ThreadTerminalListResult = PublicApiOutput<"/terminals", "$get">;
export type ThreadTerminalOutputResult = PublicApiOutput<
  "/terminals/:terminalId/output",
  "$get"
>;
export type ThreadTerminalResizeResult = PublicApiOutput<
  "/terminals/:terminalId/resize",
  "$post"
>;
export type ThreadTerminalUpdateResult = PublicApiOutput<
  "/terminals/:terminalId",
  "$patch"
>;
export type ThreadUnarchiveResult = PublicApiOutput<
  "/threads/:id/unarchive",
  "$post"
>;

export interface ThreadSpawnBaseArgs extends Omit<
  CreateThreadRequest,
  "childOrigin" | "input" | "origin" | "originKind" | "startedOnBehalfOf"
> {
  childOrigin?: CreateThreadRequest["childOrigin"];
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

export interface ThreadUpdateArgs extends UpdateThreadRequest {
  threadId: string;
}

export interface ThreadDeleteArgs extends DeleteThreadRequest {
  threadId: string;
}

export interface ThreadSendArgs extends SendMessageRequest {
  threadId: string;
}

export interface ThreadStatusArgs {
  threadId: string;
}

export interface ThreadOpenArgs {
  threadId: string;
  source: PanelFileSource;
  path: string;
  lineNumber: number | null;
}

export interface ThreadEventsListArgs {
  afterSeq?: string;
  limit?: string;
  threadId: string;
}

export interface ThreadEventWaitArgs {
  afterSeq?: string;
  threadId: string;
  type: string;
  waitMs: string;
}

export interface ThreadTimelineArgs extends ThreadTimelineQuery {
  threadId: string;
}

export interface ThreadOutputArgs {
  threadId: string;
}

export interface ThreadTerminalListArgs {
  threadId: string;
}

export interface ThreadTerminalCreateArgs extends Omit<
  CreateTerminalRequest,
  "target"
> {
  threadId: string;
}

export interface ThreadTerminalTargetArgs {
  terminalId: string;
  threadId: string;
}

export interface ThreadTerminalUpdateArgs
  extends ThreadTerminalTargetArgs, UpdateTerminalRequest {}

export interface ThreadTerminalCloseArgs
  extends ThreadTerminalTargetArgs, CloseTerminalRequest {}

export interface ThreadTerminalInputArgs
  extends ThreadTerminalTargetArgs, TerminalInputRequest {}

export interface ThreadTerminalResizeArgs
  extends ThreadTerminalTargetArgs, TerminalResizeRequest {}

export interface ThreadTerminalOutputArgs
  extends ThreadTerminalTargetArgs, TerminalOutputQuery {}

export interface ThreadInteractionListArgs {
  threadId: string;
}

export interface ThreadInteractionGetArgs extends ThreadInteractionListArgs {
  interactionId: string;
}

export interface ThreadInteractionResolveArgs extends ThreadInteractionGetArgs {
  resolution: PendingInteractionResolution;
}

export type ThreadWaitTarget =
  | { kind: "status"; status: ThreadStatus }
  | { kind: "event"; eventType: string };

export interface ThreadWaitArgs {
  event?: string;
  pollIntervalMs?: number;
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
  get(args: ThreadInteractionGetArgs): Promise<ThreadInteractionGetResult>;
  list(args: ThreadInteractionListArgs): Promise<ThreadInteractionListResult>;
  resolve(
    args: ThreadInteractionResolveArgs,
  ): Promise<ThreadInteractionResolveResult>;
}

export interface ThreadEventsArea {
  list(args: ThreadEventsListArgs): Promise<ThreadEventsListResult>;
  wait(args: ThreadEventWaitArgs): Promise<ThreadEventWaitResult>;
}

export interface ThreadTerminalsArea {
  close(args: ThreadTerminalCloseArgs): Promise<ThreadTerminalCloseResult>;
  create(args: ThreadTerminalCreateArgs): Promise<ThreadTerminalCreateResult>;
  input(args: ThreadTerminalInputArgs): Promise<ThreadTerminalInputResult>;
  list(args: ThreadTerminalListArgs): Promise<ThreadTerminalListResult>;
  output(args: ThreadTerminalOutputArgs): Promise<ThreadTerminalOutputResult>;
  resize(args: ThreadTerminalResizeArgs): Promise<ThreadTerminalResizeResult>;
  update(args: ThreadTerminalUpdateArgs): Promise<ThreadTerminalUpdateResult>;
}

export interface ThreadsArea {
  archive(args: ThreadStatusArgs): Promise<ThreadArchiveResult>;
  delete(args: ThreadDeleteArgs): Promise<ThreadDeleteResult>;
  events: ThreadEventsArea;
  get(args: ThreadGetArgs): Promise<ThreadGetResult>;
  interactions: ThreadInteractionsArea;
  list(args?: ThreadListArgs): Promise<ThreadListResult>;
  open(args: ThreadOpenArgs): Promise<ThreadOpenResult>;
  output(args: ThreadOutputArgs): Promise<ThreadOutputResponse>;
  pin(args: ThreadStatusArgs): Promise<ThreadMutationResult>;
  send(args: ThreadSendArgs): Promise<ThreadSendResult>;
  spawn(args: ThreadSpawnArgs): Promise<ThreadSpawnResult>;
  stop(args: ThreadStatusArgs): Promise<ThreadStopResult>;
  terminals: ThreadTerminalsArea;
  timeline(args: ThreadTimelineArgs): Promise<ThreadTimelineResult>;
  unarchive(args: ThreadStatusArgs): Promise<ThreadUnarchiveResult>;
  unpin(args: ThreadStatusArgs): Promise<ThreadMutationResult>;
  update(args: ThreadUpdateArgs): Promise<ThreadMutationResult>;
  wait(args: ThreadWaitArgs): Promise<ThreadWaitResult>;
}

function listQuery(args: ThreadListArgs | undefined): ThreadListQuery {
  return {
    ...(args?.projectId ? { projectId: args.projectId } : {}),
    ...(args?.parentThreadId ? { parentThreadId: args.parentThreadId } : {}),
    ...(args?.archived ? { archived: "true" } : {}),
    ...(args?.hasParent === undefined
      ? {}
      : { hasParent: args.hasParent ? "true" : "false" }),
  };
}

function updateJson(args: ThreadUpdateArgs): UpdateThreadRequest {
  return {
    title: args.title,
    parentThreadId: args.parentThreadId,
    model: args.model,
    reasoningLevel: args.reasoningLevel,
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
    childOrigin,
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
    childOrigin: childOrigin ?? null,
  };
}

function eventsListQuery(args: ThreadEventsListArgs): ThreadEventsQuery {
  return {
    ...(args.afterSeq !== undefined ? { afterSeq: args.afterSeq } : {}),
    ...(args.limit !== undefined ? { limit: args.limit } : {}),
  };
}

function eventWaitQuery(args: ThreadEventWaitArgs): ThreadEventWaitQuery {
  return {
    ...(args.afterSeq !== undefined ? { afterSeq: args.afterSeq } : {}),
    type: args.type,
    waitMs: args.waitMs,
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
  };
}

function terminalOutputQuery(
  args: ThreadTerminalOutputArgs,
): TerminalOutputQuery {
  return {
    ...(args.sinceSeq !== undefined ? { sinceSeq: args.sinceSeq } : {}),
    ...(args.tailBytes !== undefined ? { tailBytes: args.tailBytes } : {}),
    ...(args.limitChunks !== undefined
      ? { limitChunks: args.limitChunks }
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
      transport.api.v1.threads[":id"].$get({
        param: { id: input.threadId },
        ...(input.include === undefined
          ? {}
          : { query: { include: input.include } }),
      }),
    );
  const events: ThreadEventsArea = {
    async list(input) {
      return transport.readJson(
        transport.api.v1.threads[":id"].events.$get({
          param: { id: input.threadId },
          query: eventsListQuery(input),
        }),
      );
    },
    async wait(input) {
      const response = await transport.resolve(
        transport.api.v1.threads[":id"].events.wait.$get({
          param: { id: input.threadId },
          query: eventWaitQuery(input),
        }),
      );
      const statusCode: number = response.status;
      if (statusCode === 204) {
        return null;
      }
      return parseThreadEventRow(await response.json());
    },
  };
  const interactions: ThreadInteractionsArea = {
    async get(input) {
      return transport.readJson(
        transport.api.v1.threads[":id"].interactions[":interactionId"].$get({
          param: {
            id: input.threadId,
            interactionId: input.interactionId,
          },
        }),
      );
    },
    async list(input) {
      return transport.readJson(
        transport.api.v1.threads[":id"].interactions.$get({
          param: { id: input.threadId },
        }),
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
  };
  const terminals: ThreadTerminalsArea = {
    async close(input) {
      return transport.readJson(
        transport.api.v1.terminals[":terminalId"].close.$post({
          param: { terminalId: input.terminalId },
          json: { mode: input.mode, reason: input.reason },
        }),
      );
    },
    async create(input) {
      return transport.readJson(
        transport.api.v1.terminals.$post({
          json: {
            cols: input.cols,
            rows: input.rows,
            title: input.title,
            start: input.start,
            target: { kind: "thread", threadId: input.threadId },
          },
        }),
      );
    },
    async input(input) {
      return transport.readJson(
        transport.api.v1.terminals[":terminalId"].input.$post({
          param: { terminalId: input.terminalId },
          json: { dataBase64: input.dataBase64 },
        }),
      );
    },
    async list(input) {
      return transport.readJson(
        transport.api.v1.terminals.$get({
          query: { threadId: input.threadId },
        }),
      );
    },
    async output(input) {
      return transport.readJson(
        transport.api.v1.terminals[":terminalId"].output.$get({
          param: { terminalId: input.terminalId },
          query: terminalOutputQuery(input),
        }),
      );
    },
    async resize(input) {
      return transport.readJson(
        transport.api.v1.terminals[":terminalId"].resize.$post({
          param: { terminalId: input.terminalId },
          json: { cols: input.cols, rows: input.rows },
        }),
      );
    },
    async update(input) {
      return transport.readJson(
        transport.api.v1.terminals[":terminalId"].$patch({
          param: { terminalId: input.terminalId },
          json: { title: input.title },
        }),
      );
    },
  };
  return {
    async archive(input) {
      await transport.readVoid(
        transport.api.v1.threads[":id"].archive.$post({
          param: { id: input.threadId },
        }),
      );
      return { ok: true };
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
    events,
    get: getThread,
    interactions,
    async list(input) {
      return transport.readJson(
        transport.api.v1.threads.$get({ query: listQuery(input) }),
      );
    },
    async output(input) {
      return transport.readJson(
        transport.api.v1.threads[":id"].output.$get({
          param: { id: input.threadId },
        }),
      );
    },
    async open(input) {
      return transport.readJson(
        transport.api.v1.threads[":id"].open.$post({
          param: { id: input.threadId },
          json: {
            source: input.source,
            path: input.path,
            lineNumber: input.lineNumber,
          },
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
    terminals,
    async timeline(input) {
      return transport.readJson(
        transport.api.v1.threads[":id"].timeline.$get({
          param: { id: input.threadId },
          query: timelineQuery(input),
        }),
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
          const thread = await getThread({ threadId: input.threadId });
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
