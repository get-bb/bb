import { createContext, useContext, type ReactNode } from "react";
import type { PluginComposerScope } from "@bb/plugin-sdk";
import type { PromptDraftState } from "@/lib/prompt-draft";

/**
 * Binds plugin composer hooks to a transient composer that is not backed by
 * the route-level draft store, such as an inline queued-message editor.
 */
export interface PluginComposerHost {
  scope: PluginComposerScope;
  draft: PromptDraftState;
  getCurrent(): PromptDraftState;
  setDraft(next: PromptDraftState): void;
  focus(): void;
}

const PluginComposerHostContext = createContext<PluginComposerHost | null>(
  null,
);

export function PluginComposerHostProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: PluginComposerHost | null;
}) {
  return (
    <PluginComposerHostContext.Provider value={value}>
      {children}
    </PluginComposerHostContext.Provider>
  );
}

export function usePluginComposerHost(): PluginComposerHost | null {
  return useContext(PluginComposerHostContext);
}
