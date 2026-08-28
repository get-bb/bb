// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import type { Thread } from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation, type Location } from "react-router-dom";
import { Provider as JotaiProvider } from "jotai";
import { QueryClientProvider } from "@tanstack/react-query";
import { FORK_THREAD_CREATE_SEED_LOCATION_STATE_KEY } from "@bb/client-core";
import { getRootComposeRoutePath } from "@/lib/route-paths";
import { RouteNavigationProvider } from "@/components/ui/app-route-anchor";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { sdk } from "@/lib/sdk";
import { useForkThreadFromMessage } from "./useForkThreadFromMessage";

const defaultExecutionOptions = vi.spyOn(
  sdk.threads,
  "defaultExecutionOptions",
);
const { queryClient } = createQueryClientTestHarness();

function makeThread(overrides: Partial<Thread> = {}): Thread {
  const base: Thread = {
    archivedAt: null,
    createdAt: 1,
    deletedAt: null,
    environmentId: "env_source",
    id: "thr_source",
    lastReadAt: null,
    latestAttentionAt: 1,
    originKind: null,
    originPluginId: null,
    visibility: "visible",
    parentThreadId: null,
    pinnedAt: null,
    projectId: "proj_source",
    providerId: "codex",
    sourceThreadId: null,
    status: "idle",
    title: null,
    titleFallback: "Fallback fork title",
    sectionId: null,
    updatedAt: 1,
  };
  return { ...base, ...overrides };
}

afterEach(() => {
  cleanup();
  defaultExecutionOptions.mockReset();
  queryClient.clear();
});

let currentLocation: Location | null = null;

function LocationProbe() {
  const location = useLocation();
  useEffect(() => {
    currentLocation = location;
  }, [location]);
  return null;
}

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter>
      <JotaiProvider>
        <QueryClientProvider client={queryClient}>
          <RouteNavigationProvider>
            <LocationProbe />
            {children}
          </RouteNavigationProvider>
        </QueryClientProvider>
      </JotaiProvider>
    </MemoryRouter>
  );
}

function seedForkCapability(): void {
  queryClient.setQueryData(["systemExecutionOptions"], {
    providers: [
      {
        id: "codex",
        capabilities: { supportsFork: true },
      },
    ],
  });
}

describe("useForkThreadFromMessage", () => {
  it("opens the root composer with the source thread display title in the fork seed", async () => {
    seedForkCapability();
    defaultExecutionOptions.mockResolvedValue({
      model: "gpt-5",
      permissionMode: "accept-edits",
      reasoningLevel: "high",
      serviceTier: "fast",
      source: "client/turn/requested",
    });

    const { result } = renderHook(
      () =>
        useForkThreadFromMessage({
          sourceThread: makeThread(),
        }),
      { wrapper: Wrapper },
    );

    await act(async () => {
      await result.current({ sourceSeqEnd: 12 });
    });

    expect(window.localStorage.getItem("bb.root-compose.project-id")).toBe(
      "proj_source",
    );
    expect(currentLocation?.pathname).toBe(getRootComposeRoutePath());

    expect(currentLocation?.state).toEqual(
      expect.objectContaining({
        [FORK_THREAD_CREATE_SEED_LOCATION_STATE_KEY]: expect.objectContaining({
          environmentId: "env_source",
          model: "gpt-5",
          permissionMode: "accept-edits",
          projectId: "proj_source",
          providerId: "codex",
          reasoningLevel: "high",
          serviceTier: "fast",
          sourceSeqEnd: 12,
          sourceThreadId: "thr_source",
          sourceThreadTitle: "Fallback fork title",
        }),
      }),
    );
  });
  it("keeps one handler identity across thread refetches and reads the latest thread", async () => {
    seedForkCapability();
    defaultExecutionOptions.mockResolvedValue({
      model: "gpt-5",
      permissionMode: "accept-edits",
      reasoningLevel: "high",
      serviceTier: "fast",
      source: "client/turn/requested",
    });
    const { result, rerender } = renderHook(
      ({ sourceThread }: { sourceThread: Thread | null }) =>
        useForkThreadFromMessage({ sourceThread }),
      { initialProps: { sourceThread: makeThread() }, wrapper: Wrapper },
    );
    const first = result.current;

    rerender({ sourceThread: makeThread({ title: "Renamed source" }) });
    expect(result.current).toBe(first);

    await act(async () => {
      await first({ sourceSeqEnd: 3 });
    });
    expect(currentLocation?.state).toEqual(
      expect.objectContaining({
        [FORK_THREAD_CREATE_SEED_LOCATION_STATE_KEY]: expect.objectContaining({
          sourceThreadTitle: "Renamed source",
        }),
      }),
    );
  });
});
