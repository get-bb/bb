import type {
  CreateProjectRequest,
  CreateProjectSourceRequest,
  ProjectResponse,
  SidebarBootstrapResponse,
} from "@bb/server-contract";
import {
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useProfileClient } from "@/app-shell/ProfilesProvider";
import {
  projectDefaultExecutionOptionsQueryKey,
  projectPathsQueryKeyPrefix,
  projectSourceBranchesQueryKeyPrefix,
  projectsQueryKey,
  sidebarNavigationQueryKey,
  threadSearchQueryKeyPrefix,
  threadsQueryKey,
} from "@/lib/query/query-keys";

/**
 * Project mutations (mirrors apps/app/src/hooks/mutations/project-mutations.ts).
 * The sidebar bootstrap is the cache of record for projects, so every
 * mutation invalidates it together with `projects`; source changes also drop
 * the source-dependent pickers.
 */

function invalidateProjectLists(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: projectsQueryKey() });
  void queryClient.invalidateQueries({ queryKey: sidebarNavigationQueryKey() });
  void queryClient.invalidateQueries({
    queryKey: threadSearchQueryKeyPrefix(),
  });
}

function invalidateProjectSourceQueries(
  queryClient: QueryClient,
  projectId: string,
): void {
  invalidateProjectLists(queryClient);
  void queryClient.invalidateQueries({
    queryKey: projectPathsQueryKeyPrefix(projectId),
  });
  void queryClient.invalidateQueries({
    queryKey: projectSourceBranchesQueryKeyPrefix(projectId),
  });
  void queryClient.invalidateQueries({
    queryKey: projectDefaultExecutionOptionsQueryKey(projectId),
  });
}

/** Insert the created project into the cached lists ahead of the refetch. */
function applyProjectCreateResult(
  queryClient: QueryClient,
  project: ProjectResponse,
): void {
  queryClient.setQueryData<ProjectResponse[]>(projectsQueryKey(), (current) =>
    current === undefined ||
    current.some((candidate) => candidate.id === project.id)
      ? current
      : [...current, project],
  );
  queryClient.setQueryData<SidebarBootstrapResponse>(
    sidebarNavigationQueryKey(),
    (current) =>
      current === undefined ||
      current.projects.some((candidate) => candidate.id === project.id)
        ? current
        : {
            ...current,
            projects: [
              ...current.projects,
              { ...project, threads: [], defaultExecutionOptions: null },
            ],
          },
  );
}

function applyProjectDeleteResult(
  queryClient: QueryClient,
  projectId: string,
): void {
  queryClient.setQueryData<ProjectResponse[]>(projectsQueryKey(), (current) =>
    current?.filter((project) => project.id !== projectId),
  );
  queryClient.setQueryData<SidebarBootstrapResponse>(
    sidebarNavigationQueryKey(),
    (current) =>
      current === undefined
        ? current
        : {
            ...current,
            projects: current.projects.filter(
              (project) => project.id !== projectId,
            ),
          },
  );
}

/**
 * `POST /projects` with one existing local folder on a host as the first
 * source (`{ name, source: { type: "local_path", hostId, path } }`). Cloning
 * onto a machine that has no checkout yet is a second step: `useAddProjectSource`
 * with `{ type: "clone", hostId, remoteUrl?, targetPath? }`.
 */
export function useCreateProject() {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  return useMutation<ProjectResponse, Error, CreateProjectRequest>({
    meta: { errorMessage: "Failed to create project." },
    mutationFn: (request) => sdk.projects.create(request),
    onSuccess: (project) => {
      applyProjectCreateResult(queryClient, project);
      invalidateProjectLists(queryClient);
    },
  });
}

export interface RenameProjectRequest {
  id: string;
  name: string;
}

export function useRenameProject() {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  return useMutation<ProjectResponse, Error, RenameProjectRequest>({
    meta: { errorMessage: "Failed to rename project." },
    mutationFn: ({ id, name }) => sdk.projects.update({ projectId: id, name }),
    onSuccess: (_project, { id }) => {
      invalidateProjectLists(queryClient);
      void queryClient.invalidateQueries({
        queryKey: projectPathsQueryKeyPrefix(id),
      });
      void queryClient.invalidateQueries({ queryKey: threadsQueryKey() });
    },
  });
}

/** `DELETE /projects/:id` (the project's threads are removed with it). */
export function useDeleteProject() {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    meta: { errorMessage: "Failed to remove project." },
    mutationFn: async (projectId) => {
      await sdk.projects.delete({ projectId });
    },
    onSuccess: (_data, projectId) => {
      applyProjectDeleteResult(queryClient, projectId);
      invalidateProjectLists(queryClient);
      void queryClient.invalidateQueries({ queryKey: threadsQueryKey() });
    },
  });
}

export interface AddProjectSourceRequest {
  projectId: string;
  /** Existing folder (`local_path`) or a fresh clone (`clone`) on a host. */
  source: CreateProjectSourceRequest;
}

/**
 * `POST /projects/:id/sources`. Errors render inline in the caller (clone
 * failures carry git stderr the user needs to read), so no global toast.
 */
export function useAddProjectSource() {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  return useMutation({
    meta: { showErrorToast: false },
    mutationFn: ({ projectId, source }: AddProjectSourceRequest) =>
      sdk.projects.sources.add({ projectId, ...source }),
    onSuccess: (_source, { projectId }) =>
      invalidateProjectSourceQueries(queryClient, projectId),
  });
}

export interface RemoveProjectSourceRequest {
  projectId: string;
  sourceId: string;
}

export function useRemoveProjectSource() {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  return useMutation<void, Error, RemoveProjectSourceRequest>({
    meta: { errorMessage: "Failed to remove source." },
    mutationFn: async ({ projectId, sourceId }) => {
      await sdk.projects.sources.delete({ projectId, sourceId });
    },
    onSuccess: (_data, { projectId }) =>
      invalidateProjectSourceQueries(queryClient, projectId),
  });
}
