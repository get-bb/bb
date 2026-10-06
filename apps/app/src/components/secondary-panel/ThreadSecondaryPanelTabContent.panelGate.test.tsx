// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { WorkspaceDiffTarget } from "@bb/domain";
import type { EnvironmentDiffFilesResponse } from "@bb/server-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  environmentDiffFilesQueryKeyPrefix,
  environmentFilePreviewQueryKeyPrefix,
  hostFilePreviewQueryKey,
} from "@/hooks/queries/query-keys";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  GitDiffTabContent,
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
const TARGET: WorkspaceDiffTarget = { type: "all", mergeBaseBranch: "main" };

const emptyDiff: EnvironmentDiffFilesResponse = {
  outcome: "available",
  files: [],
  truncated: false,
  shortstat: "",
  mergeBaseRef: null,
  initialPatches: [],
};

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

describe("GitDiffTabContent panel gating", () => {
  it("fetches the diff TOC only while the panel is open, and refetches once on reopen", async () => {
    vi.mocked(sdk.environments.diffFiles).mockResolvedValue(emptyDiff);
    const { queryClient, wrapper: Wrapper } = createQueryClientTestHarness();
    const renderTab = (isPanelOpen: boolean) => (
      <Wrapper>
        <GitDiffTabContent
          environmentId={ENVIRONMENT_ID}
          target={TARGET}
          isPanelOpen={isPanelOpen}
          gitDiffPresentation={{
            view: "unified",
            overflow: "scroll",
            showLineNumbers: true,
          }}
          fileFilter=""
        />
      </Wrapper>
    );

    const view = render(renderTab(false));
    expect(sdk.environments.diffFiles).not.toHaveBeenCalled();

    view.rerender(renderTab(true));
    await waitFor(() => {
      expect(sdk.environments.diffFiles).toHaveBeenCalledTimes(1);
    });

    view.rerender(renderTab(false));
    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: environmentDiffFilesQueryKeyPrefix(ENVIRONMENT_ID),
      });
    });
    expect(sdk.environments.diffFiles).toHaveBeenCalledTimes(1);

    view.rerender(renderTab(true));
    await waitFor(() => {
      expect(sdk.environments.diffFiles).toHaveBeenCalledTimes(2);
    });
  });
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
          statusLabel={null}
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
