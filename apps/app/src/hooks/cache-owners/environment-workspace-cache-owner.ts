import type { QueryClient } from "@tanstack/react-query";
import type { Environment, ThreadListEntry } from "@bb/domain";
import {
  environmentQueryKey,
  threadSearchQueryKeyPrefix,
} from "../queries/query-keys";
import { invalidateEnvironmentWorkspaceStateQueries } from "./environment-cache-effects";
import {
  applyToCachedThreadListsAndSidebarNavigation,
  type CachedThreadListsAndSidebarNavigationMapper,
} from "./query-cache";

interface EnvironmentUpdateResultArgs {
  environment: Environment;
  queryClient: QueryClient;
}

interface ApplyEnvironmentNameToCachedThreadArgs {
  environment: Environment;
  thread: ThreadListEntry;
}

function applyEnvironmentNameToCachedThread({
  environment,
  thread,
}: ApplyEnvironmentNameToCachedThreadArgs): ThreadListEntry {
  if (thread.environmentId !== environment.id) {
    return thread;
  }

  return {
    ...thread,
    environmentName: environment.name,
  };
}

export function applyEnvironmentUpdateResult({
  environment,
  queryClient,
}: EnvironmentUpdateResultArgs): void {
  queryClient.setQueryData<Environment>(
    environmentQueryKey(environment.id),
    environment,
  );
  const applyEnvironmentName: CachedThreadListsAndSidebarNavigationMapper = (
    threads,
  ) =>
    threads.map((thread) =>
      applyEnvironmentNameToCachedThread({ environment, thread }),
    );
  applyToCachedThreadListsAndSidebarNavigation(
    queryClient,
    applyEnvironmentName,
  );
  queryClient.invalidateQueries({ queryKey: threadSearchQueryKeyPrefix() });
  invalidateEnvironmentWorkspaceStateQueries({
    environmentId: environment.id,
    queryClient,
  });
}
