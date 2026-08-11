import type { QueryClient } from "@tanstack/react-query";

export function threadRewindBranchesQueryKey(threadId: string): string[] {
  return ["thread-rewind", "branches", threadId];
}

export function threadRewindPreviewQueryKey(
  args: {
    branchId: string;
    sourceSequence: number;
    threadId: string;
    turnId: string;
  },
  statusKey: string,
): string[] {
  return [
    "thread-rewind",
    "preview",
    args.threadId,
    args.branchId,
    String(args.sourceSequence),
    args.turnId,
    statusKey,
  ];
}

/**
 * Drop rewind caches after a commit or restore so the pencil set, the active
 * branch pointer, and any open previews all follow the new active lineage.
 */
export function invalidateThreadRewindCaches(
  queryClient: QueryClient,
  threadId: string,
): void {
  void queryClient.invalidateQueries({
    queryKey: threadRewindBranchesQueryKey(threadId),
  });
  void queryClient.invalidateQueries({
    queryKey: ["thread-rewind", "preview"],
  });
}
