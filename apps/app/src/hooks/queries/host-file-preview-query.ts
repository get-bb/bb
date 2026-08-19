import { useQuery } from "@tanstack/react-query";
import { sdk } from "@/lib/sdk";
import {
  buildFilePreview,
  normalizeFilePreviewMimeType,
  type FilePreview,
} from "@/lib/file-preview";
import { hostFilePreviewQueryKey } from "./query-keys";

function decodeBase64Bytes(content: string): Uint8Array {
  const binaryContent = atob(content);
  const bytes = new Uint8Array(binaryContent.length);
  for (let index = 0; index < binaryContent.length; index += 1) {
    bytes[index] = binaryContent.charCodeAt(index);
  }
  return bytes;
}

function encodeBase64Bytes(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  const binaryChunks: string[] = [];
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binaryChunks.push(
      String.fromCharCode(...bytes.subarray(index, index + chunkSize)),
    );
  }
  return btoa(binaryChunks.join(""));
}

function splitAbsoluteHostFilePath(path: string): {
  name: string;
  rootPath: string;
} {
  const lastSeparatorIndex = Math.max(
    path.lastIndexOf("/"),
    path.lastIndexOf("\\"),
  );
  const name = path.slice(lastSeparatorIndex + 1);
  let rootPath = path.slice(0, lastSeparatorIndex);
  if (lastSeparatorIndex === 0) rootPath = "/";
  if (/^[A-Za-z]:$/u.test(rootPath)) {
    rootPath = `${rootPath}${path[lastSeparatorIndex] ?? "\\"}`;
  }
  return { name, rootPath };
}

export function useHostFilePreview(hostId: string | null, path: string | null) {
  const enabled = hostId !== null && path !== null;
  return useQuery<FilePreview>({
    queryKey: hostFilePreviewQueryKey(hostId, path),
    queryFn: async ({ signal }) => {
      if (hostId === null || path === null) {
        throw new Error("Host file preview target is incomplete");
      }
      const response = await sdk.files.read({ hostId, path, signal });
      const contentBytes =
        response.contentEncoding === "base64"
          ? decodeBase64Bytes(response.content)
          : new TextEncoder().encode(response.content);
      const mimeType = normalizeFilePreviewMimeType(response.mimeType ?? null);
      const base64Content =
        response.contentEncoding === "base64"
          ? response.content
          : encodeBase64Bytes(contentBytes);
      const { name, rootPath } = splitAbsoluteHostFilePath(path);
      const previewLease = await sdk.files
        .createPreview({ hostId, rootPath, signal })
        .catch(() => null);
      const url =
        previewLease === null
          ? `data:${mimeType};base64,${base64Content}`
          : `${previewLease.baseUrl}/${encodeURIComponent(name)}`;
      return buildFilePreview({ contentBytes, mimeType, name, path, url });
    },
    enabled,
    staleTime: 30_000,
  });
}
