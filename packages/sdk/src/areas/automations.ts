import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { automationSchema } from "@bb/server-contract";
import type {
  CreateAutomationRequest,
  RunAutomationRequest,
  UpdateAutomationRequest,
} from "@bb/server-contract";
import type { CreateSdkAreaArgs, PublicApiOutput } from "./common.js";

export interface AutomationCreateArgs extends CreateAutomationRequest {
  projectId?: string;
}

export interface AutomationListArgs {
  projectId?: string;
}

export interface AutomationGetArgs {
  projectId?: string;
  automationId: string;
}

export interface AutomationUpdateArgs extends UpdateAutomationRequest {
  projectId?: string;
  automationId: string;
}

export interface AutomationActionArgs {
  projectId?: string;
  automationId: string;
}

export interface AutomationRunArgs extends RunAutomationRequest {
  projectId?: string;
  automationId: string;
}

export interface AutomationRunsArgs {
  projectId?: string;
  automationId: string;
  limit?: number;
  cursor?: string;
}

export type AutomationCreateResult = PublicApiOutput<
  "/projects/:id/automations",
  "$post"
>;
export type AutomationListResult = PublicApiOutput<
  "/projects/:id/automations",
  "$get"
>;
export type AutomationGetResult = PublicApiOutput<
  "/projects/:id/automations/:automationId",
  "$get"
>;
export type AutomationUpdateResult = PublicApiOutput<
  "/projects/:id/automations/:automationId",
  "$patch"
>;
export type AutomationPauseResult = PublicApiOutput<
  "/projects/:id/automations/:automationId/pause",
  "$post"
>;
export type AutomationResumeResult = PublicApiOutput<
  "/projects/:id/automations/:automationId/resume",
  "$post"
>;
export type AutomationRunResult = PublicApiOutput<
  "/projects/:id/automations/:automationId/run",
  "$post"
>;
export type AutomationRunsResult = PublicApiOutput<
  "/projects/:id/automations/:automationId/runs",
  "$get"
>;
export type AutomationsOverviewResult = PublicApiOutput<
  "/automations",
  "$get"
>;

export interface AutomationsArea {
  create(args: AutomationCreateArgs): Promise<AutomationCreateResult>;
  delete(args: AutomationActionArgs): Promise<{ ok: true }>;
  get(args: AutomationGetArgs): Promise<AutomationGetResult>;
  list(args?: AutomationListArgs): Promise<AutomationListResult>;
  overview(): Promise<AutomationsOverviewResult>;
  pause(args: AutomationActionArgs): Promise<AutomationPauseResult>;
  resume(args: AutomationActionArgs): Promise<AutomationResumeResult>;
  run(args: AutomationRunArgs): Promise<AutomationRunResult>;
  runs(args: AutomationRunsArgs): Promise<AutomationRunsResult>;
  update(args: AutomationUpdateArgs): Promise<AutomationUpdateResult>;
}

function resolveProjectId(projectId: string | undefined): string {
  return projectId ?? PERSONAL_PROJECT_ID;
}

/**
 * Build the create request body. When constructed inside a thread (BB_THREAD_ID
 * set) and the caller did not supply origin/createdByThreadId, default the
 * origin to "agent" and stamp the creating thread. This is a convenience, not an
 * enforced guarantee.
 */
function createJson(args: AutomationCreateArgs): CreateAutomationRequest {
  const { projectId: _projectId, ...request } = args;
  const threadId = process.env.BB_THREAD_ID?.trim();
  if (threadId && request.origin === undefined) {
    return {
      ...request,
      origin: "agent",
      ...(request.createdByThreadId === undefined
        ? { createdByThreadId: threadId }
        : {}),
    };
  }
  return request;
}

function updateJson(args: AutomationUpdateArgs): UpdateAutomationRequest {
  const { projectId: _projectId, automationId: _automationId, ...request } =
    args;
  return request;
}

function runJson(args: AutomationRunArgs): RunAutomationRequest {
  return {
    ...(args.idempotencyKey === undefined
      ? {}
      : { idempotencyKey: args.idempotencyKey }),
  };
}

function runsQuery(args: AutomationRunsArgs): { limit?: string; cursor?: string } {
  return {
    ...(args.limit === undefined ? {} : { limit: String(args.limit) }),
    ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
  };
}

export function createAutomationsArea(
  args: CreateSdkAreaArgs,
): AutomationsArea {
  const { transport } = args;
  return {
    async create(input) {
      return transport.readJson(
        transport.api.v1.projects[":id"].automations.$post({
          param: { id: resolveProjectId(input.projectId) },
          json: createJson(input),
        }),
      );
    },
    async delete(input) {
      await transport.readVoid(
        transport.api.v1.projects[":id"].automations[":automationId"].$delete({
          param: {
            id: resolveProjectId(input.projectId),
            automationId: input.automationId,
          },
        }),
      );
      return { ok: true };
    },
    async get(input) {
      // The get route's output union includes a 404 ApiError; narrow back to an
      // Automation with the contract schema (mirrors the environments area).
      const body = await transport.readJson(
        transport.api.v1.projects[":id"].automations[":automationId"].$get({
          param: {
            id: resolveProjectId(input.projectId),
            automationId: input.automationId,
          },
        }),
      );
      return automationSchema.parse(body);
    },
    async list(input = {}) {
      return transport.readJson(
        transport.api.v1.projects[":id"].automations.$get({
          param: { id: resolveProjectId(input.projectId) },
        }),
      );
    },
    async overview() {
      return transport.readJson(transport.api.v1.automations.$get());
    },
    async pause(input) {
      return transport.readJson(
        transport.api.v1.projects[":id"].automations[
          ":automationId"
        ].pause.$post({
          param: {
            id: resolveProjectId(input.projectId),
            automationId: input.automationId,
          },
        }),
      );
    },
    async resume(input) {
      return transport.readJson(
        transport.api.v1.projects[":id"].automations[
          ":automationId"
        ].resume.$post({
          param: {
            id: resolveProjectId(input.projectId),
            automationId: input.automationId,
          },
        }),
      );
    },
    async run(input) {
      return transport.readJson(
        transport.api.v1.projects[":id"].automations[
          ":automationId"
        ].run.$post({
          param: {
            id: resolveProjectId(input.projectId),
            automationId: input.automationId,
          },
          json: runJson(input),
        }),
      );
    },
    async runs(input) {
      return transport.readJson(
        transport.api.v1.projects[":id"].automations[
          ":automationId"
        ].runs.$get({
          param: {
            id: resolveProjectId(input.projectId),
            automationId: input.automationId,
          },
          query: runsQuery(input),
        }),
      );
    },
    async update(input) {
      return transport.readJson(
        transport.api.v1.projects[":id"].automations[":automationId"].$patch({
          param: {
            id: resolveProjectId(input.projectId),
            automationId: input.automationId,
          },
          json: updateJson(input),
        }),
      );
    },
  };
}
