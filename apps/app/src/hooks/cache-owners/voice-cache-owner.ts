import type { QueryClient } from "@tanstack/react-query";
import { voiceLocalModelsQueryKey } from "../queries/query-keys";

interface InvalidateVoiceLocalModelsArgs {
  pluginId: string;
  queryClient: QueryClient;
}

export function invalidateVoiceLocalModels({
  pluginId,
  queryClient,
}: InvalidateVoiceLocalModelsArgs): void {
  void queryClient.invalidateQueries({
    queryKey: voiceLocalModelsQueryKey(pluginId),
  });
}
