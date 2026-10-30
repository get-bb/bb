import type { QueryClient } from "@tanstack/react-query";
import { optimisticQueryUpdate } from "@bb/query-tags";
import type { Environment } from "@bb/domain";
import {
  environmentQueryKey,
  threadSearchQueryKeyPrefix,
} from "../queries/query-keys";
import { keepNewerByUpdatedAt } from "./cache-effect-utils";
import { invalidateEnvironmentWorkspaceStateQueries } from "./environment-cache-effects";
import {
  beginThreadEntityPrediction,
  findThreadEntityIds,
  patchThreadEntity,
  type ThreadEntityPrediction,
} from "./thread-entity-store";

interface EnvironmentUpdateResultArgs {
  environment: Environment;
  queryClient: QueryClient;
}

export interface EnvironmentNameUpdateTransaction {
  environmentId: string;
  name: string | null;
  prediction: ThreadEntityPrediction<Environment>;
}

export async function beginEnvironmentNameUpdateTransaction({
  environmentId,
  name,
  queryClient,
}: {
  environmentId: string;
  name: string | null;
  queryClient: QueryClient;
}): Promise<EnvironmentNameUpdateTransaction> {
  const nameFrom = (result: { value: Environment } | undefined) =>
    result === undefined ? name : result.value.name;
  return {
    environmentId,
    name,
    prediction: beginThreadEntityPrediction<Environment>(queryClient, {
      threadIds: findThreadEntityIds(
        queryClient,
        (thread) => thread.environmentId === environmentId,
      ),
      update: (entity, _threadId, result) => ({
        ...entity,
        list: entity.list && {
          ...entity.list,
          environmentName: nameFrom(result),
        },
      }),
      extra: [
        optimisticQueryUpdate<Environment, Environment>(
          environmentQueryKey(environmentId),
          (environment, result) => ({ ...environment, name: nameFrom(result) }),
        ),
      ],
    }),
  };
}

export function rollbackEnvironmentNameUpdateTransaction({
  transaction,
}: {
  queryClient: QueryClient;
  transaction: EnvironmentNameUpdateTransaction | undefined;
}): void {
  transaction?.prediction.fail();
}

export function completeEnvironmentNameUpdateTransaction({
  environment,
  queryClient,
  transaction,
}: {
  environment: Environment;
  queryClient: QueryClient;
  transaction: EnvironmentNameUpdateTransaction | undefined;
}): void {
  transaction?.prediction.succeed(environment);
  applyEnvironmentUpdateResult({ environment, queryClient });
}

export function applyEnvironmentUpdateResult({
  environment: result,
  queryClient,
}: EnvironmentUpdateResultArgs): void {
  const queryKey = environmentQueryKey(result.id);
  const environment = keepNewerByUpdatedAt(
    queryClient.getQueryData<Environment>(queryKey),
    result,
  );
  queryClient.setQueryData<Environment>(queryKey, environment);
  for (const threadId of findThreadEntityIds(
    queryClient,
    (thread) => thread.environmentId === environment.id,
  ))
    patchThreadEntity(queryClient, threadId, {
      environmentName: environment.name,
    });
  queryClient.invalidateQueries({ queryKey: threadSearchQueryKeyPrefix() });
  invalidateEnvironmentWorkspaceStateQueries({
    environmentId: environment.id,
    queryClient,
  });
}
