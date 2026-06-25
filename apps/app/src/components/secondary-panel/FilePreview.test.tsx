// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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
  interface WorkerStats {
    activeTasks: number;
    busyWorkers: number;
    diffCacheSize: number;
    fileCacheSize: number;
    managerState: "waiting" | "initializing" | "initialized";
    queuedTasks: number;
    themeSubscribers: number;
    totalWorkers: number;
    workersFailed: boolean;
  }

  type StatsCallback = (stats: WorkerStats) => void;

  function createStats(overrides: Partial<WorkerStats> = {}): WorkerStats {
    return {
      activeTasks: 0,
      busyWorkers: 0,
      diffCacheSize: 0,
      fileCacheSize: 0,
      managerState: "initialized",
      queuedTasks: 0,
      themeSubscribers: 0,
      totalWorkers: 1,
      workersFailed: false,
      ...overrides,
    };
  }

  const state = {
    cachedFileKeys: new Set<string>(),
    initialStats: createStats(),
    lastFile: null as MockPierreFileProps["file"] | null,
    mountCount: 0,
    renderCount: 0,
    statsCallback: null as StatsCallback | null,
    unsubscribe: vi.fn(),
  };

  return {
    state,
    workerPool: {
      subscribeToStatChanges: vi.fn((callback: StatsCallback) => {
        state.statsCallback = callback;
        callback(state.initialStats);
        return state.unsubscribe;
      }),
      getFileResultCache: vi.fn((file: MockPierreFileProps["file"]) =>
        file.cacheKey && state.cachedFileKeys.has(file.cacheKey)
          ? { options: {}, result: {} }
          : undefined,
      ),
    },
    createStats,
  };
});

const clipboardMock = vi.hoisted(() => ({
  copyToClipboardWithToast: vi.fn(async () => true),
}));

vi.mock("@pierre/diffs/react", async () => {
  const React = await import("react");

  return {
    File: ({ file }: MockPierreFileProps) => {
      const [instanceId] = React.useState(() => {
        pierreMock.state.mountCount += 1;
        return pierreMock.state.mountCount;
      });
      pierreMock.state.lastFile = file;
      pierreMock.state.renderCount += 1;
      return React.createElement(
        "pre",
        {
          "data-instance-id": String(instanceId),
          "data-render-count": String(pierreMock.state.renderCount),
          "data-testid": "pierre-file",
        },
        file.contents,
      );
    },
    useWorkerPool: () => pierreMock.workerPool,
  };
});

vi.mock("@/lib/clipboard", () => clipboardMock);

describe("FilePreview", () => {
  beforeEach(() => {
    pierreMock.state.cachedFileKeys.clear();
    pierreMock.state.initialStats = pierreMock.createStats();
    pierreMock.state.lastFile = null;
    pierreMock.state.mountCount = 0;
    pierreMock.state.renderCount = 0;
    pierreMock.state.statsCallback = null;
    pierreMock.state.unsubscribe.mockClear();
    pierreMock.workerPool.subscribeToStatChanges.mockClear();
    pierreMock.workerPool.getFileResultCache.mockClear();
    clipboardMock.copyToClipboardWithToast.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
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

  it("waits for the Pierre worker pool before mounting the code view", async () => {
    pierreMock.state.initialStats = pierreMock.createStats({
      activeTasks: 8,
      managerState: "initializing",
    });

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

    expect(screen.queryByTestId("pierre-file")).toBeNull();

    act(() => {
      pierreMock.state.statsCallback?.(
        pierreMock.createStats({ managerState: "initialized" }),
      );
    });

    await screen.findByTestId("pierre-file");
  });

  it("remounts the code view when the highlighted file cache resolves", async () => {
    const cacheKey = "file-preview:/api/v1/projects/proj/files/content:thread-read-state.ts";

    render(
      <FilePreview
        headerMode="none"
        path="apps/app/src/lib/thread-read-state.ts"
        state={{
          kind: "ready",
          file: {
            cacheKey,
            name: "thread-read-state.ts",
            contents: "export const marker = true;",
          },
          lineRange: null,
          showMarkdownModeToggle: false,
        }}
      />,
    );

    const firstInstanceId = Number(
      (await screen.findByTestId("pierre-file")).dataset.instanceId,
    );

    act(() => {
      pierreMock.state.cachedFileKeys.add(cacheKey);
      pierreMock.state.statsCallback?.(
        pierreMock.createStats({ fileCacheSize: 1 }),
      );
    });

    await waitFor(() => {
      expect(Number(screen.getByTestId("pierre-file").dataset.instanceId)).toBe(
        firstInstanceId + 1,
      );
    });
  });

  it("renders compact direct file preview header controls", () => {
    render(
      <FilePreview
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

    expect(
      screen.queryByRole("button", { name: "File preview actions" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Copy file contents" })).not.toBe(
      null,
    );

    const wrapButton = screen.getByRole("button", {
      name: "Wrap lines",
    });

    expect(wrapButton.className).toContain("h-5");
    expect(wrapButton.className).toContain("w-5");
    expect(wrapButton.className).toContain("[&_svg]:size-3");
    expect(wrapButton.getAttribute("aria-pressed")).toBe("false");
  });

  it("lets source previews grow to content height so the sticky header stays bounded by the full file", () => {
    const view = render(
      <FilePreview
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

    const previewRoot = view.container.firstElementChild;
    expect(previewRoot?.classList.contains("min-h-full")).toBe(true);
    expect(previewRoot?.classList.contains("h-full")).toBe(false);
    expect(
      screen
        .getByTestId("pierre-file")
        .parentElement?.classList.contains("flex-auto"),
    ).toBe(true);
  });

  it("toggles source line wrap from the header button", async () => {
    render(
      <FilePreview
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

    fireEvent.click(screen.getByRole("button", { name: "Wrap lines" }));
    await waitFor(() => {
      expect(
        screen
          .getByRole("button", { name: "Disable line wrap" })
          .getAttribute("aria-pressed"),
      ).toBe("true");
    });

    fireEvent.click(screen.getByRole("button", { name: "Disable line wrap" }));
    expect(
      screen
        .getByRole("button", { name: "Wrap lines" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("copies loaded markdown contents from the header copy button", async () => {
    render(
      <FilePreview
        path="docs/right-panel/README.md"
        state={{
          kind: "ready",
          file: {
            name: "README.md",
            contents: "# Preview\n\nRaw markdown.",
          },
          lineRange: null,
          showMarkdownModeToggle: true,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy markdown" }));

    await waitFor(() => {
      expect(clipboardMock.copyToClipboardWithToast).toHaveBeenCalledWith(
        "# Preview\n\nRaw markdown.",
        {
          errorMessage: "Failed to copy",
          successMessage: null,
        },
      );
    });
  });

  it("copies the file path with a toast when clicking the header path", async () => {
    render(
      <FilePreview
        path="docs/right-panel/README.md"
        copyPath="/Users/tester/project/docs/right-panel/README.md"
        state={{
          kind: "ready",
          file: {
            name: "README.md",
            contents: "# Preview\n\nRaw markdown.",
          },
          lineRange: null,
          showMarkdownModeToggle: true,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy file path" }));

    await waitFor(() => {
      expect(clipboardMock.copyToClipboardWithToast).toHaveBeenCalledWith(
        "/Users/tester/project/docs/right-panel/README.md",
        {
          errorMessage: "Failed to copy file path",
          successMessage: "File path copied",
        },
      );
    });
  });

  it("shows a tooltip for the file path", async () => {
    render(
      <FilePreview
        path="docs/right-panel/README.md"
        copyPath="/Users/tester/project/docs/right-panel/README.md"
        state={{
          kind: "ready",
          file: {
            name: "README.md",
            contents: "# Preview\n\nRaw markdown.",
          },
          lineRange: null,
          showMarkdownModeToggle: true,
        }}
      />,
    );

    fireEvent.pointerMove(
      screen.getByRole("button", { name: "Copy file path" }),
      { pointerType: "mouse" },
    );

    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "Copy file path",
    );
  });

  it("shows a tooltip for the external editor button", async () => {
    render(
      <FilePreview
        path="docs/right-panel/README.md"
        onOpenInEditor={vi.fn()}
        state={{
          kind: "ready",
          file: {
            name: "README.md",
            contents: "# Preview\n\nRaw markdown.",
          },
          lineRange: null,
          showMarkdownModeToggle: true,
        }}
      />,
    );

    fireEvent.pointerMove(
      screen.getByRole("button", { name: "Open in editor" }),
      { pointerType: "mouse" },
    );

    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "Open in editor",
    );
  });

  it("does not show the file preview actions menu for non-text previews", () => {
    render(
      <FilePreview
        path="docs/screenshots/right-panel.png"
        state={{ kind: "image", url: "/preview/right-panel.png" }}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "File preview actions" }),
    ).toBeNull();
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
