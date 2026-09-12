import {
  createAsyncDeduper,
  createAsyncRerunner,
  type AsyncDeduper,
  type AsyncRerunner,
} from "./services/lib/async-deduper.js";
import {
  createProviderModelCatalogStore,
  PROVIDER_MODEL_CATALOG_MEMORY_ENTRY_LIMIT,
  PROVIDER_MODEL_CATALOG_PUSH_COALESCE_MS,
  type ProviderModelCatalogStore,
} from "./services/providers/provider-model-catalog-store.js";

export interface LifecycleDedupers {
  providerModelCatalogs: ProviderModelCatalogStore;
  queuedMessageDispatch: AsyncDeduper<string, void>;
  threadProvisionAdvance: AsyncRerunner<string>;
}

export function createLifecycleDedupers(): LifecycleDedupers {
  return {
    providerModelCatalogs: createProviderModelCatalogStore({
      now: Date.now,
      pushCoalesceMs: PROVIDER_MODEL_CATALOG_PUSH_COALESCE_MS,
      memoryEntryLimit: PROVIDER_MODEL_CATALOG_MEMORY_ENTRY_LIMIT,
    }),
    queuedMessageDispatch: createAsyncDeduper<string, void>(),
    threadProvisionAdvance: createAsyncRerunner<string>(),
  };
}
