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
import { TurnRequestDelivery } from "./services/threads/turn-request-delivery.js";
import { InFlightThreadRpcGuard } from "./services/threads/thread-rpc-guard.js";

export interface LifecycleDedupers {
  providerModelCatalogs: ProviderModelCatalogStore;
  threadRpcs: InFlightThreadRpcGuard;
  turnRequestDelivery: TurnRequestDelivery;
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
    threadRpcs: new InFlightThreadRpcGuard(),
    turnRequestDelivery: new TurnRequestDelivery(),
  };
}
