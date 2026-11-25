import { createContext, useContext } from "react";
import type { ExperimentalThreadContextKind } from "@get-bb/plugin-sdk";
import type { ThreadContextCardPaneState } from "./PluginThreadContextCard";

export const ThreadContextCardPaneContext =
  createContext<ThreadContextCardPaneState | null>(null);

export function usePaneState(): ThreadContextCardPaneState | null {
  const state = useContext(ThreadContextCardPaneContext);
  return state !== null && state.rows.length + state.sections.length > 0
    ? state
    : null;
}

export function useThreadContextKind(): ExperimentalThreadContextKind {
  const state = usePaneState();
  return state === null || state.layout === "banner" ? "banner" : "card";
}
