import { createDebouncedCallbackScheduler } from "@bb/domain";
import type { QueryClient } from "@tanstack/react-query";
import type { MobileRealtime } from "../realtime/mobile-realtime";
import { systemConfigQueryKey } from "./query-keys";

const INVALIDATION_DEBOUNCE_MS = 50;
const INVALIDATION_MAX_WAIT_MS = 200;

function invalidateQueriesStaleSince(
  queryClient: QueryClient,
  disconnectedAt: number,
): void {
  void queryClient.invalidateQueries(
    { predicate: (query) => query.state.dataUpdatedAt < disconnectedAt },
    { cancelRefetch: false },
  );
}

export interface RealtimeInvalidationHandle {
  dispose(): void;
}

export function installRealtimeInvalidation(
  queryClient: QueryClient,
  realtime: MobileRealtime,
): RealtimeInvalidationHandle {
  const scheduler = createDebouncedCallbackScheduler({
    debounceMs: INVALIDATION_DEBOUNCE_MS,
    maxWaitMs: INVALIDATION_MAX_WAIT_MS,
    onFlush: () => {
      void queryClient.invalidateQueries({ queryKey: systemConfigQueryKey() });
    },
  });

  const unsubscribeChanged = realtime.onChanged((message) => {
    if (message.entity === "host" || message.entity === "system") {
      scheduler.schedule();
    }
  });
  const unsubscribeConnected = realtime.onConnected((event) => {
    if (!event.reconnected) return;
    invalidateQueriesStaleSince(queryClient, event.disconnectedAt);
  });

  return {
    dispose: () => {
      unsubscribeChanged();
      unsubscribeConnected();
      scheduler.dispose();
    },
  };
}
