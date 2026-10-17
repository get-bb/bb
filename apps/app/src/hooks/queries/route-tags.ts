import type {
  QueryClient,
  QueryFunctionContext,
  QueryKey,
} from "@tanstack/react-query";
import type { ContractTagDeclarations } from "@bb/domain";
import {
  CORE_TAG_SCOPE,
  invalidateTags,
  runTaggedRead,
  runTaggedMutation,
  taggedQueryOptions,
  type TaggedOptimisticUpdate,
} from "@bb/query-tags";

export function routeTaggedRead<Input, Output>(
  client: QueryClient,
  queryKey: QueryKey,
  route: ContractTagDeclarations<Input, Output>,
  input: Input,
  read: (signal: AbortSignal) => Promise<Output>,
) {
  return {
    ...taggedQueryOptions<Output>(client, queryKey, {
      scope: CORE_TAG_SCOPE,
      tagsOf: (output) => route.tags?.(input, output) ?? [],
    }),
    queryFn: ({ client, queryKey, signal }: QueryFunctionContext) =>
      runTaggedRead(client, queryKey, () => read(signal)),
  };
}

export function runRouteMutation<Input, Output, Result extends Output>(
  client: QueryClient,
  route: ContractTagDeclarations<Input, Output>,
  input: Input,
  call: () => Promise<Result>,
  options?: { optimistic: readonly TaggedOptimisticUpdate[] },
): Promise<Result> {
  return runTaggedMutation(
    (tags) => invalidateTags(client, CORE_TAG_SCOPE, tags),
    async () => {
      const output = await call();
      return {
        result: output,
        invalidated: route.invalidates?.(input, output) ?? [],
      };
    },
    options && { client, optimistic: options.optimistic },
  );
}
