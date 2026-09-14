import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useStore } from "jotai";
import { useUiPreferences } from "@/hooks/queries/system-queries";
import {
  reconcileUiPreferences,
  startUiPreferencesSync,
} from "./ui-preferences-sync";

export function useUiPreferencesReady(): boolean {
  const { data, isError } = useUiPreferences();
  return data !== undefined || isError;
}

export function UiPreferencesSync() {
  const queryClient = useQueryClient();
  const store = useStore();
  const { data } = useUiPreferences();

  useEffect(
    () => startUiPreferencesSync({ queryClient, store }),
    [queryClient, store],
  );

  useEffect(() => {
    if (data !== undefined) reconcileUiPreferences(data);
  }, [data]);

  return null;
}
