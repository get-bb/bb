import { useQuery, useQueryClient } from "@tanstack/react-query";
import { threadTimelineQueryOptions } from "@/hooks/queries/thread-panel-queries";
import { usePluginId } from "./plugin-context";

export function usePluginThreadExtensionState(
  threadId: string,
  kind: string,
): unknown {
  const queryClient = useQueryClient();
  const extensionKind = `${usePluginId()}/${kind}`;
  const { data } = useQuery({
    ...threadTimelineQueryOptions(queryClient, threadId, {
      refetchOnMount: false,
    }),
    select: (timeline) => timeline.extensionStates[extensionKind] ?? null,
  });
  return data ?? null;
}
