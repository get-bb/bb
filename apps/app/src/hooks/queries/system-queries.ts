import { useQuery } from "@tanstack/react-query";
import { toRecord } from "@bb/core-ui";
import type {
  SystemConfigResponse,
  SystemExecutionOptionsResponse,
  SystemVersionResponse,
} from "@bb/server-contract";
import type { ProviderCliStatusResponse } from "@bb/host-daemon-contract";
import type { ProviderUsageResponse } from "@bb/host-daemon-contract";
import { BbHttpError, sdk } from "@/lib/sdk";
import { useSystemRealtimeSubscription } from "@/hooks/useRealtimeSubscription";
import {
  hostProviderCliStatusQueryKey,
  systemConfigQueryKey,
  systemExecutionOptionsQueryKey,
  systemUsageLimitsQueryKey,
  systemVersionQueryKey,
} from "./query-keys";
import { requireEnabledQueryArg } from "./query-helpers";
import {
  FOCUS_OWNED_LIVE_QUERY_POLICY,
  SERVER_SESSION_QUERY_POLICY,
  SESSION_STATIC_QUERY_POLICY,
} from "./query-policies";

export interface UseSystemExecutionOptionsArgs {
  enabled?: boolean;
  environmentId?: string;
  hostId?: string;
  providerId?: string;
}

interface QueryOptions {
  enabled?: boolean;
}

const SYSTEM_EXECUTION_OPTIONS_RETRY_DELAY_MS = 250;
const SYSTEM_EXECUTION_OPTIONS_RETRY_COUNT = 1;

function isAbortLikeError(error: unknown): boolean {
  return toRecord(error)?.name === "AbortError";
}

function shouldRetrySystemExecutionOptions(
  failureCount: number,
  error: unknown,
): boolean {
  if (failureCount >= SYSTEM_EXECUTION_OPTIONS_RETRY_COUNT) {
    return false;
  }

  if (isAbortLikeError(error)) {
    return false;
  }

  if (error instanceof BbHttpError) {
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }

  return true;
}

export function useSystemExecutionOptions(
  args: UseSystemExecutionOptionsArgs = {},
) {
  const environmentId = args.environmentId ?? null;
  const hostId = args.hostId ?? null;
  const providerId = args.providerId ?? null;
  const enabled = args.enabled ?? true;
  useSystemRealtimeSubscription({ enabled });

  return useQuery<SystemExecutionOptionsResponse>({
    queryKey: systemExecutionOptionsQueryKey({
      environmentId,
      hostId,
      providerId,
    }),
    queryFn: ({ signal }) =>
      sdk.system.executionOptions({
        environmentId: args.environmentId,
        hostId: args.hostId,
        providerId: args.providerId,
        signal,
      }),
    enabled,
    staleTime: 60_000,
    retry: shouldRetrySystemExecutionOptions,
    retryDelay: SYSTEM_EXECUTION_OPTIONS_RETRY_DELAY_MS,
  });
}

export function useSystemConfig(options?: QueryOptions) {
  const enabled = options?.enabled ?? true;
  useSystemRealtimeSubscription({ enabled });

  return useQuery<SystemConfigResponse>({
    queryKey: systemConfigQueryKey(),
    queryFn: ({ signal }) => sdk.system.config({ signal }),
    enabled,
    staleTime: 60_000,
  });
}

export function useSystemVersion(options?: QueryOptions) {
  return useQuery<SystemVersionResponse>({
    queryKey: systemVersionQueryKey(),
    queryFn: ({ signal }) => sdk.system.version({ signal }),
    enabled: options?.enabled ?? true,
    ...SERVER_SESSION_QUERY_POLICY,
  });
}

export interface UseHostProviderCliStatusArgs {
  hostId: string | null;
  enabled?: boolean;
}

export function useHostProviderCliStatus({
  hostId,
  enabled,
}: UseHostProviderCliStatusArgs) {
  return useQuery<ProviderCliStatusResponse>({
    queryKey: hostProviderCliStatusQueryKey(hostId),
    queryFn: ({ signal }) =>
      sdk.hosts.providerCliStatus({
        hostId: requireEnabledQueryArg({
          value: hostId,
          hookName: "useHostProviderCliStatus",
          argName: "hostId",
        }),
        signal,
      }),
    enabled: (enabled ?? true) && hostId !== null,
    ...SESSION_STATIC_QUERY_POLICY,
  });
}

export interface UseSystemUsageLimitsArgs extends QueryOptions {
  hostId?: string;
}

export function useSystemUsageLimits(args: UseSystemUsageLimitsArgs = {}) {
  const hostId = args.hostId ?? null;
  return useQuery<ProviderUsageResponse>({
    queryKey: systemUsageLimitsQueryKey(hostId),
    queryFn: ({ signal }) =>
      sdk.system.usageLimits({
        ...(args.hostId === undefined ? {} : { hostId: args.hostId }),
        signal,
      }),
    enabled: args.enabled ?? true,
    ...FOCUS_OWNED_LIVE_QUERY_POLICY,
  });
}
