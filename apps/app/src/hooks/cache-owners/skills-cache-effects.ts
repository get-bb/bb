import type { SkillListResponse, SkillSummary } from "@bb/server-contract";
import type { QueryClientArg } from "../cache-effect-types";
import {
  projectSkillsQueryKey,
  skillContentQueryKeyPrefix,
} from "../queries/query-keys";
import { invalidateQueryKeys } from "./cache-effect-utils";

interface SkillContentInvalidationArg extends QueryClientArg {
  projectId: string;
  skillId: string;
}

/**
 * Invalidate a skill's cached SKILL.md and the project skills list after an
 * update. Centralized here so the skills mutation hooks stay off raw cache
 * writes.
 */
export function invalidateSkillContentMutationQueries({
  projectId,
  skillId,
  queryClient,
}: SkillContentInvalidationArg): void {
  invalidateQueryKeys({
    queryClient,
    queryKeys: [
      skillContentQueryKeyPrefix(projectId, skillId),
      projectSkillsQueryKey(projectId),
    ],
  });
}

interface ProjectSkillsInvalidationArg extends QueryClientArg {
  projectId: string;
}

/** Make a completed registry install available immediately, then reconcile from disk. */
export function upsertProjectSkillMutationQuery({
  projectId,
  queryClient,
  skill,
}: ProjectSkillsInvalidationArg & { skill: SkillSummary }): void {
  queryClient.setQueryData<SkillListResponse>(
    projectSkillsQueryKey(projectId),
    (current) => ({
      skills: [
        ...(current?.skills ?? []).filter(({ id }) => id !== skill.id),
        skill,
      ],
    }),
  );
}

/** Invalidate the project skills list after a skill is deleted. */
export function invalidateProjectSkillsMutationQueries({
  projectId,
  queryClient,
}: ProjectSkillsInvalidationArg): void {
  invalidateQueryKeys({
    queryClient,
    queryKeys: [projectSkillsQueryKey(projectId)],
  });
}
