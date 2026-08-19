import type { AvailableModel } from "@bb/domain";
import {
  createAsyncDeduper,
  type AsyncDeduper,
} from "./services/lib/async-deduper.js";
import {
  createAsyncTtlMemo,
  type AsyncTtlMemo,
} from "./services/lib/async-ttl-memo.js";

/**
 * How long a successful `provider.list_models` answer is reused. Provider
 * catalogs change on the order of releases, and the memo key already carries
 * the daemon session and provider registration revision, so a daemon restart
 * or a plugin reload re-probes immediately regardless of this window.
 */
export const PROVIDER_MODEL_LIST_MEMO_TTL_MS = 10 * 60_000;

export interface ProviderModelListMemoValue {
  models: AvailableModel[];
  selectedOnlyModels: AvailableModel[];
}

export interface LifecycleDedupers {
  environmentCleanupAdvance: AsyncDeduper<string, void>;
  /**
   * Memo for host model probes: every execution-options read (each thread
   * open, focus, and reconnect) used to spawn a provider CLI on the host.
   */
  providerModelList: AsyncTtlMemo<string, ProviderModelListMemoValue>;
  queuedMessageAutoSend: AsyncDeduper<string, void>;
  threadProvisionAdvance: AsyncDeduper<string, void>;
}

export function createLifecycleDedupers(): LifecycleDedupers {
  return {
    environmentCleanupAdvance: createAsyncDeduper<string, void>(),
    providerModelList: createAsyncTtlMemo<string, ProviderModelListMemoValue>({
      ttlMs: PROVIDER_MODEL_LIST_MEMO_TTL_MS,
    }),
    queuedMessageAutoSend: createAsyncDeduper<string, void>(),
    threadProvisionAdvance: createAsyncDeduper<string, void>(),
  };
}
