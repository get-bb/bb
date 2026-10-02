import { useQuery } from "@tanstack/react-query";
import { loadFilePreview } from "@/lib/api";
import { buildHostFileContentUrl } from "@/lib/file-content-urls";
import type { FilePreview } from "@bb/client-core";
import type { QueryOptions } from "./query-helpers";
import { hostFilePreviewQueryKey } from "./query-keys";
import { HEAVY_PAYLOAD_QUERY_POLICY } from "./query-policies";

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
    queryKey: hostFilePreviewQueryKey(activeHostId, activePath),
    queryFn: async ({ signal }) => {
      if (activeHostId === null || activePath === null) {
        throw new Error("Host file preview target is incomplete");
      }
      const name = activePath.split(/[\\/]/u).at(-1) ?? activePath;
      const url = buildHostFileContentUrl(activeHostId, activePath);
      const mediaPreviewType = getHostMediaPreviewType(name);
      if (mediaPreviewType !== null) {
        return { ...mediaPreviewType, name, path: activePath, url };
      }
      return loadFilePreview({ name, path: activePath, url }, signal);
    },
    enabled,
    staleTime: 30_000,
    ...HEAVY_PAYLOAD_QUERY_POLICY,
  });
}
