import { useQuery } from "@tanstack/react-query";
import { sdk } from "@/lib/sdk";
import {
  buildFilePreview,
  isHtmlFilePreviewPath,
  normalizeFilePreviewMimeType,
  type FilePreview,
} from "@/lib/file-preview";
import { hostFilePreviewQueryKey } from "./query-keys";
import { HEAVY_PAYLOAD_QUERY_POLICY } from "./query-policies";

interface QueryOptions {
  enabled?: boolean;
}

interface HostMediaPreviewType {
  kind: "image" | "video";
  mimeType: string;
}

const HOST_MEDIA_PREVIEW_TYPES = new Map<string, HostMediaPreviewType>([
  [".avif", { kind: "image", mimeType: "image/avif" }],
  [".bmp", { kind: "image", mimeType: "image/bmp" }],
  [".gif", { kind: "image", mimeType: "image/gif" }],
  [".heic", { kind: "image", mimeType: "image/heic" }],
  [".heif", { kind: "image", mimeType: "image/heif" }],
  [".ico", { kind: "image", mimeType: "image/vnd.microsoft.icon" }],
  [".jpeg", { kind: "image", mimeType: "image/jpeg" }],
  [".jpg", { kind: "image", mimeType: "image/jpeg" }],
  [".png", { kind: "image", mimeType: "image/png" }],
  [".svg", { kind: "image", mimeType: "image/svg+xml" }],
  [".svgz", { kind: "image", mimeType: "image/svg+xml" }],
  [".tif", { kind: "image", mimeType: "image/tiff" }],
  [".tiff", { kind: "image", mimeType: "image/tiff" }],
  [".webp", { kind: "image", mimeType: "image/webp" }],
  [".3g2", { kind: "video", mimeType: "video/3gpp2" }],
  [".3gp", { kind: "video", mimeType: "video/3gpp" }],
  [".avi", { kind: "video", mimeType: "video/x-msvideo" }],
  [".m4v", { kind: "video", mimeType: "video/x-m4v" }],
  [".mov", { kind: "video", mimeType: "video/quicktime" }],
  [".mp4", { kind: "video", mimeType: "video/mp4" }],
  [".mpeg", { kind: "video", mimeType: "video/mpeg" }],
  [".mpg", { kind: "video", mimeType: "video/mpeg" }],
  [".ogv", { kind: "video", mimeType: "video/ogg" }],
  [".webm", { kind: "video", mimeType: "video/webm" }],
  [".wmv", { kind: "video", mimeType: "video/x-ms-wmv" }],
]);

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

function getHostMediaPreviewType(name: string): HostMediaPreviewType | null {
  const extensionIndex = name.lastIndexOf(".");
  if (extensionIndex <= 0) return null;
  return (
    HOST_MEDIA_PREVIEW_TYPES.get(name.slice(extensionIndex).toLowerCase()) ??
    null
  );
}

export function useHostFilePreview(
  hostId: string | null,
  path: string | null,
  options?: QueryOptions,
) {
  const enabled =
    (options?.enabled ?? true) && hostId !== null && path !== null;
  const activeHostId = enabled ? hostId : null;
  const activePath = enabled ? path : null;
  return useQuery<FilePreview>({
    // Move a retained-but-disabled observer off the heavy payload's key. That
    // aborts an in-flight read and lets the one-minute GC policy start while
    // the closed panel body remains mounted.
    queryKey: hostFilePreviewQueryKey(activeHostId, activePath),
    queryFn: async ({ signal }) => {
      if (activeHostId === null || activePath === null) {
        throw new Error("Host file preview target is incomplete");
      }
      const { name, rootPath } = splitAbsoluteHostFilePath(activePath);
      const previewLease = await sdk.files
        .createPreview({ hostId: activeHostId, rootPath, signal })
        .catch(() => null);
      signal.throwIfAborted();
      const previewUrl =
        previewLease === null
          ? null
          : `${previewLease.baseUrl}/${encodeURIComponent(name)}`;
      const mediaPreviewType = getHostMediaPreviewType(name);
      if (previewUrl !== null && mediaPreviewType !== null) {
        return { ...mediaPreviewType, name, path: activePath, url: previewUrl };
      }

      const response = await sdk.files.read({
        hostId: activeHostId,
        path: activePath,
        signal,
      });
      const contentBytes =
        response.contentEncoding === "base64"
          ? decodeBase64Bytes(response.content)
          : new TextEncoder().encode(response.content);
      const mimeType = normalizeFilePreviewMimeType(response.mimeType ?? null);
      const preview = buildFilePreview({
        contentBytes,
        mimeType,
        name,
        path: activePath,
        url: previewUrl ?? activePath,
      });
      if (
        previewUrl !== null ||
        (preview.kind !== "image" &&
          preview.kind !== "video" &&
          !isHtmlFilePreviewPath(activePath))
      ) {
        return preview;
      }

      const base64Content =
        response.contentEncoding === "base64"
          ? response.content
          : encodeBase64Bytes(contentBytes);
      return {
        ...preview,
        url: `data:${mimeType};base64,${base64Content}`,
      };
    },
    enabled,
    staleTime: 30_000,
    ...HEAVY_PAYLOAD_QUERY_POLICY,
  });
}
