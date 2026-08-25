import type { SystemChangeKind } from "@bb/domain";
import type { ProviderModelListMemoValue } from "../../lifecycle-dedupers.js";
import type { AsyncTtlMemo } from "../lib/async-ttl-memo.js";

/**
 * A plugin changed a provider's native model preferences on one host: the
 * catalogs memoized for that host are stale, the other hosts' are not. The
 * memo is keyed by the JSON array `[hostId, ...]` (execution-options.ts).
 */
export function publishProviderModelsChanged(args: {
  providerModelList: AsyncTtlMemo<string, ProviderModelListMemoValue>;
  notifySystem(changes: SystemChangeKind[]): void;
  hostId: string;
}): void {
  args.providerModelList.deleteWhere((key) => {
    try {
      const parsed: unknown = JSON.parse(key);
      return Array.isArray(parsed) && parsed[0] === args.hostId;
    } catch {
      return true;
    }
  });
  args.notifySystem(["provider-models-changed"]);
}
