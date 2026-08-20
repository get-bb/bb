import { useEffect, useState } from "react";
import { getProfileStore } from "@/lib/native";
import { resetLocalState, resetOnLaunch } from "./e2e";

export interface AppBootState {
  ready: boolean;
  /** Set when boot failed; the app still renders so the user can recover. */
  error: string | null;
}

/**
 * Work that must finish before the first frame: read the saved server
 * profiles (SecureStore) and, for e2e bundles, wipe local state so every
 * Maestro run starts from first-run. The root layout keeps the splash up
 * until this and the fonts are ready.
 */
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
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            ready: true,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}
