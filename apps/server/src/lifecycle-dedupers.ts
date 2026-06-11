import {
  createAsyncDeduper,
  type AsyncDeduper,
} from "./services/lib/async-deduper.js";

export interface LifecycleDedupers {
  environmentCleanupAdvance: AsyncDeduper<string, void>;
  queuedMessageAutoSend: AsyncDeduper<string, void>;
  threadProvisionAdvance: AsyncDeduper<string, void>;
  /** Keyed `${runId}:${operationKind}`; resolves to the queued command id. */
  workflowRunOperationAdvance: AsyncDeduper<string, string | null>;
}

export function createLifecycleDedupers(): LifecycleDedupers {
  return {
    environmentCleanupAdvance: createAsyncDeduper<string, void>(),
    queuedMessageAutoSend: createAsyncDeduper<string, void>(),
    threadProvisionAdvance: createAsyncDeduper<string, void>(),
    workflowRunOperationAdvance: createAsyncDeduper<string, string | null>(),
  };
}
