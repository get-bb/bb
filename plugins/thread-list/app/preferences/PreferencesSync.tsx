import { useEffect } from "react";
import { useAtomValue, useStore } from "jotai";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { threadListRpcContract } from "../../server.js";
import { PREFERENCES_CHANGED_CHANNEL } from "../../shared/preferences.js";
import {
  applyRemotePreferenceSignal,
  attachPreferencesStore,
  hydratePreferences,
  hydratePreferencesFromMirror,
  preferencesReadyAtom,
} from "./preferences-sync.js";

export function usePreferencesReady(): boolean {
  return useAtomValue(preferencesReadyAtom());
}

export function PreferencesSync() {
  const rpc = useRpc<typeof threadListRpcContract>();
  const store = useStore();
  useEffect(() => {
    attachPreferencesStore(store);
    hydratePreferencesFromMirror();
    void hydratePreferences(rpc).catch((error: unknown) => {
      console.warn(
        `thread-list: loading preferences failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }, [rpc, store]);
  useRealtime(PREFERENCES_CHANGED_CHANNEL, applyRemotePreferenceSignal);
  return null;
}
