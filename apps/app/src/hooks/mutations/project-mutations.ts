import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PromptInput, ReasoningLevel, ServiceTier } from "@bb/domain";
import type {
  CreateManagerExecutionInputSources,
  CreateProjectRequest,
  ManagerEnvironmentArgs,
  ProjectResponse,
  ReorderManagerThreadRequest,
  ReorderProjectRequest,
  ThreadListResponse,
  UpdateProjectRequest,
  UploadedPromptAttachment,
} from "@bb/server-contract";
import * as api from "@/lib/api";
import {
  applyProjectDeleteResult,
  applyReorderProjectResult,
  beginReorderProjectTransaction,
  rollbackReorderProjectTransaction,
  type ReorderProjectTransaction,
} from "../cache-owners/project-cache-owner";
import { applyThreadRuntimeResult } from "../cache-owners/thread-detail-cache-owner";
import {
  applyReorderProjectManagerResult,
  beginReorderProjectManagerTransaction,
  insertCreatedThreadIntoCachedLists,
  rollbackReorderProjectManagerTransaction,
  type ReorderProjectManagerTransaction,
} from "../cache-owners/thread-list-cache-owner";
import {
  invalidateProjectListQueries,
  invalidateProjectManagerHireQueries,
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

export interface HireProjectManagerRequest {
  projectId: string;
  name?: string;
  providerId?: string;
  model?: string;
  serviceTier?: ServiceTier;
  reasoningLevel?: ReasoningLevel;
  executionInputSources?: CreateManagerExecutionInputSources;
  environment: ManagerEnvironmentArgs;
  /** Optional user-provided first message; when empty the server uses
   * its welcome-message template instead. */
  input?: PromptInput[];
}

const HIRE_PROJECT_MANAGER_MUTATION_KEY = ["hireProjectManager"] as const;

interface UpdateProjectMutationRequest extends UpdateProjectRequest {
  id: string;
}

interface ReorderProjectMutationRequest extends ReorderProjectRequest {
  projectId: string;
}

interface ReorderProjectManagerMutationRequest extends ReorderManagerThreadRequest {
  projectId: string;
  threadId: string;
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
    onSuccess: () => {
      invalidateProjectListQueries({ queryClient });
    },
  });
}

export function useHireProjectManager() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: HIRE_PROJECT_MANAGER_MUTATION_KEY,
    meta: {
      errorMessage: "Failed to hire manager.",
      showErrorToast: false,
    },
    mutationFn: ({
      projectId,
      name,
      providerId,
      model,
      serviceTier,
      reasoningLevel,
      executionInputSources,
      environment,
      input,
    }: HireProjectManagerRequest) =>
      api.hireProjectManager(projectId, {
        name,
        ...(providerId ? { providerId } : {}),
        ...(model ? { model } : {}),
        ...(serviceTier ? { serviceTier } : {}),
        ...(reasoningLevel ? { reasoningLevel } : {}),
        ...(executionInputSources ? { executionInputSources } : {}),
        environment,
        ...(input && input.length > 0 ? { input } : {}),
      }),
    onSuccess: (thread, variables) => {
      applyThreadRuntimeResult({ queryClient, thread });
      insertCreatedThreadIntoCachedLists({ queryClient, thread });
      invalidateProjectManagerHireQueries({
        projectId: variables.projectId,
        queryClient,
      });
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

export function useReorderProjectManager() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to reorder manager.",
      showErrorToast: false,
    },
    mutationFn: ({
      projectId,
      threadId,
      previousThreadId,
      nextThreadId,
    }: ReorderProjectManagerMutationRequest): Promise<ThreadListResponse> =>
      api.reorderProjectManager(projectId, threadId, {
        previousThreadId,
        nextThreadId,
      }),
    onMutate: (variables): ReorderProjectManagerTransaction =>
      beginReorderProjectManagerTransaction({
        queryClient,
        request: variables,
      }),
    onError: (_error, variables, context) => {
      rollbackReorderProjectManagerTransaction({
        queryClient,
        request: variables,
        transaction: context,
      });
    },
    onSuccess: (threads, variables) => {
      applyReorderProjectManagerResult({
        projectId: variables.projectId,
        queryClient,
        threads,
      });
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
