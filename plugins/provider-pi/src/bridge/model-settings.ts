import type { PiCatalogModel } from "../model-list.js";
import { resolvePiEnabledModelIds, toCanonicalId } from "./model-scope.js";
import {
  readPiEnabledModelPatterns,
  resolvePiGlobalSettingsPath,
  updatePiSettingsFile,
} from "./settings-storage.js";

/**
 * The plugin's `model-settings/*` bridge calls: Pi's host-local enabled-model
 * preference (the global `settings.json`'s `enabledModels`), listed against
 * the authenticated catalog of this host and written back as exact
 * `<provider>/<id>` entries.
 */

export interface PiModelSettingsModel {
  id: string;
  displayName: string;
  provider: string;
  reasoning: boolean;
}

export interface PiModelSettingsSnapshot {
  models: PiModelSettingsModel[];
  enabledModelIds: string[] | null;
}

export function readPiModelSettings(catalog: readonly PiCatalogModel[]): PiModelSettingsSnapshot {
  const patterns = readPiEnabledModelPatterns();
  return {
    models: catalog.map((model) => ({
      id: toCanonicalId(model),
      displayName: model.name,
      provider: model.provider,
      reasoning: model.reasoning,
    })),
    enabledModelIds: resolvePiEnabledModelIds(patterns, catalog),
  };
}

export function writePiEnabledModels(
  catalog: readonly PiCatalogModel[],
  enabledModelIds: readonly string[] | null,
): PiModelSettingsSnapshot {
  const availableIds = new Set(catalog.map(toCanonicalId));
  const normalized = enabledModelIds === null ? null : [...new Set(enabledModelIds)];
  if (normalized !== null) {
    if (normalized.length === 0) {
      throw new Error("At least one Pi model must remain enabled");
    }
    const unavailable = normalized.find((id) => !availableIds.has(id));
    if (unavailable !== undefined) {
      throw new Error(`Pi model "${unavailable}" is not available on this host`);
    }
  }
  updatePiSettingsFile(resolvePiGlobalSettingsPath(), (current) => {
    const { enabledModels: _previous, ...rest } = current;
    return normalized === null ? rest : { ...rest, enabledModels: normalized };
  });
  return readPiModelSettings(catalog);
}
