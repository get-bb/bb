import { useQueryClient } from "@tanstack/react-query";
import type { TimelineConversationRow } from "@bb/server-contract";
import { stripModelBrandPrefix } from "@/components/pickers/model-brand-prefix";
import {
  findCachedProviderModel,
  useSystemProviderInfo,
} from "@/hooks/queries/system-queries";
import { formatModelLabel } from "@/hooks/thread-creation-options/selection-state";
import { reasoningLevelLabel } from "@/lib/reasoning-labels";

export type MessageExecutionMetadata = NonNullable<
  Extract<TimelineConversationRow, { role: "assistant" }>["executionMetadata"]
>;

export interface MessageExecutionLabel {
  model: string;
  reasoning: string;
}

export function useMessageExecutionLabel(
  execution: MessageExecutionMetadata,
): MessageExecutionLabel {
  const queryClient = useQueryClient();
  const provider = useSystemProviderInfo({ providerId: execution.providerId });
  const catalogModel = findCachedProviderModel(queryClient, {
    providerId: execution.providerId,
    model: execution.model,
  });
  return {
    model: stripModelBrandPrefix(
      formatModelLabel(catalogModel?.displayName || execution.model),
      provider?.strings?.brandPrefix,
    ),
    reasoning: reasoningLevelLabel(
      execution.reasoningLevel,
      provider ?? undefined,
    ),
  };
}
