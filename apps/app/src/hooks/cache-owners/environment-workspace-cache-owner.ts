import type { QueryClient } from "@tanstack/react-query";
import type { Environment, ThreadListEntry } from "@bb/domain";
import {
  environmentQueryKey,
  sidebarNavigationQueryKey,
  threadSearchQueryKeyPrefix,
  threadsQueryKey,
} from "../queries/query-keys";
import { invalidateEnvironmentWorkspaceStateQueries } from "./environment-cache-effects";
import {
  applyToCachedThreadListsAndSidebarNavigation,
  applyToCachedSidebarNavigationThreads,
  listSidebarNavigationThreads,
  snapshotCachedSidebarNavigation,
  type CachedSidebarNavigationSnapshot,
  type CachedThreadListsAndSidebarNavigationMapper,
} from "./query-cache";
import {
  applyToCachedThreadLists,
  getCachedThreadLists,
  iterateThreadListCacheEntries,
  type CachedThreadListSnapshot,
} from "./thread-list-cache-data";

interface EnvironmentUpdateResultArgs {
  environment: Environment;
  queryClient: QueryClient;
}

interface ApplyEnvironmentNameToCachedThreadArgs {
  environment: Environment;
  thread: ThreadListEntry;
}

interface BeginEnvironmentNameUpdateTransactionArgs {
  environmentId: string;
  name: string | null;
  queryClient: QueryClient;
}

interface RollbackEnvironmentNameUpdateTransactionArgs {
  queryClient: QueryClient;
  transaction: EnvironmentNameUpdateTransaction | undefined;
}

interface CompleteEnvironmentNameUpdateTransactionArgs {
  environment: Environment;
  queryClient: QueryClient;
  transaction: EnvironmentNameUpdateTransaction | undefined;
}

export interface EnvironmentNameUpdateTransaction {
  environmentId: string;
  name: string | null;
  previousEnvironment: Environment | undefined;
  previousSidebarNavigation: CachedSidebarNavigationSnapshot;
  previousThreadLists: CachedThreadListSnapshot;
}

function applyEnvironmentNameToThread(
  thread: ThreadListEntry,
  environmentId: string,
  name: string | null,
): ThreadListEntry {
  return thread.environmentId === environmentId
    ? { ...thread, environmentName: name }
    : thread;
}

function applyEnvironmentNameToCachedThread({
  environment,
  thread,
}: ApplyEnvironmentNameToCachedThreadArgs): ThreadListEntry {
  return applyEnvironmentNameToThread(thread, environment.id, environment.name);
}

function isEnvironmentNameCurrent(
  queryClient: QueryClient,
  environmentId: string,
  name: string | null,
): boolean {
  const environment = queryClient.getQueryData<Environment>(
    environmentQueryKey(environmentId),
  );
  if (environment !== undefined) return environment.name === name;

  for (const snapshot of getCachedThreadLists(queryClient, {
    queryKey: threadsQueryKey(),
  })) {
    const thread = [...iterateThreadListCacheEntries(snapshot.data)].find(
      (entry) => entry.environmentId === environmentId,
    );
    if (thread !== undefined) return thread.environmentName === name;
  }

  const sidebarNavigation = snapshotCachedSidebarNavigation(queryClient);
  const thread = sidebarNavigation
    ? listSidebarNavigationThreads(sidebarNavigation).find(
        (entry) => entry.environmentId === environmentId,
      )
    : undefined;
  return thread === undefined || thread.environmentName === name;
}

export async function beginEnvironmentNameUpdateTransaction({
  environmentId,
  name,
  queryClient,
}: BeginEnvironmentNameUpdateTransactionArgs): Promise<EnvironmentNameUpdateTransaction> {
  await queryClient.cancelQueries({
    queryKey: environmentQueryKey(environmentId),
  });
  await queryClient.cancelQueries({ queryKey: threadsQueryKey() });
  await queryClient.cancelQueries({ queryKey: sidebarNavigationQueryKey() });

  const previousEnvironment = queryClient.getQueryData<Environment>(
    environmentQueryKey(environmentId),
  );
  const previousThreadLists = getCachedThreadLists(queryClient, {
    queryKey: threadsQueryKey(),
  });
  const previousSidebarNavigation =
    snapshotCachedSidebarNavigation(queryClient);

  queryClient.setQueryData<Environment>(
    environmentQueryKey(environmentId),
    (environment) =>
      environment === undefined ? environment : { ...environment, name },
  );
  applyToCachedThreadListsAndSidebarNavigation(queryClient, (threads) =>
    threads.map((thread) =>
      applyEnvironmentNameToThread(thread, environmentId, name),
    ),
  );

  return {
    environmentId,
    name,
    previousEnvironment,
    previousSidebarNavigation,
    previousThreadLists,
  };
}

export function rollbackEnvironmentNameUpdateTransaction({
  queryClient,
  transaction,
}: RollbackEnvironmentNameUpdateTransactionArgs): void {
  if (transaction === undefined) return;
  const { environmentId, name } = transaction;
  queryClient.setQueryData<Environment>(
    environmentQueryKey(environmentId),
    (environment) =>
      environment?.name === name &&
      transaction.previousEnvironment !== undefined
        ? { ...environment, name: transaction.previousEnvironment.name }
        : environment,
  );

  const restoreThread = (
    thread: ThreadListEntry,
    previousName: string | null | undefined,
  ): ThreadListEntry =>
    thread.environmentId === environmentId &&
    thread.environmentName === name &&
    previousName !== undefined
      ? { ...thread, environmentName: previousName }
      : thread;

  for (const snapshot of transaction.previousThreadLists) {
    const previousName = [...iterateThreadListCacheEntries(snapshot.data)].find(
      (thread) => thread.environmentId === environmentId,
    )?.environmentName;
    applyToCachedThreadLists(queryClient, {
      queryKey: snapshot.queryKey,
      mapper: (threads) =>
        threads.map((thread) => restoreThread(thread, previousName)),
    });
  }

  const previousName = transaction.previousSidebarNavigation
    ? listSidebarNavigationThreads(transaction.previousSidebarNavigation).find(
        (thread) => thread.environmentId === environmentId,
      )?.environmentName
    : undefined;
  applyToCachedSidebarNavigationThreads({
    queryClient,
    mapper: (threads) =>
      threads.map((thread) => restoreThread(thread, previousName)),
  });
}

export function completeEnvironmentNameUpdateTransaction({
  environment,
  queryClient,
  transaction,
}: CompleteEnvironmentNameUpdateTransactionArgs): void {
  if (
    transaction !== undefined &&
    !isEnvironmentNameCurrent(
      queryClient,
      transaction.environmentId,
      transaction.name,
    )
  ) {
    return;
  }
  applyEnvironmentUpdateResult({ environment, queryClient });
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
