import type { QueryClientArg } from "../cache-effect-types";
import { savedThreadsQueryKeyPrefix } from "../queries/query-keys";
import { invalidateThreadListQueries } from "./mutation-cache-effects";

export async function invalidateSavedThreadQueries({
  queryClient,
}: QueryClientArg): Promise<void> {
  invalidateThreadListQueries({ queryClient });
  await queryClient.invalidateQueries({
    queryKey: savedThreadsQueryKeyPrefix(),
  });
}
