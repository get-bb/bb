// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import { afterEach, expect, it } from "vitest";
import { SYSTEM_EXECUTION_OPTIONS_QUERY_KEY } from "@/hooks/queries/query-keys";
import { useCachedProviderInfo } from "./system-queries";

afterEach(() => {
  cleanup();
});

/**
 * The views that gate fork/edit affordances on a provider capability do not
 * mount the execution-options query themselves — a composer child does. A
 * render-time cache read therefore stays stale (affordance missing) until some
 * unrelated query happens to re-render them, which is the bug this hook exists
 * to prevent.
 */
it("re-renders when the execution-options cache lands after mount", () => {
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  const { result } = renderHook(
    () => ({
      info: useCachedProviderInfo("codex"),
      client: useQueryClient(),
    }),
    { wrapper },
  );

  expect(result.current.info).toBeNull();

  act(() => {
    queryClient.setQueryData(
      [SYSTEM_EXECUTION_OPTIONS_QUERY_KEY, { environmentId: "env-1" }],
      {
        providers: [
          { id: "codex", capabilities: { supportsSessionRewind: true } },
        ],
        models: [],
        selectedOnlyModels: [],
        permissionCeiling: "full",
        modelLoadError: null,
      },
    );
  });

  expect(result.current.info?.capabilities.supportsSessionRewind).toBe(true);
});
