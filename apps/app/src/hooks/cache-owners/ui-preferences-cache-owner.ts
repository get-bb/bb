import type { QueryClient } from "@tanstack/react-query";
import type { UiPreferencesResponse } from "@bb/server-contract";
import { uiPreferencesQueryKey } from "../queries/query-keys";

export function getCachedUiPreferences(
  queryClient: QueryClient,
): UiPreferencesResponse | undefined {
  return queryClient.getQueryData<UiPreferencesResponse>(
    uiPreferencesQueryKey(),
  );
}

export function setCachedUiPreferences(
  queryClient: QueryClient,
  response: UiPreferencesResponse,
): void {
  queryClient.setQueryData(uiPreferencesQueryKey(), response);
}

export function invalidateCachedUiPreferences(queryClient: QueryClient): void {
  queryClient.invalidateQueries({ queryKey: uiPreferencesQueryKey() });
}
