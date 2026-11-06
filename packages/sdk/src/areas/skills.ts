import {
  registrySkillDetailSchema,
  registrySkillEntriesRequestSchema,
  registrySkillEntriesResponseSchema,
  registrySkillInstallRequestSchema,
  registrySkillInstallResponseSchema,
  registryRepositoryStarsSchema,
  registrySkillSchema,
  registrySkillsPageSchema,
  type RegistryRepositoryStars,
  type RegistrySkill,
  type RegistrySkillDetail,
  type RegistrySkillEntriesResponse,
  type RegistrySkillInstallResponse,
  type RegistrySkillsPage,
  type SkillContentResponse,
  type SkillFilesResponse,
  type SkillListResponse,
} from "@bb/server-contract";
import type { CreateSdkAreaArgs } from "./common.js";

export interface SkillWorkspaceArgs {
  projectId: string;
  environmentId: string | null;
}

export interface SkillListArgs extends SkillWorkspaceArgs {
  signal?: AbortSignal;
}

export interface SkillIdentityArgs extends SkillListArgs {
  skillId: string;
}

export interface SkillContentArgs extends SkillIdentityArgs {
  path: string;
}

export interface SkillUpdateArgs extends SkillWorkspaceArgs {
  skillId: string;
  content: string;
  revision: string;
}

export interface SkillDeleteArgs extends SkillWorkspaceArgs {
  skillId: string;
}

export interface AbortableArgs {
  signal?: AbortSignal;
}

export interface RegistrySkillsSearchArgs extends AbortableArgs {
  query?: string;
  page?: number;
  perPage?: number;
}

export interface RegistrySkillIdArgs extends AbortableArgs {
  registrySkillId: string;
}

export interface RegistrySkillEntriesArgs extends AbortableArgs {
  registrySkillIds: readonly string[];
}

export interface RegistrySkillSourceArgs extends AbortableArgs {
  source: string;
  skillId: string;
}

export interface RegistryRepositoryArgs extends AbortableArgs {
  source: string;
}

export interface RegistrySkillInstallArgs {
  registrySkillId: string;
}

export interface SkillsRegistryArea {
  detail(args: RegistrySkillSourceArgs): Promise<RegistrySkillDetail>;
  entries(
    args: RegistrySkillEntriesArgs,
  ): Promise<RegistrySkillEntriesResponse>;
  get(args: RegistrySkillIdArgs): Promise<RegistrySkill>;
  install(
    args: RegistrySkillInstallArgs,
  ): Promise<RegistrySkillInstallResponse>;
  repositoryStars(
    args: RegistryRepositoryArgs,
  ): Promise<RegistryRepositoryStars>;
  search(args?: RegistrySkillsSearchArgs): Promise<RegistrySkillsPage>;
}

export interface SkillsArea {
  getContent(args: SkillContentArgs): Promise<SkillContentResponse>;
  list(args: SkillListArgs): Promise<SkillListResponse>;
  listFiles(args: SkillIdentityArgs): Promise<SkillFilesResponse>;
  registry: SkillsRegistryArea;
  remove(args: SkillDeleteArgs): Promise<{ deletedPath: string }>;
  update(
    args: SkillUpdateArgs,
  ): Promise<{ filePath: string; revision: string }>;
}

export function createSkillsArea(args: CreateSdkAreaArgs): SkillsArea {
  const { call } = args.operations;

  const registry: SkillsRegistryArea = {
    async detail(input) {
      return registrySkillDetailSchema.parse(
        await call(
          "skillsRegistry.detail",
          { source: input.source, skillId: input.skillId },
          { signal: input.signal },
        ),
      );
    },
    async entries(input) {
      const body = registrySkillEntriesRequestSchema.parse({
        ids: [...input.registrySkillIds],
      });
      return registrySkillEntriesResponseSchema.parse(
        await call("skillsRegistry.entries", body, { signal: input.signal }),
      );
    },
    async get(input) {
      return registrySkillSchema.parse(
        await call(
          "skillsRegistry.entry",
          { id: input.registrySkillId },
          { signal: input.signal },
        ),
      );
    },
    async install(input) {
      const body = registrySkillInstallRequestSchema.parse(input);
      return registrySkillInstallResponseSchema.parse(
        await call("skillsRegistry.install", body),
      );
    },
    async repositoryStars(input) {
      return registryRepositoryStarsSchema.parse(
        await call(
          "skillsRegistry.repositoryStars",
          { source: input.source },
          { signal: input.signal },
        ),
      );
    },
    async search(input = {}) {
      const query = input.query?.trim();
      return registrySkillsPageSchema.parse(
        await call(
          "skillsRegistry.list",
          {
            page: String(input.page ?? 0),
            perPage: String(input.perPage ?? 24),
            ...(query ? { q: query } : {}),
          },
          { signal: input.signal },
        ),
      );
    },
  };

  return {
    getContent: (input) =>
      call(
        "projects.skillContent",
        {
          id: input.projectId,
          skillId: input.skillId,
          path: input.path,
          environmentId: input.environmentId ?? "",
        },
        { signal: input.signal },
      ),
    list: (input) =>
      call(
        "projects.skills",
        { id: input.projectId, environmentId: input.environmentId ?? "" },
        { signal: input.signal },
      ),
    listFiles: (input) =>
      call(
        "projects.skillFiles",
        {
          id: input.projectId,
          skillId: input.skillId,
          environmentId: input.environmentId ?? "",
        },
        { signal: input.signal },
      ),
    registry,
    remove: (input) =>
      call("projects.deleteSkill", {
        id: input.projectId,
        skillId: input.skillId,
        environmentId: input.environmentId,
      }),
    update: (input) =>
      call("projects.updateSkill", {
        id: input.projectId,
        skillId: input.skillId,
        environmentId: input.environmentId,
        content: input.content,
        revision: input.revision,
      }),
  };
}
