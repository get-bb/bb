import type { ProviderInfo } from "@bb/domain";
import { BbHttpError } from "@bb/sdk/browser";
import type {
  SystemConfigResponse,
  SystemExecutionOptionsResponse,
  SystemVersionResponse,
} from "@bb/server-contract";
import { useQuery, type QueryKey } from "@tanstack/react-query";
import { useProfileClient } from "@/app-shell/ProfilesProvider";
import {
  SYSTEM_EXECUTION_OPTIONS_QUERY_KEY,
  systemConfigQueryKey,
  systemExecutionOptionsQueryKey,
  systemProvidersQueryKey,
  systemVersionQueryKey,
} from "@/lib/query/query-keys";
import { isTransientReadError } from "@/lib/query/query-client";
import { SERVER_SESSION_QUERY_POLICY } from "../shared/query-policies";
import { useSystemRealtimeSubscription } from "../shared/use-realtime-subscription";

interface QueryOptions {
  enabled?: boolean;
}

/** `GET /system/config`, kept live through the `system` subscription. */
export function useSystemConfig(options?: QueryOptions) {
  const { sdk } = useProfileClient();
  const enabled = options?.enabled ?? true;
  useSystemRealtimeSubscription({ enabled });
  return useQuery<SystemConfigResponse>({
    queryKey: systemConfigQueryKey(),
    queryFn: ({ signal }) => sdk.system.config({ signal }),
    enabled,
    staleTime: 60_000,
  });
}

/**
 * `GET /system/version`. The server consults npm (5 s timeout, cached for an
 * hour), so this is kept fresh for a long time and never refetched on focus.
 */
export function useSystemVersion(options?: QueryOptions) {
  const { sdk } = useProfileClient();
  return useQuery<SystemVersionResponse>({
    queryKey: systemVersionQueryKey(),
    queryFn: ({ signal }) => sdk.system.version({ signal }),
    enabled: options?.enabled ?? true,
    ...SERVER_SESSION_QUERY_POLICY,
  });
}

/**
 * The provider roster with display names (`GET /system/providers`). Cheaper
 * than the execution-options query (no model probe); use it when only names
 * are needed.
 */
export function useSystemProviders(options?: QueryOptions) {
  const { sdk } = useProfileClient();
  const enabled = options?.enabled ?? true;
  useSystemRealtimeSubscription({ enabled });
  return useQuery<ProviderInfo[]>({
    queryKey: systemProvidersQueryKey(),
    queryFn: ({ signal }) => sdk.providers.list({ signal }),
    enabled,
    staleTime: 60_000,
  });
}

/** Route the model probe through an environment's host or an explicit host. */
export type ExecutionOptionsRouting =
  | { environmentId: string; hostId?: undefined }
  | { environmentId?: undefined; hostId: string }
  | { environmentId?: undefined; hostId?: undefined };

export type UseSystemExecutionOptionsArgs = ExecutionOptionsRouting & {
  enabled?: boolean;
  /** Omit to let the server pick its default provider. */
  providerId?: string;
};

const EXECUTION_OPTIONS_RETRY_DELAY_MS = 250;

function shouldRetryExecutionOptions(
  failureCount: number,
  error: unknown,
): boolean {
  if (failureCount >= 1) return false;
  if (error instanceof BbHttpError) {
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }
  return isTransientReadError(error);
}

function isSameExecutionOptionsRoute(
  previousQueryKey: QueryKey | undefined,
  environmentId: string | null,
  hostId: string | null,
): boolean {
  return (
    previousQueryKey?.[0] === SYSTEM_EXECUTION_OPTIONS_QUERY_KEY &&
    previousQueryKey[1] === environmentId &&
    previousQueryKey[2] === hostId
  );
}

/**
 * Providers, models, and the machine's permission ceiling for a provider on
 * a route (`GET /system/execution-options`). Switching provider on the same
 * route keeps the previous provider roster as placeholder data (models are
 * provider-specific and start empty) so the picker does not blank out; the
 * Claude probe can take seconds, so callers should render `isPlaceholderData`
 * / `isLoading` as a loading state.
 */
export function useSystemExecutionOptions(
  args: UseSystemExecutionOptionsArgs = {},
) {
  const { sdk } = useProfileClient();
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
    retry: shouldRetryExecutionOptions,
    retryDelay: EXECUTION_OPTIONS_RETRY_DELAY_MS,
    placeholderData: (previousData, previousQuery) => {
      if (
        previousData === undefined ||
        !isSameExecutionOptionsRoute(
          previousQuery?.queryKey,
          environmentId,
          hostId,
        )
      ) {
        return undefined;
      }
      // A prior response's models belong to the prior provider. Keep only the
      // provider-independent roster while the newly selected provider loads.
      return {
        providers: previousData.providers,
        models: [],
        selectedOnlyModels: [],
        permissionCeiling: previousData.permissionCeiling,
        modelLoadError: null,
      };
    },
  });
}
