import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DeleteSkillRequest, SkillSummary } from "@bb/server-contract";
import { sdk } from "@/lib/sdk";
import {
  projectSkillsQueryKey,
  skillContentQueryKey,
  skillFilesQueryKey,
  SKILL_CONTENT_QUERY_KEY,
  SKILL_FILES_QUERY_KEY,
} from "@/hooks/queries/query-keys";
import { invalidateProjectSkillsMutationQueries } from "@/hooks/cache-owners/skills-cache-effects";

/**
 * Skills discovered for a project's default workspace (user/builtin/provider
 * scopes plus that project's `.bb/skills`). The top-level Skills page passes the
 * personal project so it surfaces the user's global skill set.
 */
export function useProjectSkills(projectId: string) {
  return useQuery({
    queryKey: projectSkillsQueryKey(projectId),
    queryFn: ({ signal }) =>
      sdk.skills.list({ projectId, environmentId: null, signal }),
    enabled: projectId.length > 0,
    // Skills are on-disk files mutated out-of-band — agents write SKILL.md, and
    // users edit them in their own editor (the detail view's "Open in editor").
    // Always re-read from disk on mount/focus so the list never shows a stale set.
    staleTime: 0,
    refetchOnMount: "always",
  });
}

/** Read a skill's SKILL.md (lazily; only when a skill is selected). */
export function useSkillContent(
  projectId: string,
  skill: SkillSummary | null,
  path: string,
) {
  return useQuery({
    queryKey: skill
      ? skillContentQueryKey(projectId, skill.id, path)
      : [SKILL_CONTENT_QUERY_KEY, projectId, "none", path],
    queryFn: ({ signal }) =>
      sdk.skills.getContent({
        projectId,
        skillId: skill!.id,
        path,
        environmentId: null,
        signal,
      }),
    enabled: skill !== null && projectId.length > 0,
    // Re-read SKILL.md from disk every time the detail view opens or regains
    // focus — the user may have just edited the file in their own editor.
    staleTime: 0,
    refetchOnMount: "always",
  });
}

export function useSkillFiles(projectId: string, skill: SkillSummary | null) {
  return useQuery({
    queryKey: skill
      ? skillFilesQueryKey(projectId, skill.id)
      : [SKILL_FILES_QUERY_KEY, projectId, "none"],
    queryFn: ({ signal }) =>
      sdk.skills.listFiles({
        projectId,
        skillId: skill!.id,
        environmentId: null,
        signal,
      }),
    enabled: skill !== null && projectId.length > 0,
    staleTime: 0,
    refetchOnMount: "always",
  });
}

export function useDeleteSkill(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorMessage: "Failed to delete skill." },
    mutationFn: (body: DeleteSkillRequest) =>
      sdk.skills.remove({ projectId, ...body }),
    onSuccess: () => {
      invalidateProjectSkillsMutationQueries({ projectId, queryClient });
    },
  });
}
