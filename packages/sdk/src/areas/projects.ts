import type {
  CreateProjectRequest,
  CreateProjectSourceRequest,
  ProjectListQuery,
  ProjectResponse,
  UpdateProjectRequest,
  UpdateProjectSourceRequest,
} from "@bb/server-contract";
import type { ProjectSource } from "@bb/domain";
import type { CreateSdkAreaArgs, OkResponse } from "./common.js";

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

export interface ProjectSourcesArea {
  add(args: ProjectSourceAddArgs): Promise<ProjectSource>;
  delete(args: ProjectSourceDeleteArgs): Promise<OkResponse>;
  update(args: ProjectSourceUpdateArgs): Promise<ProjectSource>;
}

export interface ProjectsArea {
  create(args: ProjectCreateArgs): Promise<ProjectResponse>;
  delete(args: ProjectDeleteArgs): Promise<OkResponse>;
  get(args: ProjectGetArgs): Promise<ProjectResponse>;
  list(args?: ProjectListArgs): Promise<ProjectResponse[]>;
  sources: ProjectSourcesArea;
  update(args: ProjectUpdateArgs): Promise<ProjectResponse>;
}

function projectUpdateJson(args: ProjectUpdateArgs): UpdateProjectRequest {
  return {
    ...(args.name !== undefined ? { name: args.name } : {}),
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
    ...(args.isDefault !== undefined ? { isDefault: args.isDefault } : {}),
    ...(args.path !== undefined ? { path: args.path } : {}),
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
