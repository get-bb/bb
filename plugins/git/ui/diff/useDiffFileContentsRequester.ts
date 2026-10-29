import { useMemo } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type {
  DiffFileContentsResult,
  RequestDiffFileContents,
} from "@bb/shared-ui/git-diff/card-body";
import type {
  GitFileContent,
  GitFileSideQuery,
  WorkspaceDiffTarget,
} from "../../contract.js";
import type { gitRpcContract } from "../../rpc-contract.js";

const FILE_SIDE_FRESH_MS = 5_000;

type DiffFileSide = GitFileSideQuery["side"];

type DiffFileTarget =
  | { target: "uncommitted" }
  | { target: "branch_committed"; mergeBaseRef: string }
  | { target: "all"; mergeBaseRef: string }
  | { target: "commit"; sha: string };

interface CachedFileSide {
  promise: Promise<GitFileContent>;
  settledAt: number | null;
}

const fileSideCache = new Map<string, CachedFileSide>();

function isFresh(entry: CachedFileSide, now: number): boolean {
  return entry.settledAt === null || now - entry.settledAt < FILE_SIDE_FRESH_MS;
}

function pruneStaleFileSides(now: number): void {
  for (const [key, entry] of fileSideCache) {
    if (!isFresh(entry, now)) fileSideCache.delete(key);
  }
}

function loadFileSide(
  key: string,
  load: () => Promise<GitFileContent>,
): Promise<GitFileContent> {
  const now = Date.now();
  pruneStaleFileSides(now);
  const cached = fileSideCache.get(key);
  if (cached !== undefined) return cached.promise;
  const entry: CachedFileSide = { promise: load(), settledAt: null };
  fileSideCache.set(key, entry);
  entry.promise.then(
    () => {
      entry.settledAt = Date.now();
    },
    () => {
      if (fileSideCache.get(key) === entry) fileSideCache.delete(key);
    },
  );
  return entry.promise;
}

interface UseDiffFileContentsRequesterArgs {
  environmentId: string;
  target: WorkspaceDiffTarget | undefined;
  mergeBaseRef: string | null;
}

export function useDiffFileContentsRequester({
  environmentId,
  target,
  mergeBaseRef,
}: UseDiffFileContentsRequesterArgs): RequestDiffFileContents | undefined {
  const rpc = useRpc<typeof gitRpcContract>();
  const fileTarget = useMemo(
    () => buildDiffFileTarget(target, mergeBaseRef),
    [target, mergeBaseRef],
  );

  return useMemo<RequestDiffFileContents | undefined>(() => {
    if (fileTarget === undefined) return undefined;
    return async (path, side) => {
      const query = buildFileSideQuery(fileTarget, path, side);
      const result = await loadFileSide(
        JSON.stringify([environmentId, query]),
        async () => {
          const side = await rpc.call("fileSide", { environmentId, query });
          if (side.outcome === "unavailable") throw new Error(side.message);
          return side.file;
        },
      );
      return toDiffFileContentsResult(path, result);
    };
  }, [environmentId, fileTarget, rpc]);
}

function buildFileSideQuery(
  target: DiffFileTarget,
  path: string,
  side: DiffFileSide,
): GitFileSideQuery {
  switch (target.target) {
    case "uncommitted":
      return { target: "uncommitted", path, side };
    case "branch_committed":
    case "all":
      return { target: target.target, mergeBaseRef: target.mergeBaseRef, path, side };
    case "commit":
      return { target: "commit", sha: target.sha, path, side };
  }
}

function buildDiffFileTarget(
  target: WorkspaceDiffTarget | undefined,
  mergeBaseRef: string | null,
): DiffFileTarget | undefined {
  if (!target) return undefined;
  switch (target.type) {
    case "uncommitted":
      return { target: "uncommitted" };
    case "branch_committed":
      return mergeBaseRef
        ? { target: "branch_committed", mergeBaseRef }
        : undefined;
    case "all":
      return mergeBaseRef ? { target: "all", mergeBaseRef } : undefined;
    case "commit":
      return { target: "commit", sha: target.sha };
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
