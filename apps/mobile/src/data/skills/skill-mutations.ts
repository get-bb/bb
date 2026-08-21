import type { RegistrySkillInstallResponse } from "@bb/server-contract";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useProfileClient } from "@/app-shell/ProfilesProvider";
import {
  allProjectSkillsQueryKeyPrefix,
  allSkillContentQueryKeyPrefix,
  allSkillFilesQueryKeyPrefix,
} from "@/lib/query/query-keys";

export interface InstallRegistrySkillArgs {
  registrySkillId: string;
}

/**
 * `POST /skills-registry/install`: install a skills.sh entry into the user's
 * bb skill library on the server host (the same library every project's
 * default workspace discovers).
 */
export function useInstallRegistrySkill() {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  return useMutation<
    RegistrySkillInstallResponse,
    Error,
    InstallRegistrySkillArgs
  >({
    meta: { errorMessage: "Installing the skill failed" },
    mutationFn: ({ registrySkillId }) =>
      sdk.skills.registry.install({ registrySkillId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: allProjectSkillsQueryKeyPrefix(),
      });
    },
  });
}

export interface DeleteSkillArgs {
  projectId: string;
  skillId: string;
}

/** `DELETE /projects/:id/skills` (user-owned local scopes only). */
export function useDeleteSkill() {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  return useMutation<{ deletedPath: string }, Error, DeleteSkillArgs>({
    meta: { errorMessage: "Deleting the skill failed" },
    mutationFn: ({ projectId, skillId }) =>
      sdk.skills.remove({ projectId, skillId, environmentId: null }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: allProjectSkillsQueryKeyPrefix(),
      });
      void queryClient.invalidateQueries({
        queryKey: allSkillFilesQueryKeyPrefix(),
      });
      void queryClient.invalidateQueries({
        queryKey: allSkillContentQueryKeyPrefix(),
      });
    },
  });
}
