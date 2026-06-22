// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FilePreview } from "./FilePreview";

interface MockPierreFileProps {
  file: {
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
});
