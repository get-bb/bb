import type { QueryClient, QueryFunctionContext } from "@tanstack/react-query";
import type { ContractTagDeclarations } from "@bb/domain";
import {
  CORE_TAG_SCOPE,
  invalidateTags,
  runTaggedRead,
  runTaggedMutation,
  taggedQueryMeta,
} from "@bb/query-tags";

export function routeTaggedRead<Input, Output>(
  route: ContractTagDeclarations<Input, Output>,
  input: Input,
  read: (signal: AbortSignal) => Promise<Output>,
) {
  return {
    meta: taggedQueryMeta<Output>({
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
  );
}
