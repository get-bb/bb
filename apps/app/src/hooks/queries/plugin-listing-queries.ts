import { useQuery } from "@tanstack/react-query";
import type { PluginListingRecord } from "@bb/server-contract";
import { createPluginsClient } from "./plugin-client";

import { pluginListingsQueryKey } from "./query-keys";
export { pluginListingsQueryKey } from "./query-keys";

export function usePluginListings() {
  return useQuery({
    queryKey: pluginListingsQueryKey(),
    queryFn: () => createPluginsClient(fetch).listings.list(),
    staleTime: 30_000,
  });
}

export function pluginListingActionLabel(record: PluginListingRecord): string {
  switch (record.lifecycle.status) {
    case "draft":
      return "Submit";
    case "in-review":
      return "Update submission";
    case "published":
      return "Publish update";
  }
}

export function pluginListingTaskPrompt(record: PluginListingRecord): string {
  const action = pluginListingActionLabel(record);
  return [
    `Use the submit-a-plugin skill to ${action.toLowerCase()} ${record.entry.displayName} (${record.pluginId}).`,
    `This is an explicitly authored plugin. Its current listing is:\n${JSON.stringify(record.entry, null, 2)}`,
    record.lifecycle.status === "in-review"
      ? `Update the existing submission at ${record.lifecycle.pullRequest.url}; do not create a duplicate pull request.`
      : record.lifecycle.status === "published"
        ? `Update the published marketplace entry ${record.lifecycle.entryId}.`
        : "Prepare and validate the marketplace submission using the existing authored listing.",
    "Preserve this listing's ownership and reconcile its submission state through bb plugin listing commands.",
  ].join("\n\n");
}
