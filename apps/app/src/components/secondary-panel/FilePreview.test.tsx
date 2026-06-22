// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FilePreview } from "./FilePreview";
import { SecondaryPanelFilePreview } from "./ThreadStorageFilePreview";

interface MockPierreFileProps {
  file: {
    cacheKey?: string;
    contents: string;
    name: string;
  };
}

const pierreMock = vi.hoisted(() => {
  type StatsCallback = (stats: {
    activeTasks: number;
    busyWorkers: number;
    diffCacheSize: number;
    fileCacheSize: number;
    managerState: "waiting" | "initializing" | "initialized";
    queuedTasks: number;
    themeSubscribers: number;
    totalWorkers: number;
    workersFailed: boolean;
  }) => void;

  const state = {
    lastFile: null as MockPierreFileProps["file"] | null,
    renderCount: 0,
    statsCallback: null as StatsCallback | null,
    unsubscribe: vi.fn(),
  };

  return {
    state,
    workerPool: {
      subscribeToStatChanges: vi.fn((callback: StatsCallback) => {
        state.statsCallback = callback;
        callback({
          activeTasks: 0,
          busyWorkers: 0,
          diffCacheSize: 0,
          fileCacheSize: 0,
          managerState: "initializing",
          queuedTasks: 0,
          themeSubscribers: 0,
          totalWorkers: 1,
          workersFailed: false,
        });
        return state.unsubscribe;
      }),
    },
  };
});

vi.mock("@pierre/diffs/react", async () => {
  const React = await import("react");

  return {
    File: ({ file }: MockPierreFileProps) => {
      pierreMock.state.lastFile = file;
      pierreMock.state.renderCount += 1;
      return React.createElement(
        "pre",
        {
          "data-render-count": String(pierreMock.state.renderCount),
          "data-testid": "pierre-file",
        },
        file.contents,
      );
    },
    useWorkerPool: () => pierreMock.workerPool,
  };
});

describe("FilePreview", () => {
  beforeEach(() => {
    pierreMock.state.lastFile = null;
    pierreMock.state.renderCount = 0;
    pierreMock.state.statsCallback = null;
    pierreMock.state.unsubscribe.mockClear();
    pierreMock.workerPool.subscribeToStatChanges.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("rerenders the code view when the Pierre worker pool advances", async () => {
    render(
      <FilePreview
        headerMode="none"
        path="apps/app/src/lib/thread-read-state.ts"
        state={{
          kind: "ready",
          file: {
            name: "thread-read-state.ts",
            contents: "export const marker = true;",
          },
          lineRange: null,
          showMarkdownModeToggle: false,
        }}
      />,
    );

    await waitFor(() => expect(pierreMock.state.statsCallback).not.toBeNull());
    const renderCountBeforeStatsChange = Number(
      screen.getByTestId("pierre-file").dataset.renderCount,
    );

    act(() => {
      pierreMock.state.statsCallback?.({
        activeTasks: 1,
        busyWorkers: 1,
        diffCacheSize: 0,
        fileCacheSize: 0,
        managerState: "initialized",
        queuedTasks: 0,
        themeSubscribers: 1,
        totalWorkers: 1,
        workersFailed: false,
      });
    });

    await waitFor(() => {
      expect(
        Number(screen.getByTestId("pierre-file").dataset.renderCount),
      ).toBeGreaterThan(renderCountBeforeStatsChange);
    });
  });

  it("passes cache keys for loaded text previews to Pierre", async () => {
    const firstPreview = {
      kind: "text" as const,
      content: "export const first = true;",
      mimeType: "application/typescript",
      path: "apps/app/src/lib/thread-read-state.ts",
      url: "/api/v1/preview/one",
    };
    const view = render(
      <SecondaryPanelFilePreview
        activePath={firstPreview.path}
        filePreview={firstPreview}
        isLoading={false}
      />,
    );

    await waitFor(() => expect(pierreMock.state.lastFile?.cacheKey).toBeTruthy());
    const firstCacheKey = pierreMock.state.lastFile?.cacheKey;

    view.rerender(
      <SecondaryPanelFilePreview
        activePath={firstPreview.path}
        filePreview={{
          ...firstPreview,
          content: "export const second = true;",
        }}
        isLoading={false}
      />,
    );

    await waitFor(() => {
      expect(pierreMock.state.lastFile?.cacheKey).toBeTruthy();
      expect(pierreMock.state.lastFile?.cacheKey).not.toBe(firstCacheKey);
    });
  });
});
