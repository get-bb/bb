import type { QueryClientArg } from "../cache-effect-types";
import { projectSkillsQueryKey } from "../queries/query-keys";
import { invalidateQueryKeys } from "./cache-effect-utils";

interface ProjectSkillsInvalidationArg extends QueryClientArg {
  projectId: string;
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
