import type {
  CreateProjectRequest,
  CreateProjectSourceRequest,
  ProjectListQuery,
  UpdateProjectRequest,
  UpdateProjectSourceRequest,
} from "@bb/server-contract";
import type { CreateSdkAreaArgs, PublicApiOutput } from "./common.js";

export interface ProjectListArgs extends ProjectListQuery {}

export interface ProjectCreateArgs extends CreateProjectRequest {}

export interface ProjectGetArgs {
  projectId: string;
}

export interface ProjectUpdateArgs extends UpdateProjectRequest {
  projectId: string;
}

export interface ProjectDeleteArgs {
  projectId: string;
}

export interface ProjectSourceAddArgs extends CreateProjectSourceRequest {
  projectId: string;
}

export interface ProjectSourceUpdateArgs extends UpdateProjectSourceRequest {
  projectId: string;
  sourceId: string;
}

export interface ProjectSourceDeleteArgs {
  projectId: string;
  sourceId: string;
}

export type ProjectCreateResult = PublicApiOutput<"/projects", "$post">;
export type ProjectDeleteResult = PublicApiOutput<"/projects/:id", "$delete">;
export type ProjectGetResult = PublicApiOutput<"/projects/:id", "$get">;
export type ProjectListResult = PublicApiOutput<"/projects", "$get">;
export type ProjectUpdateResult = PublicApiOutput<"/projects/:id", "$patch">;
export type ProjectSourceAddResult = PublicApiOutput<
  "/projects/:id/sources",
  "$post"
>;
export type ProjectSourceUpdateResult = PublicApiOutput<
  "/projects/:id/sources/:sourceId",
  "$patch"
>;
export type ProjectSourceDeleteResult = PublicApiOutput<
  "/projects/:id/sources/:sourceId",
  "$delete"
>;

export interface ProjectSourcesArea {
  add(args: ProjectSourceAddArgs): Promise<ProjectSourceAddResult>;
  delete(args: ProjectSourceDeleteArgs): Promise<ProjectSourceDeleteResult>;
  update(args: ProjectSourceUpdateArgs): Promise<ProjectSourceUpdateResult>;
}

export interface ProjectsArea {
  create(args: ProjectCreateArgs): Promise<ProjectCreateResult>;
  delete(args: ProjectDeleteArgs): Promise<ProjectDeleteResult>;
  get(args: ProjectGetArgs): Promise<ProjectGetResult>;
  list(args?: ProjectListArgs): Promise<ProjectListResult>;
  sources: ProjectSourcesArea;
  update(args: ProjectUpdateArgs): Promise<ProjectUpdateResult>;
}

function projectUpdateJson(args: ProjectUpdateArgs): UpdateProjectRequest {
  return {
    name: args.name,
  };
}

function projectSourceAddJson(
  args: ProjectSourceAddArgs,
): CreateProjectSourceRequest {
  return {
    hostId: args.hostId,
    path: args.path,
    type: args.type,
  };
}

function projectSourceUpdateJson(
  args: ProjectSourceUpdateArgs,
): UpdateProjectSourceRequest {
  return {
    isDefault: args.isDefault,
    path: args.path,
    type: args.type,
  };
}

export function createProjectsArea(args: CreateSdkAreaArgs): ProjectsArea {
  const { transport } = args;
  const sources: ProjectSourcesArea = {
    async add(input) {
      return transport.readJson(
        transport.api.v1.projects[":id"].sources.$post({
          param: { id: input.projectId },
          json: projectSourceAddJson(input),
        }),
      );
    },
    async delete(input) {
      await transport.readVoid(
        transport.api.v1.projects[":id"].sources[":sourceId"].$delete({
          param: { id: input.projectId, sourceId: input.sourceId },
        }),
      );
      return { ok: true };
    },
    async update(input) {
      return transport.readJson(
        transport.api.v1.projects[":id"].sources[":sourceId"].$patch({
          param: { id: input.projectId, sourceId: input.sourceId },
          json: projectSourceUpdateJson(input),
        }),
      );
    },
  };

  return {
    async create(input) {
      return transport.readJson(
        transport.api.v1.projects.$post({
          json: input,
        }),
      );
    },
    async delete(input) {
      await transport.readVoid(
        transport.api.v1.projects[":id"].$delete({
          param: { id: input.projectId },
        }),
      );
      return { ok: true };
    },
    async get(input) {
      return transport.readJson(
        transport.api.v1.projects[":id"].$get({
          param: { id: input.projectId },
        }),
      );
    },
    async list(input = {}) {
      return transport.readJson(
        transport.api.v1.projects.$get({
          query: input,
        }),
      );
    },
    sources,
    async update(input) {
      return transport.readJson(
        transport.api.v1.projects[":id"].$patch({
          param: { id: input.projectId },
          json: projectUpdateJson(input),
        }),
      );
    },
  };
}
