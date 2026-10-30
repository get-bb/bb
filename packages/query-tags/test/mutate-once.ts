import { renderHook } from "@testing-library/react";
import type { QueryClient } from "@tanstack/react-query";
import {
  useTaggedMutation,
  type OptimisticUpdate,
  type TaggedMutationOutcome,
} from "../src/index.js";

export function mutateOnce<Result>(
  invalidate: (tags: readonly string[]) => Promise<void>,
  call: () => Promise<TaggedMutationOutcome<Result>>,
  options: { client: QueryClient; optimistic?: readonly OptimisticUpdate[] },
): Promise<Result> {
  const hook = renderHook(() =>
    useTaggedMutation<void, Result>({
      client: options.client,
      invalidate,
      call,
      optimistic: () => options.optimistic ?? [],
    }),
  );
  return hook.result.current.mutate(undefined).finally(hook.unmount);
}
