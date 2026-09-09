import type { AvailableModel } from "@bb/domain";
import {
  createAsyncDeduper,
  createAsyncRerunner,
  type AsyncDeduper,
  type AsyncRerunner,
} from "./services/lib/async-deduper.js";
import {
  createAsyncTtlMemo,
  type AsyncTtlMemo,
} from "./services/lib/async-ttl-memo.js";

const PROVIDER_MODEL_LIST_MEMO_TTL_MS = 10 * 60_000;

export interface ProviderModelListMemoValue {
  models: AvailableModel[];
  selectedOnlyModels: AvailableModel[];
}

export interface LifecycleDedupers {
  deferredThreadMessageFlush: AsyncDeduper<string, void>;
  environmentCleanupAdvance: AsyncDeduper<string, void>;
  providerModelList: AsyncTtlMemo<string, ProviderModelListMemoValue>;
  queuedMessageDispatch: AsyncDeduper<string, void>;
  threadProvisionAdvance: AsyncRerunner<string>;
}

export function createLifecycleDedupers(): LifecycleDedupers {
  return {
    deferredThreadMessageFlush: createAsyncDeduper<string, void>(),
    environmentCleanupAdvance: createAsyncDeduper<string, void>(),
    providerModelList: createAsyncTtlMemo<string, ProviderModelListMemoValue>({
      ttlMs: PROVIDER_MODEL_LIST_MEMO_TTL_MS,
    }),
    queuedMessageDispatch: createAsyncDeduper<string, void>(),
    threadProvisionAdvance: createAsyncRerunner<string>(),
  };
}
