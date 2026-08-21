import { useQuery } from "@tanstack/react-query";
import { useProfileClient } from "@/app-shell/ProfilesProvider";
import { serverSvgAssetQueryKey } from "@/lib/query/query-keys";
import { SESSION_STATIC_QUERY_POLICY } from "../shared/query-policies";

const SVG_ASSET_MAX_BYTES = 256 * 1024;

/** Absolute URL of a server-relative asset path (`/api/v1/...`) or pass-through. */
function resolveServerAssetUrl(serverUrl: string, path: string): string {
  if (/^https?:\/\//iu.test(path)) return path;
  const base = serverUrl.replace(/\/+$/u, "");
  return `${base}${path.startsWith("/") ? "" : "/"}${path}`;
}

/** Whether a response body looks like an SVG document we can hand to SvgXml. */
function isSvgDocument(text: string): boolean {
  return /<svg[\s>]/iu.test(text.slice(0, 4096));
}

async function fetchSvgAsset(
  fetchImpl: typeof fetch,
  url: string,
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetchImpl(url, { signal });
  if (!response.ok) {
    throw new Error(`Could not load icon (HTTP ${response.status})`);
  }
  const text = await response.text();
  if (text.length > SVG_ASSET_MAX_BYTES || !isSvgDocument(text)) {
    throw new Error("Icon is not an SVG document");
  }
  return text;
}

/**
 * A server-served SVG read as text so react-native-svg can render it with a
 * real `currentColor` (the branding SVGs bb serves use `fill="currentColor"`,
 * which an image view would paint black). Session-static: the URLs are
 * content-hashed or immutable branding.
 */
export function useServerSvgAsset(path: string | null) {
  const { fetch: profileFetch, serverUrl } = useProfileClient();
  const url = path === null ? null : resolveServerAssetUrl(serverUrl, path);
  return useQuery<string>({
    queryKey: serverSvgAssetQueryKey(url ?? ""),
    queryFn: ({ signal }) => fetchSvgAsset(profileFetch, url ?? "", signal),
    enabled: url !== null,
    retry: false,
    ...SESSION_STATIC_QUERY_POLICY,
  });
}
