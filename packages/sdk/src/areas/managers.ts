import { PERSONAL_PROJECT_ID, type Thread } from "@bb/domain";
import type {
  CreateManagerThreadRequest,
  ThreadListQuery,
} from "@bb/server-contract";
import type { CreateSdkAreaArgs, OkResponse } from "./common.js";

export interface ManagerHireArgs extends CreateManagerThreadRequest {
  projectId?: string;
}

export interface ManagerListArgs {
  projectId?: string;
}

export interface ManagerStatusArgs {
  managerId: string;
}

export interface ManagerStatusResponse {
  managedThreads: Thread[];
  manager: Thread;
}

export interface ManagerDeleteArgs {
  managerChildThreadsConfirmed: boolean;
  managerId: string;
}

export interface ManagersArea {
  delete(args: ManagerDeleteArgs): Promise<OkResponse>;
  hire(args: ManagerHireArgs): Promise<Thread>;
  list(args?: ManagerListArgs): Promise<Thread[]>;
  status(args: ManagerStatusArgs): Promise<ManagerStatusResponse>;
}

function managerHireJson(
  args: ManagerHireArgs,
): CreateManagerThreadRequest {
  return {
    origin: args.origin,
    environment: args.environment,
    ...(args.executionInputSources !== undefined
      ? { executionInputSources: args.executionInputSources }
      : {}),
    ...(args.input !== undefined ? { input: args.input } : {}),
    ...(args.model !== undefined ? { model: args.model } : {}),
    ...(args.name !== undefined ? { name: args.name } : {}),
    ...(args.providerId !== undefined ? { providerId: args.providerId } : {}),
    ...(args.reasoningLevel !== undefined
      ? { reasoningLevel: args.reasoningLevel }
      : {}),
    ...(args.serviceTier !== undefined ? { serviceTier: args.serviceTier } : {}),
  };
}

function managerListQuery(
  args: ManagerListArgs | undefined,
): ThreadListQuery {
  return {
    ...(args?.projectId ? { projectId: args.projectId } : {}),
    type: "manager",
  };
}

export function createManagersArea(args: CreateSdkAreaArgs): ManagersArea {
  const { transport } = args;
  const getManager = async (managerId: string) => {
    const thread = await transport.readJson(
      transport.api.v1.threads[":id"].$get({
        param: { id: managerId },
      }),
    );
    if (thread.type !== "manager") {
      throw new Error(`Thread ${managerId} is not a manager`);
    }
    return thread;
  };

  return {
    async delete(input) {
      await transport.readVoid(
        transport.api.v1.threads[":id"].$delete({
          param: { id: input.managerId },
          json: {
            managerChildThreadsConfirmed:
              input.managerChildThreadsConfirmed,
          },
        }),
      );
      return { ok: true };
    },
    async hire(input) {
      return transport.readJson(
        transport.api.v1.projects[":id"].managers.$post({
          param: { id: input.projectId ?? PERSONAL_PROJECT_ID },
          json: managerHireJson(input),
        }),
      );
    },
    async list(input) {
      return transport.readJson(
        transport.api.v1.threads.$get({
          query: managerListQuery(input),
        }),
      );
    },
    async status(input) {
      const manager = await getManager(input.managerId);
      const managedThreads = await transport.readJson(
        transport.api.v1.threads.$get({
          query: {
            projectId: manager.projectId,
            parentThreadId: manager.id,
          },
        }),
      );
      return { manager, managedThreads };
    },
  };
}
