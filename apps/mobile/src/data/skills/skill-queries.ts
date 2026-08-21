import type {
  RegistrySkill,
  RegistrySkillDetail,
  RegistrySkillsPage,
  SkillContentResponse,
  SkillFilesResponse,
  SkillSummary,
} from "@bb/server-contract";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useProfileClient } from "@/app-shell/ProfilesProvider";
import {
  projectSkillsQueryKey,
  skillContentQueryKey,
  skillFilesQueryKey,
  skillsRegistryDetailQueryKey,
  skillsRegistryEntryQueryKey,
  skillsRegistryQueryKey,
} from "@/lib/query/query-keys";
import { requireEnabledQueryArg } from "../shared/query-helpers";

interface QueryOptions {
  enabled?: boolean;
}

const REGISTRY_PAGE_SIZE = 24;
const REGISTRY_LIST_STALE_TIME_MS = 30 * 60_000;

/**
 * Skills discovered for a project's default workspace (`GET
 * /projects/:id/skills`): user / builtin / provider scopes plus that
 * project's `.bb/skills`. Skills are on-disk files mutated out of band
 * (agents write SKILL.md), so every mount re-reads them.
 */
export function useProjectSkills(
  projectId: string | null,
  options?: QueryOptions,
) {
  const { sdk } = useProfileClient();
  const enabled = (options?.enabled ?? true) && projectId !== null;
  return useQuery<SkillSummary[]>({
    queryKey: projectSkillsQueryKey(projectId ?? ""),
    queryFn: async ({ signal }) =>
      (
        await sdk.skills.list({
          projectId: requireEnabledQueryArg({
            value: projectId,
            hookName: "useProjectSkills",
            argName: "projectId",
          }),
          environmentId: null,
          signal,
        })
      ).skills,
    enabled,
    staleTime: 0,
    refetchOnMount: "always",
  });
}

/** One skill out of the project list (null once loaded and absent). */
export function useProjectSkill(
  projectId: string | null,
  skillId: string | null,
) {
  const list = useProjectSkills(projectId);
  const skill = useMemo(
    () =>
      skillId === null
        ? null
        : (list.data?.find((entry) => entry.id === skillId) ?? null),
    [list.data, skillId],
  );
  return { ...list, skill };
}

export interface SkillIdentityArgs {
  projectId: string | null;
  skillId: string | null;
}

/** `GET /projects/:id/skills/files`: the files of one skill folder. */
export function useSkillFiles({ projectId, skillId }: SkillIdentityArgs) {
  const { sdk } = useProfileClient();
  return useQuery<SkillFilesResponse>({
    queryKey: skillFilesQueryKey(projectId ?? "", skillId ?? ""),
    queryFn: ({ signal }) =>
      sdk.skills.listFiles({
        projectId: requireEnabledQueryArg({
          value: projectId,
          hookName: "useSkillFiles",
          argName: "projectId",
        }),
        skillId: requireEnabledQueryArg({
          value: skillId,
          hookName: "useSkillFiles",
          argName: "skillId",
        }),
        environmentId: null,
        signal,
      }),
    enabled: projectId !== null && skillId !== null,
    staleTime: 0,
    refetchOnMount: "always",
  });
}

export interface SkillContentArgs extends SkillIdentityArgs {
  path: string;
}

/** `GET /projects/:id/skills/content`: one file of a skill (SKILL.md by default). */
export function useSkillContent({
  projectId,
  skillId,
  path,
}: SkillContentArgs) {
  const { sdk } = useProfileClient();
  return useQuery<SkillContentResponse>({
    queryKey: skillContentQueryKey(projectId ?? "", skillId ?? "", path),
    queryFn: ({ signal }) =>
      sdk.skills.getContent({
        projectId: requireEnabledQueryArg({
          value: projectId,
          hookName: "useSkillContent",
          argName: "projectId",
        }),
        skillId: requireEnabledQueryArg({
          value: skillId,
          hookName: "useSkillContent",
          argName: "skillId",
        }),
        path,
        environmentId: null,
        signal,
      }),
    enabled: projectId !== null && skillId !== null && path.length > 0,
    staleTime: 0,
    refetchOnMount: "always",
  });
}

export interface RegistrySkillsArgs extends QueryOptions {
  query: string;
}

/**
 * `GET /skills-registry?q=&page=`: the skills.sh registry (proxied by the
 * server; 503 when skills.sh is down) as an infinite query, one page per
 * `fetchNextPage`. Keyed by the trimmed query, so a new search starts at page
 * 0. Long stale time: the ranking barely moves and the proxy is a
 * third-party round trip. Pages are flattened with
 * `accumulateRegistryPage` (a ranking change mid-scroll restarts the list).
 */
export function useRegistrySkills({ query, enabled }: RegistrySkillsArgs) {
  const { sdk } = useProfileClient();
  const trimmed = query.trim();
  return useInfiniteQuery<RegistrySkillsPage>({
    queryKey: skillsRegistryQueryKey(trimmed, 0),
    queryFn: ({ pageParam, signal }) =>
      sdk.skills.registry.search({
        query: trimmed,
        page: typeof pageParam === "number" ? pageParam : 0,
        perPage: REGISTRY_PAGE_SIZE,
        signal,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) =>
      lastPage.pagination.hasMore ? lastPage.pagination.page + 1 : undefined,
    enabled: enabled ?? true,
    staleTime: REGISTRY_LIST_STALE_TIME_MS,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

/** `GET /skills-registry/entry?id=`: one registry entry by id (deep links). */
export function useRegistrySkillEntry(registrySkillId: string | null) {
  const { sdk } = useProfileClient();
  return useQuery<RegistrySkill>({
    queryKey: skillsRegistryEntryQueryKey(registrySkillId ?? ""),
    queryFn: ({ signal }) =>
      sdk.skills.registry.get({
        registrySkillId: requireEnabledQueryArg({
          value: registrySkillId,
          hookName: "useRegistrySkillEntry",
          argName: "registrySkillId",
        }),
        signal,
      }),
    enabled: registrySkillId !== null,
    staleTime: REGISTRY_LIST_STALE_TIME_MS,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

export interface RegistrySkillDetailArgs {
  source: string | null;
  skillId: string | null;
}

/** `GET /skills-registry/detail`: the files of a registry skill (read-only). */
export function useRegistrySkillDetail({
  source,
  skillId,
}: RegistrySkillDetailArgs) {
  const { sdk } = useProfileClient();
  return useQuery<RegistrySkillDetail>({
    queryKey: skillsRegistryDetailQueryKey(source ?? "", skillId ?? ""),
    queryFn: ({ signal }) =>
      sdk.skills.registry.detail({
        source: requireEnabledQueryArg({
          value: source,
          hookName: "useRegistrySkillDetail",
          argName: "source",
        }),
        skillId: requireEnabledQueryArg({
          value: skillId,
          hookName: "useRegistrySkillDetail",
          argName: "skillId",
        }),
        signal,
      }),
    enabled: source !== null && skillId !== null,
    staleTime: REGISTRY_LIST_STALE_TIME_MS,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}
