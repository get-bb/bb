import {
  parseThreadEventRow,
  type PendingInteraction,
  type PendingInteractionResolution,
  type Thread,
  type ThreadEventRow,
} from "@bb/domain";
import type {
  CreateThreadRequest,
  DeleteThreadRequest,
  SendMessageRequest,
  ThreadEventsQuery,
  ThreadEventWaitQuery,
  ThreadGetQuery,
  ThreadListQuery,
  ThreadResponse,
  ThreadTimelineQuery,
  ThreadTimelineResponse,
  ThreadWithIncludesResponse,
  UpdateThreadRequest,
} from "@bb/server-contract";
import type { CreateSdkAreaArgs, OkResponse } from "./common.js";

export interface ThreadListArgs {
  archived?: boolean;
  parentThreadId?: string;
  projectId?: string;
  type?: "manager" | "standard";
}

export interface ThreadGetArgs {
  include?: ThreadGetQuery["include"];
  threadId: string;
}

export type ThreadGetResult = ThreadResponse | ThreadWithIncludesResponse;

export interface ThreadSpawnArgs extends CreateThreadRequest {}

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

export interface ThreadEventsListArgs {
  afterSeq?: string;
  limit?: string;
  threadId: string;
}

export interface ThreadEventWaitArgs {
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

export interface ThreadOutputResponse {
  output: string | null;
}

export interface ThreadInteractionListArgs {
  threadId: string;
}

export interface ThreadInteractionGetArgs extends ThreadInteractionListArgs {
  interactionId: string;
}

export interface ThreadInteractionResolveArgs
  extends ThreadInteractionGetArgs {
  resolution: PendingInteractionResolution;
}

export interface ThreadInteractionsArea {
  get(args: ThreadInteractionGetArgs): Promise<PendingInteraction>;
  list(args: ThreadInteractionListArgs): Promise<PendingInteraction[]>;
  resolve(args: ThreadInteractionResolveArgs): Promise<PendingInteraction>;
}

export interface ThreadEventsArea {
  list(args: ThreadEventsListArgs): Promise<ThreadEventRow[]>;
  wait(args: ThreadEventWaitArgs): Promise<ThreadEventRow | null>;
}

export interface ThreadsArea {
  archive(args: ThreadStatusArgs): Promise<OkResponse>;
  delete(args: ThreadDeleteArgs): Promise<OkResponse>;
  events: ThreadEventsArea;
  get(args: ThreadGetArgs): Promise<ThreadGetResult>;
  interactions: ThreadInteractionsArea;
  list(args?: ThreadListArgs): Promise<Thread[]>;
  output(args: ThreadOutputArgs): Promise<ThreadOutputResponse>;
  pin(args: ThreadStatusArgs): Promise<Thread>;
  send(args: ThreadSendArgs): Promise<OkResponse>;
  spawn(args: ThreadSpawnArgs): Promise<Thread>;
  stop(args: ThreadStatusArgs): Promise<OkResponse>;
  timeline(args: ThreadTimelineArgs): Promise<ThreadTimelineResponse>;
  unarchive(args: ThreadStatusArgs): Promise<OkResponse>;
  unpin(args: ThreadStatusArgs): Promise<Thread>;
  update(args: ThreadUpdateArgs): Promise<Thread>;
}

function listQuery(args: ThreadListArgs | undefined): ThreadListQuery {
  return {
    ...(args?.projectId ? { projectId: args.projectId } : {}),
    ...(args?.parentThreadId ? { parentThreadId: args.parentThreadId } : {}),
    ...(args?.archived ? { archived: "true" } : {}),
    ...(args?.type ? { type: args.type } : {}),
  };
}

function updateJson(args: ThreadUpdateArgs): UpdateThreadRequest {
  return {
    ...(args.title !== undefined ? { title: args.title } : {}),
    ...(args.parentThreadId !== undefined
      ? { parentThreadId: args.parentThreadId }
      : {}),
    ...(args.model !== undefined ? { model: args.model } : {}),
    ...(args.reasoningLevel !== undefined
      ? { reasoningLevel: args.reasoningLevel }
      : {}),
  };
}

function sendJson(args: ThreadSendArgs): SendMessageRequest {
  return {
    input: args.input,
    mode: args.mode,
    ...(args.model !== undefined ? { model: args.model } : {}),
    ...(args.permissionMode !== undefined
      ? { permissionMode: args.permissionMode }
      : {}),
    ...(args.reasoningLevel !== undefined
      ? { reasoningLevel: args.reasoningLevel }
      : {}),
    ...(args.senderThreadId !== undefined
      ? { senderThreadId: args.senderThreadId }
      : {}),
    ...(args.serviceTier !== undefined ? { serviceTier: args.serviceTier } : {}),
    ...(args.executionInputSources !== undefined
      ? { executionInputSources: args.executionInputSources }
      : {}),
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
    type: args.type,
    waitMs: args.waitMs,
  };
}

function timelineQuery(args: ThreadTimelineArgs): ThreadTimelineQuery {
  return {
    ...(args.includeNestedRows !== undefined
      ? { includeNestedRows: args.includeNestedRows }
      : {}),
    ...(args.managerTimelineView !== undefined
      ? { managerTimelineView: args.managerTimelineView }
      : {}),
    ...(args.summaryOnly !== undefined ? { summaryOnly: args.summaryOnly } : {}),
    ...(args.segmentLimit !== undefined ? { segmentLimit: args.segmentLimit } : {}),
    ...(args.beforeAnchorSeq !== undefined
      ? { beforeAnchorSeq: args.beforeAnchorSeq }
      : {}),
    ...(args.beforeAnchorId !== undefined
      ? { beforeAnchorId: args.beforeAnchorId }
      : {}),
  };
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
            managerChildThreadsConfirmed:
              input.managerChildThreadsConfirmed,
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
          json: input,
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
  };
}
