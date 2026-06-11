import {
  parseThreadEventRow,
  type PendingInteraction,
  type PendingInteractionResolution,
  type Thread,
  type ThreadEventRow,
} from "@bb/domain";
import type {
  CreateThreadScheduleRequest,
  CreateThreadRequest,
  DeleteThreadRequest,
  SendMessageRequest,
  ThreadSchedule,
  ThreadEventsQuery,
  ThreadEventWaitQuery,
  ThreadGetQuery,
  ThreadListQuery,
  ThreadResponse,
  ThreadTimelineQuery,
  ThreadTimelineResponse,
  ThreadWithIncludesResponse,
  UpdateThreadScheduleConfigRequest,
  UpdateThreadScheduleEnabledRequest,
  UpdateThreadScheduleRequest,
  UpdateThreadRequest,
} from "@bb/server-contract";
import type { CreateSdkAreaArgs, OkResponse } from "./common.js";

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

export interface ThreadScheduleListArgs {
  threadId: string;
}

export interface ThreadScheduleCreateArgs extends CreateThreadScheduleRequest {
  threadId: string;
}

export interface ThreadScheduleConfigUpdateArgs
  extends UpdateThreadScheduleConfigRequest {
  scheduleId: string;
  threadId: string;
}

export interface ThreadScheduleEnabledUpdateArgs
  extends UpdateThreadScheduleEnabledRequest {
  scheduleId: string;
  threadId: string;
}

export type ThreadScheduleUpdateArgs =
  | ThreadScheduleConfigUpdateArgs
  | ThreadScheduleEnabledUpdateArgs;

export interface ThreadScheduleDeleteArgs {
  scheduleId: string;
  threadId: string;
}

export interface ThreadSchedulesArea {
  create(args: ThreadScheduleCreateArgs): Promise<ThreadSchedule>;
  delete(args: ThreadScheduleDeleteArgs): Promise<OkResponse>;
  list(args: ThreadScheduleListArgs): Promise<ThreadSchedule[]>;
  update(args: ThreadScheduleUpdateArgs): Promise<ThreadSchedule>;
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
  schedules: ThreadSchedulesArea;
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
    ...(args?.hasParent === undefined
      ? {}
      : { hasParent: args.hasParent ? "true" : "false" }),
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

function scheduleCreateJson(
  args: ThreadScheduleCreateArgs,
): CreateThreadScheduleRequest {
  return {
    name: args.name,
    cron: args.cron,
    timezone: args.timezone,
    prompt: args.prompt,
    ...(args.enabled !== undefined ? { enabled: args.enabled } : {}),
  };
}

function scheduleUpdateJson(
  args: ThreadScheduleUpdateArgs,
): UpdateThreadScheduleRequest {
  if ("enabled" in args) {
    return { enabled: args.enabled };
  }
  return {
    ...(args.name !== undefined ? { name: args.name } : {}),
    ...(args.cron !== undefined ? { cron: args.cron } : {}),
    ...(args.timezone !== undefined ? { timezone: args.timezone } : {}),
    ...(args.prompt !== undefined ? { prompt: args.prompt } : {}),
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
  const schedules: ThreadSchedulesArea = {
    async create(input) {
      return transport.readJson(
        transport.api.v1.threads[":id"].schedules.$post({
          param: { id: input.threadId },
          json: scheduleCreateJson(input),
        }),
      );
    },
    async delete(input) {
      await transport.readVoid(
        transport.api.v1.threads[":id"].schedules[":scheduleId"].$delete({
          param: {
            id: input.threadId,
            scheduleId: input.scheduleId,
          },
        }),
      );
      return { ok: true };
    },
    async list(input) {
      return transport.readJson(
        transport.api.v1.threads[":id"].schedules.$get({
          param: { id: input.threadId },
        }),
      );
    },
    async update(input) {
      return transport.readJson(
        transport.api.v1.threads[":id"].schedules[":scheduleId"].$patch({
          param: {
            id: input.threadId,
            scheduleId: input.scheduleId,
          },
          json: scheduleUpdateJson(input),
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
    async pin(input) {
      return transport.readJson(
        transport.api.v1.threads[":id"].pin.$post({
          param: { id: input.threadId },
        }),
      );
    },
    schedules,
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
