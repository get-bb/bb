import { useEffect, useState } from "react";
import { getProfileStore } from "@/lib/native";
import { resetLocalState, resetOnLaunch } from "./e2e";

export interface AppBootState {
  ready: boolean;
}

export function useAppBoot(): AppBootState {
  const [state, setState] = useState<AppBootState>({ ready: false });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await getProfileStore().load();
      if (resetOnLaunch) await resetLocalState();
    })()
      .then(() => {
        if (!cancelled) setState({ ready: true });
      })
      .catch(() => {
        if (!cancelled) setState({ ready: true });
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}
