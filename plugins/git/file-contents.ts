import { resolveDiffFileRef } from "./file-ref.js";
import { useCallback } from "react";
import { useSdk } from "@get-bb/plugin-sdk/app";
import type { Environment } from "@bb/domain";
import type { WorkspaceDiffTarget } from "bb-git-contract";
import type { RequestDiffFileContents } from "@bb/shared-ui/git-diff/card-body";

const IMAGE_MIME_TYPES = new Set([
  "image/avif",
  "image/bmp",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/vnd.microsoft.icon",
  "image/webp",
  "image/x-icon",
]);

export function useDiffFileContents(
  environment: Environment | null | undefined,
  target: WorkspaceDiffTarget | undefined,
  mergeBaseRef: string | null,
): RequestDiffFileContents {
  const sdk = useSdk();
  return useCallback(
    async (path, side) => {
      if (!environment?.path || !target) return null;
      if (path.startsWith("/") || path.split(/[\\/]/u).includes(".."))
        throw new Error("Invalid path");
      const ref = resolveDiffFileRef(target, side, mergeBaseRef);
      if (ref === null) return null;
      const result = await sdk.files.read({
        hostId: environment.hostId,
        rootPath: environment.path,
        path: `${environment.path.replace(/[\\/]$/u, "")}/${path}`,
        ...(ref === undefined ? {} : { ref }),
      });
      if (result.contentEncoding === "utf8")
        return { kind: "text", file: { name: path, contents: result.content } };
      if (result.mimeType && IMAGE_MIME_TYPES.has(result.mimeType))
        return {
          kind: "image",
          dataUrl: `data:${result.mimeType};base64,${result.content}`,
          sizeBytes: result.sizeBytes,
        };
      return null;
    },
    [environment, mergeBaseRef, sdk, target],
  );
}
