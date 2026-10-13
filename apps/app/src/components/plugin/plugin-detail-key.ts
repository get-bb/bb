import { getPluginDetailRoutePath } from "@/lib/route-paths";

const LISTING_SEARCH_PARAM = "listing";

export interface PluginDetailTarget {
  pluginId: string;
  listing: string | null;
}

export function pluginDetailKey({
  pluginId,
  listing,
}: PluginDetailTarget): string {
  return listing === null ? pluginId : `${listing}/${pluginId}`;
}

export function parsePluginDetailKey(detailKey: string): PluginDetailTarget {
  const separator = detailKey.indexOf("/");
  return separator < 0
    ? { pluginId: detailKey, listing: null }
    : {
        listing: detailKey.slice(0, separator),
        pluginId: detailKey.slice(separator + 1),
      };
}

export function pluginDetailKeyFromRoute(
  pluginId: string,
  search: string,
): string {
  return pluginDetailKey({
    pluginId,
    listing: new URLSearchParams(search).get(LISTING_SEARCH_PARAM),
  });
}

export function pluginDetailLocation(
  detailKey: string,
  search: string,
): { pathname: string; search: string } {
  const { pluginId, listing } = parsePluginDetailKey(detailKey);
  const params = new URLSearchParams(search);
  if (listing === null) params.delete(LISTING_SEARCH_PARAM);
  else params.set(LISTING_SEARCH_PARAM, listing);
  return {
    pathname: getPluginDetailRoutePath({ pluginId }),
    search: params.toString(),
  };
}

export function withoutPluginListing(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(LISTING_SEARCH_PARAM);
  return params.toString();
}
