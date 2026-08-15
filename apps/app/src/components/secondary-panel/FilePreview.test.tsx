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
import {
  FilePreview,
  buildCsvPreviewData,
  getCsvTruncationNote,
} from "./FilePreview";
import { SecondaryPanelFilePreview } from "./ThreadStorageFilePreview";

interface MockPierreFileProps {
  file: {
    cacheKey?: string;
    contents: string;
    name: string;
  };
  selectedLines?: {
    end: number;
    start: number;
  } | null;
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

vi.mock("@pierre/diffs/react", async () => {
  const React = await import("react");

  return {
    File: ({ file, selectedLines = null }: MockPierreFileProps) => {
      const [instanceId] = React.useState(() => {
        pierreMock.state.mountCount += 1;
        return pierreMock.state.mountCount;
      });
      const hostRef = React.useRef<HTMLElement>(null);
      pierreMock.state.lastFile = file;
      pierreMock.state.renderCount += 1;

      React.useLayoutEffect(() => {
        const host = hostRef.current;
        if (host === null) return;
        const shadowRoot = host.shadowRoot ?? host.attachShadow({ mode: "open" });
        const code = document.createElement("code");
        code.dataset.code = "";
        code.scrollLeft = 240;
        code.replaceChildren(
          ...file.contents.split("\n").map((lineContents, index) => {
            const lineNumber = index + 1;
            const line = document.createElement("div");
            line.dataset.line = String(lineNumber);
            line.dataset.lineIndex = String(index);
            line.textContent = lineContents;
            line.getBoundingClientRect = () => ({
              bottom: 718 + index * 18,
              height: 18,
              left: 0,
              right: 800,
              top: 700 + index * 18,
              width: 800,
              x: 0,
              y: 700 + index * 18,
              toJSON: () => ({}),
            });
            // Model the native behavior that caused the regression: asking a
            // long line to scroll into view can also move Pierre's horizontal
            // code scroller.
            line.scrollIntoView = () => {
              code.scrollLeft = 0;
            };
            if (
              selectedLines !== null &&
              lineNumber >= selectedLines.start &&
              lineNumber <= selectedLines.end
            ) {
              line.dataset.selectedLine = "single";
            }
            return line;
          }),
        );
        shadowRoot.replaceChildren(code);
      }, [file.contents, selectedLines]);

      return React.createElement(
        "diffs-container",
        {
          ref: hostRef,
          "data-instance-id": String(instanceId),
          "data-render-count": String(pierreMock.state.renderCount),
          "data-testid": "pierre-file",
        },
      );
    },
    useWorkerPool: () => pierreMock.workerPool,
  };
});

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
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("offers a manual file refresh action", () => {
    const onRefresh = vi.fn();

    render(
      <FilePreview
        path="README.md"
        onRefresh={onRefresh}
        state={{
          kind: "ready",
          file: { name: "README.md", contents: "# Preview" },
          lineRange: null,
          textPreviewKind: "markdown",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Refresh file" }));

    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("disables the manual refresh action while a refresh is running", () => {
    render(
      <FilePreview
        path="README.md"
        onRefresh={() => undefined}
        isRefreshing
        state={{ kind: "loading" }}
      />,
    );

    expect(
      (
        screen.getByRole("button", {
          name: "Refreshing file",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
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
          textPreviewKind: null,
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
          textPreviewKind: null,
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

  it("scrolls vertically to a target line without changing the horizontal offset", async () => {
    const scrollViewport = document.createElement("div");
    scrollViewport.style.overflowY = "auto";
    scrollViewport.scrollTop = 100;
    scrollViewport.getBoundingClientRect = () => ({
      bottom: 450,
      height: 400,
      left: 0,
      right: 500,
      top: 50,
      width: 500,
      x: 0,
      y: 50,
      toJSON: () => ({}),
    });
    document.body.append(scrollViewport);

    render(
      <FilePreview
        headerMode="none"
        path="apps/app/src/lib/thread-read-state.ts"
        state={{
          kind: "ready",
          file: {
            name: "thread-read-state.ts",
            contents: ["first", "second", "third"].join("\n"),
          },
          lineRange: { startLineNumber: 2, endLineNumber: 2 },
          textPreviewKind: null,
        }}
      />,
      { container: scrollViewport },
    );

    const pierreFile = await screen.findByTestId("pierre-file");
    await waitFor(() => {
      expect(scrollViewport.scrollTop).toBe(577);
    });
    expect(
      pierreFile.shadowRoot?.querySelector<HTMLElement>("[data-code]")
        ?.scrollLeft,
    ).toBe(240);
    expect(
      pierreFile.shadowRoot
        ?.querySelector('[data-line="2"]')
        ?.hasAttribute("data-file-preview-target-line"),
    ).toBe(true);
  });

  it("remounts the code view when the highlighted file cache resolves", async () => {
    const cacheKey =
      "file-preview:/api/v1/projects/proj/files/content:thread-read-state.ts";

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
          textPreviewKind: null,
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
          textPreviewKind: null,
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

  it("renders CSV previews as a table by default", () => {
    render(
      <FilePreview
        path="reports/customers.csv"
        state={{
          kind: "ready",
          file: {
            name: "customers.csv",
            contents:
              'Name,Note\n"Ada, Lovelace","said ""hello"""\nGrace,"line two"',
          },
          lineRange: null,
          textPreviewKind: "csv",
        }}
      />,
    );

    expect(
      screen.getByRole("table", { name: "customers.csv CSV preview" }),
    ).not.toBeNull();
    expect(screen.getByRole("columnheader", { name: "Name" })).not.toBeNull();
    expect(screen.getByRole("columnheader", { name: "Note" })).not.toBeNull();
    expect(screen.getByRole("cell", { name: "Ada, Lovelace" })).not.toBeNull();
    expect(screen.getByRole("cell", { name: 'said "hello"' })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Copy CSV" })).not.toBeNull();
    expect(screen.queryByTestId("pierre-file")).toBeNull();
  });

  it("toggles CSV previews back to raw source", async () => {
    render(
      <FilePreview
        path="reports/customers.csv"
        state={{
          kind: "ready",
          file: {
            name: "customers.csv",
            contents: "Name,Score\nAda,10\n",
          },
          lineRange: null,
          textPreviewKind: "csv",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Raw" }));

    await screen.findByTestId("pierre-file");
    expect(
      screen.queryByRole("table", { name: "customers.csv CSV preview" }),
    ).toBeNull();
  });

  it("caps oversized CSV previews and reports the visible data-row count", () => {
    const columnCount = 105;
    const dataRowCount = 501;
    const header = Array.from({ length: columnCount }, (_, i) => `c${i + 1}`);
    const lines = [header.join(",")];
    for (let rowIndex = 0; rowIndex < dataRowCount; rowIndex += 1) {
      lines.push(header.map((name) => `${name}r${rowIndex + 1}`).join(","));
    }

    const preview = buildCsvPreviewData(lines.join("\n"));

    // rows includes the header, so the cap keeps 500 data rows.
    expect(preview.rows.length).toBe(501);
    expect(preview.rows.at(-1)?.[0]).toBe("c1r500");
    expect(preview.columnCount).toBe(100);
    expect(preview.truncatedRows).toBe(true);
    expect(preview.truncatedColumns).toBe(true);
    // The footnote counts data rows, not parsed rows.
    expect(getCsvTruncationNote(preview, preview.rows.length - 1)).toBe(
      "Showing the first 500 rows and 100 columns.",
    );
  });

  it("does not report truncation for a CSV exactly at the row cap", () => {
    const lines = ["name"];
    for (let rowIndex = 0; rowIndex < 500; rowIndex += 1) {
      lines.push(`r${rowIndex + 1}`);
    }

    const preview = buildCsvPreviewData(`${lines.join("\n")}\n`);

    expect(preview.rows.length).toBe(501);
    expect(preview.truncatedRows).toBe(false);
    expect(getCsvTruncationNote(preview, preview.rows.length - 1)).toBeNull();
  });

  it("uses the CSV table preview for loaded CSV text files", () => {
    render(
      <SecondaryPanelFilePreview
        activePath="exports/scores.csv"
        filePreview={{
          kind: "text",
          content: "Name,Score\nAda,10\n",
          mimeType: "application/octet-stream",
          name: "scores.csv",
          path: "exports/scores.csv",
          url: "/api/v1/preview/scores",
        }}
        isLoading={false}
      />,
    );

    expect(
      screen.getByRole("table", { name: "scores.csv CSV preview" }),
    ).not.toBeNull();
    expect(screen.getByRole("cell", { name: "Ada" })).not.toBeNull();
    expect(screen.getByRole("cell", { name: "10" })).not.toBeNull();
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

    await waitFor(() =>
      expect(pierreMock.state.lastFile?.cacheKey).toBeTruthy(),
    );
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
