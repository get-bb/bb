import { useEffect } from "react";
import { useAtomValue, useStore } from "jotai";
import {
  experimental_usePluginId,
  useRealtime,
  useRpc,
  experimental_useRpcQuery,
} from "@get-bb/plugin-sdk/app";
import type { threadListRpcContract } from "../../server.js";
import { PREFERENCES_CHANGED_CHANNEL } from "../../shared/preferences.js";
import {
  applyRemotePreferenceSignal,
  attachPreferencesStore,
  applyPreferenceSnapshot,
  hydratePreferencesFromMirror,
  preferencesReadyAtom,
} from "./preferences-sync.js";

export function usePreferencesReady(): boolean {
  return useAtomValue(preferencesReadyAtom());
}

let syncOwnerCount = 0;
let appliedSnapshot: unknown = null;

export function usePreferencesSync(): void {
  const rpc = useRpc<typeof threadListRpcContract>();
  const store = useStore();
  const pluginId = experimental_usePluginId();
  const query = experimental_useRpcQuery<
    typeof threadListRpcContract,
    "listPreferences"
  >({
    method: "listPreferences",
    input: null,
    realtime: [{ channel: PREFERENCES_CHANGED_CHANNEL }],
  });
  useEffect(() => {
    attachPreferencesStore(store, pluginId);
    syncOwnerCount += 1;
    if (syncOwnerCount === 1) hydratePreferencesFromMirror();
    return () => {
      syncOwnerCount -= 1;
    };
  }, [pluginId, rpc, store]);
  useEffect(() => {
    if (!query.data || query.data === appliedSnapshot) return;
    appliedSnapshot = query.data;
    applyPreferenceSnapshot(query.data, rpc);
  }, [query.data, rpc]);
  useRealtime(PREFERENCES_CHANGED_CHANNEL, applyRemotePreferenceSignal);
}

export function PreferencesSync() {
  usePreferencesSync();
  return null;
}
