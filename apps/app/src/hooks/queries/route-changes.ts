import type {
  InfiniteData,
  QueryFunctionContext,
  QueryClient,
  QueryKey,
} from "@tanstack/react-query";
import type { ContractChangeDeclarations } from "@bb/domain";
import {
  CORE_CHANGE_SCOPE,
  applyQueryChanges,
  runLiveMutation,
  runLiveRead,
  type LiveMutationOutcome,
  liveQueryOptions,
  type OptimisticUpdate,
} from "@bb/query-changes";

export function routeLiveRead<Input, Output>(
  client: QueryClient,
  queryKey: QueryKey,
  route: ContractChangeDeclarations<Input, Output>,
  input: Input,
  read: (signal: AbortSignal) => Promise<Output>,
) {
  return liveQueryOptions<Output>(client, queryKey, {
    read: ({ signal }) => read(signal),
    scope: CORE_CHANGE_SCOPE,
    reactToChange: (data, change) =>
      route.experimental_reactToChange?.(input, data, change),
    dependenciesOf: (output) =>
      output === undefined
        ? undefined
        : (route.experimental_dependencies?.(input, output) ?? []),
  });
}

export function runRouteMutation<Input, Output, Result extends Output>(
  client: QueryClient,
  route: ContractChangeDeclarations<Input, Output>,
  input: Input,
  call: () => Promise<Result>,
  options?: { optimistic: readonly OptimisticUpdate[] },
): Promise<Result> {
  return runLiveMutation(
    (changes) => applyQueryChanges(client, CORE_CHANGE_SCOPE, changes),
    () => callRoute(route, input, call),
    options && { client, optimistic: options.optimistic },
  );
}

export async function callRoute<Input, Output, Result extends Output>(
  route: ContractChangeDeclarations<Input, Output>,
  input: Input,
  call: () => Promise<Result>,
): Promise<LiveMutationOutcome<Result>> {
  const output = await call();
  return {
    result: output,
    changes: route.experimental_changes?.(input, output) ?? [],
  };
}

function isInfiniteData<Output>(
  data: InfiniteData<Output> | Output,
): data is InfiniteData<Output> {
  return (
    typeof data === "object" &&
    data !== null &&
    "pages" in data &&
    "pageParams" in data
  );
}
export function routeLivePages<Input, Output>(
  client: QueryClient,
  queryKey: QueryKey,
  route: ContractChangeDeclarations<Input, Output>,
  input: Input,
  read: (page: number, signal: AbortSignal) => Promise<Output>,
) {
  return {
    ...liveQueryOptions<InfiniteData<Output> | Output>(client, queryKey, {
      scope: CORE_CHANGE_SCOPE,
      dependenciesOf: (data) =>
        data === undefined
          ? undefined
          : (isInfiniteData<Output>(data) ? data.pages : [data]).flatMap(
              (output) =>
                route.experimental_dependencies?.(input, output) ?? [],
            ),
    }),
    queryFn: ({
      client,
      queryKey,
      pageParam,
      signal,
    }: QueryFunctionContext<QueryKey, number>) =>
      runLiveRead(client, queryKey, () => read(pageParam, signal)),
  };
}
