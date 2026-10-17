import { useEffect } from "react";
import { useAtomValue, useStore } from "jotai";
import {
  experimental_usePluginId,
  experimental_useRpcQuery,
  experimental_useRpcMutation,
} from "@get-bb/plugin-sdk/app";
import type { threadListRpcContract } from "../../server.js";
import {
  attachPreferencesRpc,
  attachPreferencesStore,
  hydratePreferences,
  hydratePreferencesFromMirror,
  preferencesReadyAtom,
} from "./preferences-sync.js";

export function usePreferencesReady(): boolean {
  return useAtomValue(preferencesReadyAtom());
}

let syncOwnerCount = 0;

export function usePreferencesSync() {
  const query = experimental_useRpcQuery<
    typeof threadListRpcContract,
    "listPreferences"
  >({ method: "listPreferences", input: null });
  const { mutate } = experimental_useRpcMutation<
    typeof threadListRpcContract,
    "setPreference"
  >({ method: "setPreference" });
  const store = useStore();
  const pluginId = experimental_usePluginId();
  useEffect(() => {
    attachPreferencesStore(store, pluginId);
    attachPreferencesRpc({ call: (_method, input) => mutate(input) });
    syncOwnerCount += 1;
    if (syncOwnerCount === 1) {
      hydratePreferencesFromMirror();
    }
    return () => {
      syncOwnerCount -= 1;
    };
  }, [pluginId, mutate, store]);
  useEffect(() => {
    if (query.data !== undefined) hydratePreferences(query.data.preferences);
  }, [query.data]);
  return query;
}

export function PreferencesSync() {
  const query = usePreferencesSync();
  if (query.error === null) return null;
  return (
    <p role="alert" className="px-3 text-xs text-destructive">
      {query.error.message}
      <button
        type="button"
        className="ml-2 underline"
        onClick={() => void query.refetch()}
      >
        Retry
      </button>
    </p>
  );
}
