import { useEffect } from "react";
import { useAtomValue } from "jotai";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { threadListRpcContract } from "../../server.js";
import { PREFERENCES_CHANGED_CHANNEL } from "../../shared/preferences.js";
import {
  applyRemotePreferenceSignal,
  hydratePreferences,
  hydratePreferencesFromMirror,
  preferencesReadyAtom,
} from "./preferences-sync.js";

export function usePreferencesReady(): boolean {
  return useAtomValue(preferencesReadyAtom());
}

export function PreferencesSync() {
  const rpc = useRpc<typeof threadListRpcContract>();
  useEffect(() => {
    hydratePreferencesFromMirror();
    void hydratePreferences(rpc).catch((error: unknown) => {
      console.warn(
        `thread-list: loading preferences failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }, [rpc]);
  useRealtime(PREFERENCES_CHANGED_CHANNEL, applyRemotePreferenceSignal);
  return null;
}
