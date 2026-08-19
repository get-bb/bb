// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { act, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FILE_PREVIEW_CODE_MAX_LINES,
  FilePreview,
  buildCsvPreviewData,
  getCsvTruncationNote,
} from "./FilePreview";
import { SecondaryPanelFilePreview } from "./ThreadStorageFilePreview";
import {
  PierreWorkerPoolGateContext,
  type PierreWorkerPoolGate,
} from "@/lib/pierre-worker-pool-gate";

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
        const shadowRoot =
          host.shadowRoot ?? host.attachShadow({ mode: "open" });
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

      return React.createElement("diffs-container", {
        ref: hostRef,
        "data-instance-id": String(instanceId),
        "data-render-count": String(pierreMock.state.renderCount),
        "data-testid": "pierre-file",
      });
    },
    WorkerPoolContext: React.createContext(undefined),
    useWorkerPool: () => pierreMock.workerPool,
    VirtualizerContext: React.createContext(undefined),
  };
});

/**
 * The code view reads the workspace pool from the worker-pool gate (see
 * ThreadDetailWorkerPoolProvider); tests that exercise pool-driven behavior
 * render inside a ready gate that publishes the mock pool.
 */
function renderWithWorkerPool(ui: ReactElement) {
  const gate: PierreWorkerPoolGate = {
    ready: true,
    pool: pierreMock.workerPool as unknown as NonNullable<
      PierreWorkerPoolGate["pool"]
    >,
    request: () => undefined,
  };
  return render(
    <PierreWorkerPoolGateContext.Provider value={gate}>
      {ui}
    </PierreWorkerPoolGateContext.Provider>,
  );
}

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
    renderWithWorkerPool(
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

    renderWithWorkerPool(
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
    // The code view scrolls its own virtualized viewport (which sits at the
    // origin in jsdom), not the surrounding panel scroller.
    const codeViewport = scrollViewport.querySelector<HTMLElement>(
      "[data-file-preview-code-viewport]",
    );
    expect(codeViewport).not.toBeNull();
    await waitFor(() => {
      expect(codeViewport?.scrollTop).toBe(727);
    });
    expect(scrollViewport.scrollTop).toBe(100);
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

  it("keeps a single code view mount when the highlighted file cache resolves", async () => {
    const cacheKey =
      "file-preview:/api/v1/projects/proj/files/content:thread-read-state.ts";

    renderWithWorkerPool(
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

    const pierreFile = await screen.findByTestId("pierre-file");
    const firstInstanceId = Number(pierreFile.dataset.instanceId);
    const renderCountBeforeHighlight = Number(pierreFile.dataset.renderCount);

    act(() => {
      pierreMock.state.cachedFileKeys.add(cacheKey);
      pierreMock.state.statsCallback?.(
        pierreMock.createStats({ fileCacheSize: 1 }),
      );
    });

    // Pierre repaints the highlighted AST in place; a React remount would
    // throw away its DOM (and the user's scroll position) for nothing.
    await waitFor(() => {
      expect(
        Number(screen.getByTestId("pierre-file").dataset.renderCount),
      ).toBeGreaterThan(renderCountBeforeHighlight);
    });
    expect(Number(screen.getByTestId("pierre-file").dataset.instanceId)).toBe(
      firstInstanceId,
    );
  });

  it("caps oversized code previews to a leading prefix until the full file is requested", async () => {
    const totalLineCount = FILE_PREVIEW_CODE_MAX_LINES + 1_500;
    const contents = Array.from(
      { length: totalLineCount },
      (_, index) => `line ${index + 1}`,
    ).join("\n");

    render(
      <FilePreview
        headerMode="none"
        path="src/generated.ts"
        state={{
          kind: "ready",
          file: {
            cacheKey: "file-preview:generated",
            name: "generated.ts",
            contents,
          },
          lineRange: null,
          textPreviewKind: null,
        }}
      />,
    );

    await screen.findByTestId("pierre-file");
    expect(pierreMock.state.lastFile?.contents.split("\n")).toHaveLength(
      FILE_PREVIEW_CODE_MAX_LINES,
    );
    // The capped prefix must not share the full file's highlight cache slot.
    expect(pierreMock.state.lastFile?.cacheKey).toBe(
      "file-preview:generated:head",
    );
    expect(
      screen.getByText(
        `Showing the first ${FILE_PREVIEW_CODE_MAX_LINES.toLocaleString()} of ${totalLineCount.toLocaleString()} lines.`,
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Load full file" }));

    await waitFor(() => {
      expect(pierreMock.state.lastFile?.contents).toBe(contents);
    });
    expect(pierreMock.state.lastFile?.cacheKey).toBe("file-preview:generated");
    expect(screen.queryByRole("button", { name: "Load full file" })).toBeNull();
  });

  it("caps code previews by size even when they have few lines", () => {
    const longLine = "x".repeat(200_000);
    const contents = [longLine, longLine, longLine, "tail"].join("\n");

    render(
      <FilePreview
        headerMode="none"
        path="assets/blob.txt"
        state={{
          kind: "ready",
          file: { name: "blob.txt", contents },
          lineRange: null,
          textPreviewKind: null,
        }}
      />,
    );

    // 512 KB budget: two 200k-char lines fit, the third would exceed it.
    expect(pierreMock.state.lastFile?.contents).toBe(
      [longLine, longLine].join("\n"),
    );
    expect(screen.getByRole("button", { name: "Load full file" })).toBeTruthy();
  });

  it("shows the whole file when a line link points past the capped prefix", async () => {
    const totalLineCount = FILE_PREVIEW_CODE_MAX_LINES + 20;
    const contents = Array.from(
      { length: totalLineCount },
      (_, index) => `line ${index + 1}`,
    ).join("\n");

    render(
      <FilePreview
        headerMode="none"
        path="src/generated.ts"
        state={{
          kind: "ready",
          file: { name: "generated.ts", contents },
          lineRange: {
            startLineNumber: FILE_PREVIEW_CODE_MAX_LINES + 10,
            endLineNumber: FILE_PREVIEW_CODE_MAX_LINES + 10,
          },
          textPreviewKind: null,
        }}
      />,
    );

    await screen.findByTestId("pierre-file");
    expect(pierreMock.state.lastFile?.contents).toBe(contents);
    expect(screen.queryByRole("button", { name: "Load full file" })).toBeNull();
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

  it("opens line-linked HTML files in rendered preview mode", () => {
    const { container } = render(
      <FilePreview
        path="docs/report.html"
        state={{
          kind: "html",
          file: {
            name: "report.html",
            contents: "<!doctype html><h1>Report</h1>",
          },
          iframe: {
            sandbox: "allow-scripts",
            title: "docs/report.html",
            url: "/preview/docs/report.html",
          },
          lineRange: { startLineNumber: 1023, endLineNumber: 1023 },
        }}
      />,
    );

    expect(
      screen
        .getByRole("button", { name: "Preview" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    const iframe = container.querySelector("iframe");
    expect(iframe?.getAttribute("src")).toBe("/preview/docs/report.html");
    expect(iframe?.closest('[aria-hidden="true"]')).toBeNull();
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

  it("reloads an HTML iframe only when the fetched source changes", () => {
    const path = "reports/preview.html";
    const htmlPreviewUrl =
      "/api/v1/threads/thread-1/worktree/files/preview.html";
    const firstPreview = {
      kind: "text" as const,
      content: "<!doctype html><h1>First</h1>",
      mimeType: "text/html",
      path,
      url: htmlPreviewUrl,
    };
    const view = render(
      <SecondaryPanelFilePreview
        activePath={path}
        filePreview={firstPreview}
        htmlPreviewUrl={htmlPreviewUrl}
        isLoading={false}
      />,
    );

    const firstIframe = screen.getByTitle(path);

    view.rerender(
      <SecondaryPanelFilePreview
        activePath={path}
        filePreview={{ ...firstPreview }}
        htmlPreviewUrl={htmlPreviewUrl}
        isLoading={false}
      />,
    );
    expect(screen.getByTitle(path)).toBe(firstIframe);

    view.rerender(
      <SecondaryPanelFilePreview
        activePath={path}
        filePreview={{
          ...firstPreview,
          content: "<!doctype html><h1>Updated</h1>",
        }}
        htmlPreviewUrl={htmlPreviewUrl}
        isLoading={false}
      />,
    );
    expect(screen.getByTitle(path)).not.toBe(firstIframe);
  });
});
