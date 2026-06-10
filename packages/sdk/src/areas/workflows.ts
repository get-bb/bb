import type { ThreadEventRow } from "@bb/domain";
import type {
  CreateWorkflowRunRequest,
  WorkflowListQuery,
  WorkflowListResponse,
  WorkflowRunEventsResponse,
  WorkflowRunListQuery,
  WorkflowRunListResponse,
  WorkflowRunResponse,
} from "@bb/server-contract";
import type { CreateSdkAreaArgs, OkResponse } from "./common.js";

export interface WorkflowListArgs {
  /** Omitted = the project's default source resolves the listing root. */
  hostId?: string;
  projectId: string;
}

export interface WorkflowRunCreateArgs extends CreateWorkflowRunRequest {}

export interface WorkflowRunIdArgs {
  runId: string;
}

export interface WorkflowRunListArgs {
  limit?: string;
  projectId: string;
}

export interface WorkflowRunEventsArgs {
  /** Sequence cursor: only events with strictly greater sequences return. */
  afterSeq?: string;
  runId: string;
}

export interface WorkflowRunWaitArgs {
  runId: string;
  /** Server default 30s, capped at 60s. */
  waitMs?: string;
}

export interface WorkflowRunAgentEventsArgs {
  agentIndex: string;
  runId: string;
}

export interface WorkflowsArea {
  /** Per-agent provider-event log, proxied from the run's host. */
  agentEvents(args: WorkflowRunAgentEventsArgs): Promise<ThreadEventRow[]>;
  cancel(args: WorkflowRunIdArgs): Promise<OkResponse>;
  events(args: WorkflowRunEventsArgs): Promise<WorkflowRunEventsResponse>;
  get(args: WorkflowRunIdArgs): Promise<WorkflowRunResponse>;
  /** Workflow definitions visible from the project's source root. */
  list(args: WorkflowListArgs): Promise<WorkflowListResponse>;
  /** A project's workflow runs, newest first. */
  listRuns(args: WorkflowRunListArgs): Promise<WorkflowRunListResponse>;
  resume(args: WorkflowRunIdArgs): Promise<OkResponse>;
  run(args: WorkflowRunCreateArgs): Promise<WorkflowRunResponse>;
  /**
   * One long-poll round: the terminal run, or `null` when the run stays
   * unsettled within `waitMs` (`interrupted` is not terminal) — callers loop.
   */
  wait(args: WorkflowRunWaitArgs): Promise<WorkflowRunResponse | null>;
}

function listQuery(args: WorkflowListArgs): WorkflowListQuery {
  return {
    projectId: args.projectId,
    ...(args.hostId !== undefined ? { hostId: args.hostId } : {}),
  };
}

function runListQuery(args: WorkflowRunListArgs): WorkflowRunListQuery {
  return {
    projectId: args.projectId,
    ...(args.limit !== undefined ? { limit: args.limit } : {}),
  };
}

export function createWorkflowsArea(args: CreateSdkAreaArgs): WorkflowsArea {
  const { transport } = args;
  return {
    async agentEvents(input) {
      return transport.readJson(
        transport.api.v1["workflow-runs"][":id"].agents[":index"].events.$get({
          param: { id: input.runId, index: input.agentIndex },
        }),
      );
    },
    async cancel(input) {
      await transport.readVoid(
        transport.api.v1["workflow-runs"][":id"].cancel.$post({
          param: { id: input.runId },
        }),
      );
      return { ok: true };
    },
    async events(input) {
      return transport.readJson(
        transport.api.v1["workflow-runs"][":id"].events.$get({
          param: { id: input.runId },
          ...(input.afterSeq === undefined
            ? {}
            : { query: { afterSeq: input.afterSeq } }),
        }),
      );
    },
    async get(input) {
      return transport.readJson(
        transport.api.v1["workflow-runs"][":id"].$get({
          param: { id: input.runId },
        }),
      );
    },
    async list(input) {
      return transport.readJson(
        transport.api.v1.workflows.$get({ query: listQuery(input) }),
      );
    },
    async listRuns(input) {
      return transport.readJson(
        transport.api.v1["workflow-runs"].$get({ query: runListQuery(input) }),
      );
    },
    async resume(input) {
      await transport.readVoid(
        transport.api.v1["workflow-runs"][":id"].resume.$post({
          param: { id: input.runId },
        }),
      );
      return { ok: true };
    },
    async run(input) {
      return transport.readJson(
        transport.api.v1["workflow-runs"].$post({
          json: input,
        }),
      );
    },
    async wait(input) {
      const response = await transport.resolve(
        transport.api.v1["workflow-runs"][":id"].wait.$get({
          param: { id: input.runId },
          ...(input.waitMs === undefined
            ? {}
            : { query: { waitMs: input.waitMs } }),
        }),
      );
      const statusCode: number = response.status;
      if (statusCode === 204) {
        return null;
      }
      return response.json();
    },
  };
}
