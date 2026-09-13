import type { RealtimeSubscriptionTarget } from "@bb/server-contract";
import { useEffect } from "react";
import { useProfileClient } from "@/app-shell/ProfilesProvider";

const SYSTEM_TARGET = { kind: "system" } satisfies RealtimeSubscriptionTarget;

export function useSystemRealtimeSubscription(): void {
  const { realtime } = useProfileClient();

  useEffect(() => {
    realtime.subscribe(SYSTEM_TARGET);
    return () => {
      realtime.unsubscribe(SYSTEM_TARGET);
    };
  }, [realtime]);
}
