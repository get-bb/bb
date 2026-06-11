import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CreateProjectRequest,
  ProjectResponse,
  ReorderProjectRequest,
  UpdateProjectRequest,
  UploadedPromptAttachment,
} from "@bb/server-contract";
import * as api from "@/lib/api";
import {
  applyProjectCreateResult,
  applyProjectDeleteResult,
  applyReorderProjectResult,
  beginReorderProjectTransaction,
  rollbackReorderProjectTransaction,
  type ReorderProjectTransaction,
} from "../cache-owners/project-cache-owner";
import {
  invalidateProjectListQueries,
  invalidateProjectSourceQueries,
  invalidateProjectUpdateQueries,
} from "../cache-owners/mutation-cache-effects";

interface AddLocalProjectSourceRequest {
  projectId: string;
  hostId: string;
  path: string;
}

interface UpdateLocalProjectSourceRequest {
  projectId: string;
  sourceId: string;
  path: string;
}

interface DeleteLocalProjectSourceRequest {
  projectId: string;
  sourceId: string;
}

interface UpdateProjectMutationRequest extends UpdateProjectRequest {
  id: string;
}

interface ReorderProjectMutationRequest extends ReorderProjectRequest {
  projectId: string;
}

interface UploadPromptAttachmentRequest {
  projectId: string;
  file: File;
}

export function useCreateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to create project.",
    },
    mutationFn: (request: CreateProjectRequest) => api.createProject(request),
    onSuccess: (project) => {
      applyProjectCreateResult({ project, queryClient });
      invalidateProjectListQueries({ queryClient });
    },
  });
}

export function useUpdateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to update project.",
    },
    mutationFn: ({ id, ...request }: UpdateProjectMutationRequest) =>
      api.updateProject(id, request),
    onSuccess: (_data, variables) => {
      invalidateProjectUpdateQueries({ projectId: variables.id, queryClient });
    },
  });
}

export function useReorderProject() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to reorder project.",
      showErrorToast: false,
    },
    mutationFn: ({
      projectId,
      previousProjectId,
      nextProjectId,
    }: ReorderProjectMutationRequest): Promise<ProjectResponse[]> =>
      api.reorderProject(projectId, {
        previousProjectId,
        nextProjectId,
      }),
    onMutate: (variables): ReorderProjectTransaction =>
      beginReorderProjectTransaction({
        queryClient,
        request: variables,
      }),
    onError: (_error, _variables, context) => {
      rollbackReorderProjectTransaction({
        queryClient,
        transaction: context,
      });
    },
    onSuccess: (projects) => {
      applyReorderProjectResult({ projects, queryClient });
    },
  });
}

export function useDeleteProject() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to remove project.",
    },
    mutationFn: (projectId: string) => api.deleteProject(projectId),
    onSuccess: (_data, projectId) => {
      applyProjectDeleteResult({ projectId, queryClient });
    },
  });
}

export function useAddLocalProjectSource() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to add local source.",
    },
    mutationFn: ({ projectId, hostId, path }: AddLocalProjectSourceRequest) =>
      api.addProjectSource(projectId, { type: "local_path", hostId, path }),
    onSuccess: (_data, variables) => {
      invalidateProjectSourceQueries({
        projectId: variables.projectId,
        queryClient,
      });
    },
  });
}

export function useUpdateLocalProjectSource() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to update local source.",
    },
    mutationFn: ({
      projectId,
      sourceId,
      path,
    }: UpdateLocalProjectSourceRequest) =>
      api.updateProjectSource(projectId, sourceId, {
        type: "local_path",
        path,
      }),
    onSuccess: (_data, variables) => {
      invalidateProjectSourceQueries({
        projectId: variables.projectId,
        queryClient,
      });
    },
  });
}

export function useDeleteLocalProjectSource() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to remove source.",
    },
    mutationFn: ({ projectId, sourceId }: DeleteLocalProjectSourceRequest) =>
      api.removeProjectSource(projectId, sourceId),
    onSuccess: (_data, variables) => {
      invalidateProjectSourceQueries({
        projectId: variables.projectId,
        queryClient,
      });
    },
  });
}

export function useUploadPromptAttachment() {
  return useMutation({
    meta: {
      errorMessage: "Failed to upload attachment.",
      showErrorToast: false,
    },
    mutationFn: ({
      projectId,
      file,
    }: UploadPromptAttachmentRequest): Promise<UploadedPromptAttachment> =>
      api.uploadPromptAttachment(projectId, file),
    retry: false,
  });
}
