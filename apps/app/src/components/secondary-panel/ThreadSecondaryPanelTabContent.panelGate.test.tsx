// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  environmentFilePreviewQueryKeyPrefix,
  hostFilePreviewQueryKey,
} from "@/hooks/queries/query-keys";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  HostScopedFilePreviewTabContent,
  WorkspaceFilePreviewTabContent,
} from "./ThreadSecondaryPanelTabContent";

vi.mock("@/lib/sdk", () => ({
  sdk: {
    environments: { diffFiles: vi.fn() },
  },
}));

vi.mock("@pierre/diffs/react", async () => {
  const React = await import("react");
  return {
    File: () => null,
    VirtualizerContext: React.createContext(undefined),
    useWorkerPool: () => null,
  };
});

const ENVIRONMENT_ID = "env-1";
const PREVIEW_PATH = "src/index.ts";
const fetchMock = vi.fn(
  async () =>
    new Response("export const answer = 42;\n", {
      headers: { "content-type": "text/plain" },
    }),
);

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("WorkspaceFilePreviewTabContent panel gating", () => {
  it("does not refetch an invalidated preview while the panel is closed", async () => {
    const { queryClient, wrapper: Wrapper } = createQueryClientTestHarness();
    const renderTab = (isPanelOpen: boolean) => (
      <Wrapper>
        <WorkspaceFilePreviewTabContent
          activePath={PREVIEW_PATH}
          environmentId={ENVIRONMENT_ID}
          isPanelOpen={isPanelOpen}
          lineRange={null}
          source={{ kind: "working-tree" }}
          threadId="thr-1"
        />
      </Wrapper>
    );

    const view = render(renderTab(true));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    view.rerender(renderTab(false));
    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: environmentFilePreviewQueryKeyPrefix(ENVIRONMENT_ID),
      });
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    view.rerender(renderTab(true));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});

describe("HostScopedFilePreviewTabContent panel gating", () => {
  it("does not start or refetch a host read while the retained panel is closed", async () => {
    const { queryClient, wrapper: Wrapper } = createQueryClientTestHarness();
    const renderTab = (isPanelOpen: boolean) => (
      <Wrapper>
        <HostScopedFilePreviewTabContent
          activePath="/tmp/example.txt"
          hostId="host-1"
          isPanelOpen={isPanelOpen}
          lineRange={null}
        />
      </Wrapper>
    );

    const view = render(renderTab(false));
    expect(fetchMock).not.toHaveBeenCalled();

    view.rerender(renderTab(true));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    view.rerender(renderTab(false));
    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: hostFilePreviewQueryKey("host-1", "/tmp/example.txt"),
      });
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    view.rerender(renderTab(true));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
