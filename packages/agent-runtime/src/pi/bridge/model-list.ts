import type { AvailableModel } from "@bb/domain";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { buildPiAvailableModels } from "../model-list.js";

export async function listPiBridgeModels(modelRuntime: ModelRuntime): Promise<{
  models: AvailableModel[];
  selectedOnlyModels: AvailableModel[];
}> {
  await modelRuntime.refresh({
    allowNetwork: true,
    signal: AbortSignal.timeout(5_000),
  });
  const availableModels = await modelRuntime.getAvailable();

  return buildPiAvailableModels({
    models: availableModels.map((model) => ({
      id: model.id,
      input: [...model.input],
      name: model.name,
      provider: model.provider,
      reasoning: model.reasoning,
      supportedThinkingLevels: getSupportedThinkingLevels(model),
    })),
  });
}
