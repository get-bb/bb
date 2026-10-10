// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { afterEach, expect, it } from "vitest";
import { useGitDiffPanel } from "./useGitDiffPanel";

const noop = () => undefined;

function TestRoot({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

afterEach(cleanup);

it("does not revive an unconsumed file intent after navigating away and back", () => {
  const owner = renderHook(
    ({ environmentId, threadId }) =>
      useGitDiffPanel({
        activeSecondaryTab: null,
        clearActiveFileTabs: noop,
        environmentId,
        setThreadSecondaryPanel: noop,
        threadId,
      }),
    {
      initialProps: { environmentId: "env-a", threadId: "thread-a" },
      wrapper: TestRoot,
    },
  );

  act(() => owner.result.current.openDiffFile("left.ts"));
  expect(owner.result.current.pendingGitDiffScrollPath).toBe("left.ts");

  owner.rerender({ environmentId: "env-b", threadId: "thread-b" });
  expect(owner.result.current.pendingGitDiffScrollPath).toBeNull();

  owner.rerender({ environmentId: "env-a", threadId: "thread-a" });
  expect(owner.result.current.pendingGitDiffScrollPath).toBeNull();
});
