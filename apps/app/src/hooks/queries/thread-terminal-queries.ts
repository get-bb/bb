import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CloseEnvironmentTerminalRequest,
  CloseTerminalRequest,
  CloseThreadTerminalRequest,
  CreateEnvironmentTerminalRequest,
  CreateTerminalRequest,
  CreateThreadTerminalRequest,
  EnvironmentTerminalListResponse,
  TerminalListResponse,
  TerminalSession,
  ThreadTerminalListResponse,
  UpdateEnvironmentTerminalRequest,
  UpdateTerminalRequest,
  UpdateThreadTerminalRequest,
} from "@bb/server-contract";
import * as api from "@/lib/api";
import {
  applyEnvironmentTerminalSessionClose,
  applyEnvironmentTerminalSessionUpsert,
  applyTerminalSessionClose,
  applyTerminalSessionUpsert,
  applyThreadTerminalSessionClose,
  applyThreadTerminalSessionUpsert,
} from "../cache-owners/terminal-cache-owner";
import {
  environmentTerminalsQueryKey,
  terminalsQueryKey,
  threadTerminalsQueryKey,
} from "./query-keys";
import { requireEnabledQueryArg } from "./query-helpers";

interface QueryOptions {
  enabled?: boolean;
}

interface CreateThreadTerminalMutationRequest
  extends CreateThreadTerminalRequest {
  threadId: string;
}

interface CreateEnvironmentTerminalMutationRequest
  extends CreateEnvironmentTerminalRequest {
  environmentId: string;
}

interface RenameThreadTerminalMutationRequest
  extends UpdateThreadTerminalRequest {
  terminalId: string;
  threadId: string;
}

interface RenameTerminalMutationRequest extends UpdateTerminalRequest {
  terminalId: string;
}

interface RenameEnvironmentTerminalMutationRequest
  extends UpdateEnvironmentTerminalRequest {
  environmentId: string;
  terminalId: string;
}

interface CloseThreadTerminalMutationRequest {
  mode: CloseThreadTerminalRequest["mode"];
  terminalId: string;
  threadId: string;
}

interface CloseTerminalMutationRequest {
  mode: CloseTerminalRequest["mode"];
  terminalId: string;
}

interface CloseEnvironmentTerminalMutationRequest {
  environmentId: string;
  mode: CloseEnvironmentTerminalRequest["mode"];
  terminalId: string;
}

export function useThreadTerminals(id: string, options?: QueryOptions) {
  return useQuery<ThreadTerminalListResponse>({
    queryKey: threadTerminalsQueryKey(id),
    queryFn: ({ signal }) =>
      api.listThreadTerminals(
        requireEnabledQueryArg({
          value: id,
          hookName: "useThreadTerminals",
          argName: "thread id",
        }),
        signal,
      ),
    enabled: (options?.enabled ?? true) && Boolean(id),
    refetchOnWindowFocus: false,
  });
}

export function useEnvironmentTerminals(
  id: string,
  options?: QueryOptions,
) {
  return useQuery<EnvironmentTerminalListResponse>({
    queryKey: environmentTerminalsQueryKey(id),
    queryFn: ({ signal }) =>
      api.listEnvironmentTerminals(
        requireEnabledQueryArg({
          value: id,
          hookName: "useEnvironmentTerminals",
          argName: "environment id",
        }),
        signal,
      ),
    enabled: (options?.enabled ?? true) && Boolean(id),
    refetchOnWindowFocus: false,
  });
}

export function useTerminals(options?: QueryOptions) {
  return useQuery<TerminalListResponse>({
    queryKey: terminalsQueryKey(),
    queryFn: ({ signal }) => api.listTerminals(signal),
    enabled: options?.enabled ?? true,
    refetchOnWindowFocus: false,
  });
}

export function useCreateThreadTerminal() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to start terminal.",
      lifecycleOperation: "open_terminal",
    },
    mutationFn: ({ threadId, ...request }: CreateThreadTerminalMutationRequest) =>
      api.createThreadTerminal(threadId, request),
    onSuccess: (session: TerminalSession) => {
      applyThreadTerminalSessionUpsert({ queryClient, session });
    },
  });
}

export function useCreateTerminal() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to start terminal.",
      lifecycleOperation: "open_terminal",
    },
    mutationFn: (request: CreateTerminalRequest) => api.createTerminal(request),
    onSuccess: (session: TerminalSession) => {
      applyTerminalSessionUpsert({ queryClient, session });
    },
  });
}

export function useCreateEnvironmentTerminal() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to start terminal.",
      lifecycleOperation: "open_terminal",
    },
    mutationFn: ({
      environmentId,
      ...request
    }: CreateEnvironmentTerminalMutationRequest) =>
      api.createEnvironmentTerminal(environmentId, request),
    onSuccess: (session: TerminalSession) => {
      applyEnvironmentTerminalSessionUpsert({ queryClient, session });
    },
  });
}

export function useRenameThreadTerminal() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to rename terminal.",
    },
    mutationFn: ({
      terminalId,
      threadId,
      ...request
    }: RenameThreadTerminalMutationRequest) =>
      api.renameThreadTerminal(threadId, terminalId, request),
    onSuccess: (session: TerminalSession) => {
      applyThreadTerminalSessionUpsert({ queryClient, session });
    },
  });
}

export function useRenameTerminal() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to rename terminal.",
    },
    mutationFn: ({ terminalId, ...request }: RenameTerminalMutationRequest) =>
      api.renameTerminal(terminalId, request),
    onSuccess: (session: TerminalSession) => {
      applyTerminalSessionUpsert({ queryClient, session });
    },
  });
}

export function useRenameEnvironmentTerminal() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to rename terminal.",
    },
    mutationFn: ({
      environmentId,
      terminalId,
      ...request
    }: RenameEnvironmentTerminalMutationRequest) =>
      api.renameEnvironmentTerminal(environmentId, terminalId, request),
    onSuccess: (session: TerminalSession) => {
      applyEnvironmentTerminalSessionUpsert({ queryClient, session });
    },
  });
}

export function useCloseThreadTerminal() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to close terminal.",
    },
    mutationFn: ({
      mode,
      terminalId,
      threadId,
    }: CloseThreadTerminalMutationRequest) =>
      api.closeThreadTerminal(threadId, terminalId, { mode, reason: "user" }),
    onSuccess: (session: TerminalSession, variables) => {
      applyThreadTerminalSessionClose({
        queryClient,
        session,
        terminalId: variables.terminalId,
      });
    },
  });
}

export function useCloseTerminal() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to close terminal.",
    },
    mutationFn: ({ mode, terminalId }: CloseTerminalMutationRequest) =>
      api.closeTerminal(terminalId, { mode, reason: "user" }),
    onSuccess: (session: TerminalSession, variables) => {
      applyTerminalSessionClose({
        queryClient,
        session,
        terminalId: variables.terminalId,
      });
    },
  });
}

export function useCloseEnvironmentTerminal() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to close terminal.",
    },
    mutationFn: ({
      environmentId,
      mode,
      terminalId,
    }: CloseEnvironmentTerminalMutationRequest) =>
      api.closeEnvironmentTerminal(environmentId, terminalId, {
        mode,
        reason: "user",
      }),
    onSuccess: (session: TerminalSession, variables) => {
      applyEnvironmentTerminalSessionClose({
        queryClient,
        session,
        terminalId: variables.terminalId,
      });
    },
  });
}
