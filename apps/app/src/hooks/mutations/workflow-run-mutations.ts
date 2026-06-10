import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CreateWorkflowRunRequest } from "@bb/server-contract";
import * as api from "@/lib/api";
import {
  applyWorkflowRunCreateResult,
  applyWorkflowRunLifecycleActionResult,
} from "../cache-owners/workflow-run-cache-owner";

interface WorkflowRunMutationRequest {
  runId: string;
}

/**
 * Launch a workflow run. Errors stay off the global toast — the Run dialog
 * renders them inline next to the form (policy/validation 422s name the
 * rejected field and must sit beside the controls that caused them).
 */
export function useCreateWorkflowRun() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to launch workflow run.",
      showErrorToast: false,
    },
    mutationFn: (request: CreateWorkflowRunRequest) =>
      api.createWorkflowRun(request),
    onSuccess: (run) => {
      applyWorkflowRunCreateResult({ queryClient, run });
    },
  });
}

export function useCancelWorkflowRun() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to cancel workflow run.",
    },
    mutationFn: ({ runId }: WorkflowRunMutationRequest) =>
      api.cancelWorkflowRun(runId),
    onSuccess: (_data, { runId }) => {
      applyWorkflowRunLifecycleActionResult({ queryClient, runId });
    },
  });
}

export function useResumeWorkflowRun() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to resume workflow run.",
    },
    mutationFn: ({ runId }: WorkflowRunMutationRequest) =>
      api.resumeWorkflowRun(runId),
    onSuccess: (_data, { runId }) => {
      applyWorkflowRunLifecycleActionResult({ queryClient, runId });
    },
  });
}
