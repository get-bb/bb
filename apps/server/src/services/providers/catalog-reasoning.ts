import { getStoredProviderModelCatalog, type DbConnection } from "@bb/db";
import {
  availableModelSchema,
  providerModelCatalogDependsOnWorkspace,
  type ProviderInfo,
  type ReasoningLevel,
} from "@bb/domain";
import { z } from "zod";

const modelsSchema = z.array(availableModelSchema);

export function resolveCatalogReasoningLevel(
  db: DbConnection,
  args: {
    hostId: string;
    providerId: string;
    model: string;
    reasoningLevel: ReasoningLevel;
    workspacePath: string;
    catalogScope: ProviderInfo["capabilities"]["modelCatalogScope"] | undefined;
  },
): ReasoningLevel | undefined {
  const catalog = getStoredProviderModelCatalog(db, {
    hostId: args.hostId,
    providerId: args.providerId,
    scopeKey: providerModelCatalogDependsOnWorkspace(args.catalogScope)
      ? args.workspacePath
      : "",
  });
  if (catalog === null) return args.reasoningLevel;
  for (const json of [catalog.modelsJson, catalog.selectedOnlyModelsJson]) {
    let raw: unknown;
    try {
      raw = JSON.parse(json);
    } catch {
      continue;
    }
    const parsed = modelsSchema.safeParse(raw);
    if (!parsed.success) continue;
    const model = parsed.data.find((model) => model.model === args.model);
    if (model !== undefined) {
      return model.supportedReasoningEfforts.length === 0
        ? undefined
        : args.reasoningLevel;
    }
  }
  return args.reasoningLevel;
}
