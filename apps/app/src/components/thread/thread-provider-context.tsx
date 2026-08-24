import { createContext, useContext } from "react";

/**
 * The agent provider of the thread a timeline renders, and the plugin that
 * registered it. Set by the thread detail view once the provider roster
 * resolves; read by the timeline to scope plugin timeline renderers (a
 * plugin renders only the generic tool rows of its own providers) and to
 * hand renderers the `thread` they render for.
 *
 * Null fields mean "unknown here": an embedded chat without a thread, a
 * provider the roster no longer lists. No plugin may claim such rows.
 */
export interface ThreadProviderContextValue {
  providerId: string | null;
  pluginId: string | null;
}

const UNKNOWN_THREAD_PROVIDER: ThreadProviderContextValue = {
  providerId: null,
  pluginId: null,
};

export const ThreadProviderContext = createContext<ThreadProviderContextValue>(
  UNKNOWN_THREAD_PROVIDER,
);

export function useThreadProvider(): ThreadProviderContextValue {
  return useContext(ThreadProviderContext);
}
