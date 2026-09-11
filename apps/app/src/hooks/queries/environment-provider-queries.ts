import { useQuery } from "@tanstack/react-query";
import type {
  SystemEnvironmentProvider,
  SystemEnvironmentProvidersQuery,
} from "@bb/server-contract";
import { sdk } from "@/lib/sdk";
import {
  environmentProviderListCacheKey,
  readCachedEnvironmentProviderList,
  writeCachedEnvironmentProviderList,
} from "@/lib/environment-provider-list-cache";
import { SERVER_SESSION_QUERY_POLICY } from "./query-policies";

const SYSTEM_ENVIRONMENT_PROVIDERS_QUERY_KEY = "systemEnvironmentProviders";

export function systemEnvironmentProvidersQueryKey(): readonly [
  typeof SYSTEM_ENVIRONMENT_PROVIDERS_QUERY_KEY,
];
export function systemEnvironmentProvidersQueryKey(
  query: SystemEnvironmentProvidersQuery,
): readonly [
  typeof SYSTEM_ENVIRONMENT_PROVIDERS_QUERY_KEY,
  string | null,
  string | null,
];
export function systemEnvironmentProvidersQueryKey(
  query?: SystemEnvironmentProvidersQuery,
):
  | readonly [typeof SYSTEM_ENVIRONMENT_PROVIDERS_QUERY_KEY]
  | readonly [
      typeof SYSTEM_ENVIRONMENT_PROVIDERS_QUERY_KEY,
      string | null,
      string | null,
    ] {
  if (query === undefined) return [SYSTEM_ENVIRONMENT_PROVIDERS_QUERY_KEY];
  return [
    SYSTEM_ENVIRONMENT_PROVIDERS_QUERY_KEY,
    query.projectId ?? null,
    query.hostId ?? null,
  ];
}

const NO_ENVIRONMENT_PROVIDERS: readonly SystemEnvironmentProvider[] = [];

function environmentProvidersQueryOptions(
  query: SystemEnvironmentProvidersQuery,
) {
  const cacheKey = environmentProviderListCacheKey({
    projectId: query.projectId ?? null,
    hostId: query.hostId ?? null,
  });
  return {
    queryKey: systemEnvironmentProvidersQueryKey(query),
    queryFn: async () => {
      const providers = await sdk.environments.listProviders(query);
      writeCachedEnvironmentProviderList(cacheKey, providers);
      return providers;
    },
    placeholderData: () =>
      readCachedEnvironmentProviderList(cacheKey) ?? undefined,
    ...SERVER_SESSION_QUERY_POLICY,
  };
}

export function useSystemEnvironmentProviders(
  query: SystemEnvironmentProvidersQuery = {},
): {
  providers: readonly SystemEnvironmentProvider[] | undefined;
} {
  const result = useQuery(environmentProvidersQueryOptions(query));
  return {
    providers: result.isError ? NO_ENVIRONMENT_PROVIDERS : result.data,
  };
}
