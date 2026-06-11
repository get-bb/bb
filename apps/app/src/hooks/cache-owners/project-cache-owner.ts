import type { QueryClient } from "@tanstack/react-query";
import type {
  ProjectResponse,
  ProjectWithThreadsResponse,
  ReorderProjectRequest,
  SidebarBootstrapResponse,
} from "@bb/server-contract";
import { applyNeighborReorder } from "@/lib/neighbor-reorder";
import {
  projectsQueryKey,
  sidebarNavigationQueryKey,
} from "../queries/query-keys";
import {
  invalidateProjectDeleteQueries,
  invalidateProjectListQueries,
} from "./mutation-cache-effects";

interface ReorderProjectTransactionArgs {
  queryClient: QueryClient;
  request: ReorderProjectTransactionRequest;
}

interface ReorderProjectTransactionRequest extends ReorderProjectRequest {
  projectId: string;
}

interface RollbackReorderProjectTransactionArgs {
  queryClient: QueryClient;
  transaction: ReorderProjectTransaction | undefined;
}

interface ApplyReorderProjectResultArgs {
  projects: readonly ProjectResponse[];
  queryClient: QueryClient;
}

interface ApplyProjectCreateResultArgs {
  project: ProjectResponse;
  queryClient: QueryClient;
}

interface ApplyProjectDeleteResultArgs {
  projectId: string;
  queryClient: QueryClient;
}

export interface ReorderProjectTransaction {
  previousProjects: ProjectResponse[] | undefined;
  previousSidebarNavigation: SidebarBootstrapResponse | undefined;
}

function applyProjectOrderToProjectList(
  currentProjects: readonly ProjectResponse[],
  orderedProjects: readonly ProjectResponse[],
): ProjectResponse[] {
  const currentProjectsById = new Map(
    currentProjects.map((project) => [project.id, project]),
  );
  return orderedProjects.map(
    (project) => currentProjectsById.get(project.id) ?? project,
  );
}

function applyProjectOrderToSidebarNavigation(
  currentNavigation: SidebarBootstrapResponse,
  orderedProjects: readonly ProjectResponse[],
): SidebarBootstrapResponse {
  const currentProjectsById = new Map(
    currentNavigation.projects.map((project) => [project.id, project]),
  );
  return {
    ...currentNavigation,
    projects: orderedProjects.map((project) => {
      const currentProject = currentProjectsById.get(project.id);
      // A reorder mutation can introduce a project the sidebar hadn't seen yet.
      // Until the sidebar query refetches, synthesize the missing fields —
      // empty threads and unknown defaults — so the cache shape stays valid.
      return (
        currentProject ?? {
          ...project,
          threads: [],
          defaultExecutionOptions: null,
        }
      );
    }),
  };
}

function removeProjectFromProjectList(
  currentProjects: readonly ProjectResponse[],
  projectId: string,
): ProjectResponse[] {
  return currentProjects.filter((project) => project.id !== projectId);
}

function removeProjectFromSidebarNavigation(
  currentNavigation: SidebarBootstrapResponse,
  projectId: string,
): SidebarBootstrapResponse {
  return {
    ...currentNavigation,
    projects: currentNavigation.projects.filter(
      (project) => project.id !== projectId,
    ),
  };
}

function projectToSidebarProject(
  project: ProjectResponse,
): ProjectWithThreadsResponse {
  return {
    ...project,
    threads: [],
    defaultExecutionOptions: null,
  };
}

function applyProjectToProjectList(
  currentProjects: readonly ProjectResponse[],
  project: ProjectResponse,
): ProjectResponse[] {
  if (
    !currentProjects.some((currentProject) => currentProject.id === project.id)
  ) {
    return [...currentProjects, project];
  }

  return currentProjects.map((currentProject) =>
    currentProject.id === project.id ? project : currentProject,
  );
}

function applyProjectToSidebarNavigation(
  currentNavigation: SidebarBootstrapResponse,
  project: ProjectResponse,
): SidebarBootstrapResponse {
  if (currentNavigation.personalProject.id === project.id) {
    return {
      ...currentNavigation,
      personalProject: {
        ...currentNavigation.personalProject,
        ...project,
      },
    };
  }

  const existingProject = currentNavigation.projects.find(
    (currentProject) => currentProject.id === project.id,
  );
  if (!existingProject) {
    return {
      ...currentNavigation,
      projects: [
        ...currentNavigation.projects,
        projectToSidebarProject(project),
      ],
    };
  }

  return {
    ...currentNavigation,
    projects: currentNavigation.projects.map((currentProject) =>
      currentProject.id === project.id
        ? {
            ...currentProject,
            ...project,
          }
        : currentProject,
    ),
  };
}

export function beginReorderProjectTransaction({
  queryClient,
  request,
}: ReorderProjectTransactionArgs): ReorderProjectTransaction {
  const previousProjects =
    queryClient.getQueryData<ProjectResponse[]>(projectsQueryKey());
  const previousSidebarNavigation =
    queryClient.getQueryData<SidebarBootstrapResponse>(
      sidebarNavigationQueryKey(),
    );

  void queryClient.cancelQueries(
    { queryKey: projectsQueryKey() },
    { revert: false },
  );
  void queryClient.cancelQueries(
    { queryKey: sidebarNavigationQueryKey() },
    { revert: false },
  );
  queryClient.setQueryData<ProjectResponse[]>(
    projectsQueryKey(),
    (currentProjects) =>
      currentProjects
        ? applyNeighborReorder({
            items: currentProjects,
            request: {
              itemId: request.projectId,
              previousItemId: request.previousProjectId,
              nextItemId: request.nextProjectId,
            },
          })
        : currentProjects,
  );
  queryClient.setQueryData<SidebarBootstrapResponse>(
    sidebarNavigationQueryKey(),
    (currentNavigation) =>
      currentNavigation
        ? {
            ...currentNavigation,
            projects: applyNeighborReorder({
              items: currentNavigation.projects,
              request: {
                itemId: request.projectId,
                previousItemId: request.previousProjectId,
                nextItemId: request.nextProjectId,
              },
            }),
          }
        : currentNavigation,
  );

  return { previousProjects, previousSidebarNavigation };
}

export function rollbackReorderProjectTransaction({
  queryClient,
  transaction,
}: RollbackReorderProjectTransactionArgs): void {
  queryClient.setQueryData(projectsQueryKey(), transaction?.previousProjects);
  queryClient.setQueryData(
    sidebarNavigationQueryKey(),
    transaction?.previousSidebarNavigation,
  );
  invalidateProjectListQueries({ queryClient });
}

export function applyReorderProjectResult({
  projects,
  queryClient,
}: ApplyReorderProjectResultArgs): void {
  queryClient.setQueryData<ProjectResponse[]>(
    projectsQueryKey(),
    (currentProjects) =>
      currentProjects
        ? applyProjectOrderToProjectList(currentProjects, projects)
        : [...projects],
  );
  queryClient.setQueryData<SidebarBootstrapResponse>(
    sidebarNavigationQueryKey(),
    (currentNavigation) =>
      currentNavigation
        ? applyProjectOrderToSidebarNavigation(currentNavigation, projects)
        : currentNavigation,
  );
}

export function applyProjectCreateResult({
  project,
  queryClient,
}: ApplyProjectCreateResultArgs): void {
  queryClient.setQueryData<ProjectResponse[]>(
    projectsQueryKey(),
    (currentProjects) =>
      currentProjects
        ? applyProjectToProjectList(currentProjects, project)
        : [project],
  );
  queryClient.setQueryData<SidebarBootstrapResponse>(
    sidebarNavigationQueryKey(),
    (currentNavigation) =>
      currentNavigation
        ? applyProjectToSidebarNavigation(currentNavigation, project)
        : currentNavigation,
  );
}

export function applyProjectDeleteResult({
  projectId,
  queryClient,
}: ApplyProjectDeleteResultArgs): void {
  queryClient.setQueryData<ProjectResponse[]>(
    projectsQueryKey(),
    (currentProjects) =>
      currentProjects
        ? removeProjectFromProjectList(currentProjects, projectId)
        : currentProjects,
  );
  queryClient.setQueryData<SidebarBootstrapResponse>(
    sidebarNavigationQueryKey(),
    (currentNavigation) =>
      currentNavigation
        ? removeProjectFromSidebarNavigation(currentNavigation, projectId)
        : currentNavigation,
  );
  invalidateProjectDeleteQueries({ queryClient });
}
