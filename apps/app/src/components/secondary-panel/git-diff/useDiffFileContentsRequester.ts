import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { WorkspaceDiffTarget } from "@bb/domain";
import type { EnvironmentDiffFileResponse } from "@bb/server-contract";
import { environmentDiffFileQueryKey } from "@/hooks/queries/query-keys";
import { getEnvironmentDiffFile, type DiffFileTarget } from "@/lib/api";
import type {
  DiffFileContentsResult,
  RequestDiffFileContents,
} from "@/components/git-diff/GitDiffCardBody";

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
      return toDiffFileContentsResult(path, result);
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

// Browser-renderable raster image MIME types. Mirrors the extension allowlist
// in `isImageGitDiffFile` (SVG is text, so it diffs as hunks, not a preview).
const PREVIEWABLE_IMAGE_MIME_TYPES: ReadonlySet<string> = new Set([
  "image/avif",
  "image/bmp",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/vnd.microsoft.icon",
  "image/webp",
  "image/x-icon",
]);

/**
 * Map a `/diff/file` response into the card's `DiffFileContentsResult`. UTF-8
 * content becomes a `text` side @pierre/diffs can expand context from. A base64
 * blob with a browser-renderable image MIME type becomes an `image` side the
 * card previews inline (with its byte size for the header `+/-` delta). Anything
 * else (binary, non-image) yields `null` so the card leaves that side blank.
 */
function toDiffFileContentsResult(
  path: string,
  response: EnvironmentDiffFileResponse,
): DiffFileContentsResult | null {
  if (response.contentEncoding === "utf8") {
    return { kind: "text", file: { name: path, contents: response.content } };
  }
  const mimeType = response.mimeType;
  if (mimeType !== undefined && PREVIEWABLE_IMAGE_MIME_TYPES.has(mimeType)) {
    return {
      kind: "image",
      dataUrl: `data:${mimeType};base64,${response.content}`,
      sizeBytes: response.sizeBytes,
    };
  }
  return null;
}
