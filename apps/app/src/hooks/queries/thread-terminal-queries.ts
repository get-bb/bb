import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CloseTerminalRequest,
  CreateTerminalRequest,
  TerminalCreateTarget,
  TerminalListResponse,
  TerminalSession,
  UpdateTerminalRequest,
} from "@bb/server-contract";
import { BbHttpError, sdk } from "@/lib/sdk";
import {
  applyTerminalSessionClose,
  applyTerminalSessionMissing,
  applyTerminalSessionUpsert,
} from "../cache-owners/terminal-cache-owner";
import { terminalsQueryKey, type TerminalQueryScope } from "./query-keys";
import { requireEnabledQueryArg, type QueryOptions } from "./query-helpers";
import { REALTIME_OWNED_NO_FOCUS_QUERY_POLICY } from "./query-policies";

interface RenameTerminalMutationRequest extends UpdateTerminalRequest {
  terminalId: string;
}

interface CloseTerminalMutationRequest {
  mode: CloseTerminalRequest["mode"];
  terminalId: string;
}

export function terminalQueryScopeForTarget(
  target: TerminalCreateTarget,
): TerminalQueryScope {
  if (target.kind !== "host_path") return target;
  return {
    kind: "host_path",
    hostId: target.hostId,
    ...(target.cwd === null ? {} : { cwd: target.cwd }),
  };
}

export function useTerminals(
  scope: TerminalQueryScope | null | undefined,
  options?: QueryOptions,
) {
  return useQuery<TerminalListResponse>({
    queryKey: terminalsQueryKey(
      scope ?? { kind: "host_path", hostId: "__disabled__" },
    ),
    queryFn: ({ signal }) =>
      sdk.terminals.list({
        scope: requireEnabledQueryArg({
          value: scope,
          hookName: "useTerminals",
          argName: "terminal scope",
        }),
        signal,
      }),
    enabled:
      (options?.enabled ?? true) && scope !== null && scope !== undefined,
    ...REALTIME_OWNED_NO_FOCUS_QUERY_POLICY,
  });
}

export function useThreadTerminals(id: string, options?: QueryOptions) {
  return useTerminals(id ? { kind: "thread", threadId: id } : null, options);
}

export function useEnvironmentTerminals(id: string, options?: QueryOptions) {
  return useTerminals(
    id ? { kind: "environment", environmentId: id } : null,
    options,
  );
}

export function useCreateTerminal() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to start terminal.",
      lifecycleOperation: "open_terminal",
    },
    mutationFn: ({ target, ...request }: CreateTerminalRequest) =>
      sdk.terminals.create({ ...request, scope: target }),
    onSuccess: (session: TerminalSession) => {
      applyTerminalSessionUpsert({ queryClient, session });
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
      sdk.terminals.rename({ terminalId, ...request }),
    onSuccess: (session: TerminalSession) => {
      applyTerminalSessionUpsert({ queryClient, session });
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
      sdk.terminals.close({ mode, terminalId }).catch((error: unknown) => {
        if (error instanceof BbHttpError && error.status === 404) return null;
        throw error;
      }),
    onSuccess: (session: TerminalSession | null, variables) => {
      if (session === null) {
        applyTerminalSessionMissing({
          queryClient,
          terminalId: variables.terminalId,
        });
        return;
      }
      applyTerminalSessionClose({
        queryClient,
        session,
        terminalId: variables.terminalId,
      });
    },
  });
}
