import type {
  ServerMoveStatus,
  ServerMoveStatusResponse,
} from "@bb/server-contract";
import type { QueryClientArg } from "../cache-effect-types";
import { serverMoveStatusQueryKey } from "../queries/query-keys";

interface ApplyServerMoveStatusArgs extends QueryClientArg {
  move: ServerMoveStatus;
}

export function invalidateServerMoveStatus({
  queryClient,
}: QueryClientArg): Promise<void> {
  return queryClient.invalidateQueries({
    queryKey: serverMoveStatusQueryKey(),
  });
}

export async function applyServerMoveStatus({
  move,
  queryClient,
}: ApplyServerMoveStatusArgs): Promise<void> {
  const queryKey = serverMoveStatusQueryKey();
  await queryClient.cancelQueries({ queryKey });
  queryClient.setQueryData<ServerMoveStatusResponse>(queryKey, (previous) => ({
    move,
    lastMove: previous?.lastMove ?? null,
  }));
  void queryClient.invalidateQueries({ queryKey });
}

export function invalidateQueriesAfterServerMove({
  queryClient,
}: QueryClientArg): void {
  void queryClient.invalidateQueries();
}
