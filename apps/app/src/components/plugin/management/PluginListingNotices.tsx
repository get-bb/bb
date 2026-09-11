import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ResourceActionButton } from "@bb/shared-ui/resource-list";
import { PluginBannerBar } from "@/components/tools/plugin-detail-banner";
import {
  usePluginListings,
  pluginListingsQueryKey,
} from "@/hooks/queries/plugin-listing-queries";
import { createPluginsClient } from "@/hooks/queries/plugin-client";

export function PluginListingNotices() {
  const listings = usePluginListings();
  const queryClient = useQueryClient();
  const acknowledge = useMutation({
    mutationFn: (noticeId: string) =>
      createPluginsClient(fetch).listings.consumeNotice({ noticeId }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: pluginListingsQueryKey() }),
  });
  return (
    <>
      {listings.data?.notices.map((notice) => (
        <PluginBannerBar
          key={notice.id}
          tone="muted"
          icon={notice.kind === "published" ? "Check" : "Info"}
          title={
            notice.kind === "published"
              ? `${notice.pluginName} is published`
              : `${notice.pluginName} is ready for another submission`
          }
          detail={
            <a
              href={notice.pullRequestUrl}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              View marketplace pull request
            </a>
          }
          action={
            <ResourceActionButton
              label="Dismiss publication notice"
              icon="X"
              disabled={acknowledge.isPending}
              onClick={() => acknowledge.mutate(notice.id)}
            />
          }
        />
      ))}
    </>
  );
}
