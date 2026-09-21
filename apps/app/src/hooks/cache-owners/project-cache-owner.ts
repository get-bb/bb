import type { QueryClient } from "@tanstack/react-query";
import type {
  ProjectResponse,
  ThreadSectionMutationResponse,
  ProjectWithThreadsResponse,
  SidebarBootstrapResponse,
} from "@bb/server-contract";
import {
  projectsQueryKey,
  sidebarNavigationQueryKey,
} from "../queries/query-keys";
import { invalidateProjectDeleteQueries } from "./mutation-cache-effects";

interface ApplyProjectCreateResultArgs {
  project: ProjectResponse;
  queryClient: QueryClient;
}

interface ApplyProjectDeleteResultArgs {
  projectId: string;
  queryClient: QueryClient;
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

export function applyProjectUpdateResult({
  project,
  queryClient,
}: ApplyProjectCreateResultArgs): void {
  queryClient.setQueryData<ProjectResponse[]>(projectsQueryKey(), (projects) =>
    projects?.map((current) => (current.id === project.id ? project : current)),
  );
  queryClient.setQueryData<SidebarBootstrapResponse>(
    sidebarNavigationQueryKey(),
    (navigation) =>
      navigation
        ? {
            ...navigation,
            projects: navigation.projects.map((current) =>
              current.id === project.id ? { ...current, ...project } : current,
            ),
          }
        : navigation,
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

export function applyThreadSectionRenameResult({
  section,
  queryClient,
}: {
  section: ThreadSectionMutationResponse;
  queryClient: QueryClient;
}): void {
  queryClient.setQueryData<SidebarBootstrapResponse>(
    sidebarNavigationQueryKey(),
    (navigation) =>
      navigation
        ? {
            ...navigation,
            sections: navigation.sections.map((current) =>
              current.id === section.id
                ? { ...current, name: section.name }
                : current,
            ),
          }
        : navigation,
  );
}
