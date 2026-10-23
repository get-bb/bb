import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { environmentDiffFileQueryKey } from "@/hooks/queries/query-keys";
import { gitPluginReads } from "@/hooks/queries/git-plugin-reads";
import type {
  DiffFileContentsResult,
  RequestDiffFileContents,
} from "@/components/git-diff/GitDiffCardBody";
import type { WorkspaceDiffTarget } from "@bb/domain";
import type {
  GitFileContent,
  GitFileSideQuery,
} from "bb-plugin-bb--git/contract";

interface UseDiffFileContentsRequesterArgs {
  environmentId?: string;
  target?: WorkspaceDiffTarget;
  mergeBaseRef: string | null;
}

type DiffFileTarget =
  | { type: "uncommitted" }
  | { type: "branch_committed"; mergeBaseRef: string }
  | { type: "all"; mergeBaseRef: string }
  | { type: "commit"; sha: string };

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
        queryFn: async ({ signal }) => {
          const result = await gitPluginReads.fileSide(
            {
              environmentId: envId,
              query: buildFileSideQuery(resolvedTarget, path, side),
            },
            signal,
          );
          if (result.outcome === "unavailable") throw new Error(result.message);
          return result.file;
        },
        staleTime: 5_000,
      });
      return toDiffFileContentsResult(path, result);
    };
  }, [environmentId, fileTarget, queryClient]);
}

function buildFileSideQuery(
  target: DiffFileTarget,
  path: string,
  side: "old" | "new",
): GitFileSideQuery {
  switch (target.type) {
    case "uncommitted":
      return { target: target.type, path, side };
    case "branch_committed":
    case "all":
      return {
        target: target.type,
        mergeBaseRef: target.mergeBaseRef,
        path,
        side,
      };
    case "commit":
      return { target: target.type, sha: target.sha, path, side };
  }
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

function toDiffFileContentsResult(
  path: string,
  response: GitFileContent,
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
