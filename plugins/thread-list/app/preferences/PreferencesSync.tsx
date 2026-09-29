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

export function PreferencesSync() {
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
    hydratePreferencesFromMirror();
  }, [pluginId, rpc, store]);
  useEffect(() => {
    if (query.data) applyPreferenceSnapshot(query.data, rpc);
  }, [query.data, rpc]);
  useRealtime(PREFERENCES_CHANGED_CHANNEL, applyRemotePreferenceSignal);
  return null;
}
