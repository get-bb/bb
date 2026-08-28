import { useEffect, useState } from "react";
import { getProfileStore } from "@/lib/native";
import { resetLocalState, resetOnLaunch } from "./e2e";

export interface AppBootState {
  ready: boolean;
  error: string | null;
}

export function useAppBoot(): AppBootState {
  const [state, setState] = useState<AppBootState>({
    ready: false,
    error: null,
  });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await getProfileStore().load();
      if (resetOnLaunch) await resetLocalState();
    })()
      .then(() => {
        if (!cancelled) setState({ ready: true, error: null });
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setState({
            ready: true,
            error: cause instanceof Error ? cause.message : String(cause),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}
