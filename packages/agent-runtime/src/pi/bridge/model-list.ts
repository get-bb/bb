import type { AvailableModel } from "@bb/domain";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { buildPiAvailableModels } from "../model-list.js";

// The network refresh fans out one request per provider to pi.dev and can
// stall for the whole budget: on some hosts a single request never returns,
// hitting the 5s ceiling on roughly one in three cold calls. This runs on
// every picker render and thread-detail bootstrap, so attempt it at most once
// per bridge process. The bridge is long-lived (spawned once under the "pi"
// process key and never idle-reaped), and later calls resolve from the
// persisted model store plus the bundled static catalog, which yields the
// same model set.
let networkRefreshAttempted = false;

export async function listPiBridgeModels(modelRuntime: ModelRuntime): Promise<{
  models: AvailableModel[];
  selectedOnlyModels: AvailableModel[];
}> {
  if (!networkRefreshAttempted) {
    networkRefreshAttempted = true;
    await modelRuntime.refresh({
      allowNetwork: true,
      signal: AbortSignal.timeout(5_000),
    });
  }
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
