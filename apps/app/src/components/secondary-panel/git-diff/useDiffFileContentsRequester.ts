import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { FileContents } from "@pierre/diffs";
import type { WorkspaceDiffTarget } from "@bb/domain";
import { environmentDiffFileQueryKey } from "@/hooks/queries/query-keys";
import { getEnvironmentDiffFile, type DiffFileTarget } from "@/lib/api";
import type { RequestDiffFileContents } from "@/components/git-diff/GitDiffCardBody";

export interface UseDiffFileContentsRequesterArgs {
  environmentId?: string;
  target?: WorkspaceDiffTarget;
  /**
   * Resolved merge-base SHA from the diff TOC response. Required to lift a
   * branch-shaped `WorkspaceDiffTarget` into the SHA-shaped `DiffFileTarget`
   * the `/diff/file` content read uses; `null` when the target has no merge
   * base (the diff is empty and context expansion has nothing to reach).
   */
  mergeBaseRef: string | null;
}

/**
 * Builds the `onRequestFileContents` callback the diff cards use to lazily fetch
 * an `old`/`new` file side for @pierre/diffs' expand-context buttons. Threads
 * the TOC's resolved `mergeBaseRef` into the existing `/diff/file` content read
 * so context stays aligned with the exact ref the diff was computed against.
 *
 * Returns `undefined` until both the environment and a content-readable target
 * are available, which leaves expand-context disabled on the cards.
 */
export function useDiffFileContentsRequester({
  environmentId,
  target,
  mergeBaseRef,
}: UseDiffFileContentsRequesterArgs): RequestDiffFileContents | undefined {
  const queryClient = useQueryClient();
  const fileTarget = useMemo<DiffFileTarget | undefined>(
    () => buildDiffFileTarget(target, mergeBaseRef),
    [target, mergeBaseRef],
  );

  return useMemo<RequestDiffFileContents | undefined>(() => {
    if (!environmentId || fileTarget === undefined) return undefined;
    const envId = environmentId;
    const resolvedTarget = fileTarget;
    const targetKey = fileTargetKey(resolvedTarget);
    return async (path, side) => {
      const result = await queryClient.fetchQuery({
        queryKey: environmentDiffFileQueryKey(
          envId,
          resolvedTarget.type,
          targetKey,
          path,
          side,
        ),
        queryFn: () =>
          getEnvironmentDiffFile(envId, resolvedTarget, path, side),
        staleTime: 5_000,
      });
      return toFileContents(path, result.content, result.contentEncoding);
    };
  }, [environmentId, fileTarget, queryClient]);
}

function fileTargetKey(target: DiffFileTarget): string | null {
  switch (target.type) {
    case "uncommitted":
      return null;
    case "branch_committed":
    case "all":
      return target.mergeBaseRef;
    case "commit":
      return target.sha;
    default: {
      const _exhaustive: never = target;
      return _exhaustive;
    }
  }
}

/**
 * Lift a `WorkspaceDiffTarget` (branch-name-shaped) into a `DiffFileTarget`
 * (SHA-shaped) once the diff TOC has surfaced the resolved merge base. Returns
 * `undefined` when we don't yet have a SHA for the merge-base side — either the
 * TOC hasn't loaded, or the branch has no merge base with HEAD (the diff is
 * empty and context expansion has nothing to reach).
 */
function buildDiffFileTarget(
  target: WorkspaceDiffTarget | undefined,
  mergeBaseRef: string | null,
): DiffFileTarget | undefined {
  if (!target) return undefined;
  switch (target.type) {
    case "uncommitted":
      return { type: "uncommitted" };
    case "branch_committed":
      return mergeBaseRef
        ? { type: "branch_committed", mergeBaseRef }
        : undefined;
    case "all":
      return mergeBaseRef ? { type: "all", mergeBaseRef } : undefined;
    case "commit":
      return { type: "commit", sha: target.sha };
    default: {
      const _exhaustive: never = target;
      return _exhaustive;
    }
  }
}

function toFileContents(
  path: string,
  content: string,
  contentEncoding: "utf8" | "base64",
): FileContents | null {
  // `@pierre/diffs` wants a UTF-8 string; binary blobs come back base64. Skip
  // those — the diff-rendering library can't show context for binaries
  // (parsePatchFiles doesn't produce hunks for them anyway).
  if (contentEncoding !== "utf8") return null;
  return { name: path, contents: content };
}
