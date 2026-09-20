import { useCallback, useMemo, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ThreadImageMetadata,
  ThreadTimelineResponse,
} from "@bb/server-contract";
import { threadTimelineQueryKey } from "@/hooks/queries/query-keys";
import { sdk } from "@/lib/sdk";
import {
  MarkdownImageMetadataContext,
  markdownImageSourceIdentity,
  type MarkdownImageDimensions,
} from "@/components/ui/markdown-image-dimensions";

export function TimelineImageMetadata({
  threadId,
  children,
}: {
  threadId: string;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: threadTimelineQueryKey(threadId),
    queryFn: () => sdk.threads.timeline({ threadId }),
    enabled: false,
    select: (timeline) => timeline.imageMetadata,
  });
  const metadata = useMemo(
    () => new Map(data?.map((image) => [image.source, image])),
    [data],
  );
  const remember = useCallback(
    (
      source: string,
      dimensions: MarkdownImageDimensions,
      etag: string | null,
    ) => {
      const identity = markdownImageSourceIdentity(source);
      if (identity === null || !threadId) return;
      const previous = metadata.get(identity);
      if (
        previous?.width === dimensions.width &&
        previous.height === dimensions.height &&
        previous.etag === etag
      )
        return;
      const image: ThreadImageMetadata = {
        source: identity,
        ...dimensions,
        etag,
      };
      metadata.set(identity, image);
      void sdk.threads
        .saveImageMetadata({ threadId, ...image })
        .then(() => {
          queryClient.setQueryData<ThreadTimelineResponse>(
            threadTimelineQueryKey(threadId),
            (timeline) =>
              timeline && {
                ...timeline,
                imageMetadata: [
                  ...(timeline.imageMetadata ?? []).filter(
                    (entry) => entry.source !== identity,
                  ),
                  image,
                ],
              },
          );
        })
        .catch(() => {
          if (metadata.get(identity) === image) metadata.delete(identity);
        });
    },
    [metadata, queryClient, threadId],
  );
  const value = useMemo(
    () => ({
      read: (source: string) =>
        metadata.get(markdownImageSourceIdentity(source) ?? ""),
      remember,
    }),
    [metadata, remember],
  );
  return (
    <MarkdownImageMetadataContext.Provider value={value}>
      {children}
    </MarkdownImageMetadataContext.Provider>
  );
}
