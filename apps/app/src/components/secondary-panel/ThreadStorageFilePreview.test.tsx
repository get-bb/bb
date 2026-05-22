// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FilePreview } from "@/lib/file-preview";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { installFetchRoutes, jsonResponse } from "@/test/http-test-utils";
import {
  MANAGER_STATUS_FILE_PATH,
  MANAGER_STATUS_HTML_FILE_PATH,
  MANAGER_STATUS_INDEX_FILE_PATH,
  MANAGER_STATUS_MARKDOWN_FILE_PATH,
} from "./managerStorage";
import {
  SecondaryPanelFilePreview,
  ThreadStorageFilePreview,
} from "./ThreadStorageFilePreview";

interface MakeTextPreviewArgs {
  content: string;
  path: string;
}

function makeTextPreview({ content, path }: MakeTextPreviewArgs): FilePreview {
  return {
    kind: "text",
    content,
    mimeType: "text/plain",
    path,
    url: `/preview/${path}`,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("ThreadStorageFilePreview", () => {
  it("renders worktree HTML files through a sandboxed raw iframe", () => {
    const { container } = render(
      <SecondaryPanelFilePreview
        activePath="public/report.html"
        filePreview={makeTextPreview({
          content: "<!doctype html><h1>Report</h1>",
          path: "public/report.html",
        })}
        htmlPreviewUrl="/api/v1/threads/thr_standard/worktree/files/public/report.html"
        isLoading={false}
      />,
    );

    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute("src")).toBe(
      "/api/v1/threads/thr_standard/worktree/files/public/report.html",
    );
    expect(iframe?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(iframe?.getAttribute("srcdoc")).toBeNull();
    expect(container.textContent).not.toContain("<!doctype html>");
  });

  it("renders empty HTML files as blank sandboxed iframes", () => {
    const { container } = render(
      <SecondaryPanelFilePreview
        activePath="empty.html"
        filePreview={makeTextPreview({
          content: "",
          path: "empty.html",
        })}
        htmlPreviewUrl="/api/v1/threads/thr_standard/worktree/files/empty.html"
        isLoading={false}
      />,
    );

    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute("src")).toBe(
      "/api/v1/threads/thr_standard/worktree/files/empty.html",
    );
    expect(iframe?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(screen.queryByText("Empty file.")).toBeNull();
  });

  it("renders the unified STATUS route in an unsandboxed iframe", async () => {
    let resolveVersion = (response: Response) => response;
    const versionResponse = new Promise<Response>((resolve) => {
      resolveVersion = (response: Response) => {
        resolve(response);
        return response;
      };
    });
    installFetchRoutes([
      {
        pathname: "/api/v1/threads/thr_manager/status-version",
        handler: () => versionResponse,
      },
    ]);
    const { wrapper } = createQueryClientTestHarness();
    const { container } = render(
      <ThreadStorageFilePreview
        activePath={MANAGER_STATUS_FILE_PATH}
        filePreview={undefined}
        isLoading={false}
        pinnedPath={MANAGER_STATUS_FILE_PATH}
        threadId="thr_manager"
      />,
      { wrapper },
    );

    const iframe = container.querySelector("iframe");

    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute("src")).toBe(
      "/api/v1/threads/thr_manager/status/",
    );
    expect(iframe?.hasAttribute("sandbox")).toBe(false);
    expect(iframe?.style.width).toBe("100%");
    expect(iframe?.style.height).toBe("100%");
    expect(iframe?.style.border).toBe("0px");

    resolveVersion(jsonResponse({ source: "folder", hash: "status-hash-1" }));

    await vi.waitFor(() => {
      expect(iframe?.getAttribute("src")).toBe(
        "/api/v1/threads/thr_manager/status/?v=status-hash-1",
      );
    });
  });

  it("updates the STATUS iframe src when the polled hash changes", async () => {
    let requestCount = 0;
    installFetchRoutes([
      {
        pathname: "/api/v1/threads/thr_manager/status-version",
        handler: () => {
          requestCount += 1;
          return jsonResponse({
            source: "folder",
            hash: requestCount === 1 ? "status-hash-1" : "status-hash-2",
          });
        },
      },
    ]);
    const { wrapper } = createQueryClientTestHarness();
    const { container } = render(
      <ThreadStorageFilePreview
        activePath={MANAGER_STATUS_FILE_PATH}
        filePreview={undefined}
        isLoading={false}
        pinnedPath={MANAGER_STATUS_FILE_PATH}
        threadId="thr_manager"
      />,
      { wrapper },
    );

    const iframe = container.querySelector("iframe");
    await waitFor(() => {
      expect(iframe?.getAttribute("src")).toBe(
        "/api/v1/threads/thr_manager/status/?v=status-hash-1",
      );
    });

    await waitFor(
      () => {
        expect(iframe?.getAttribute("src")).toBe(
          "/api/v1/threads/thr_manager/status/?v=status-hash-2",
        );
      },
      { timeout: 2_500 },
    );
  }, 8_000);

  it("renders generic storage HTML files through a sandboxed raw iframe", () => {
    const { wrapper } = createQueryClientTestHarness();
    const { container } = render(
      <ThreadStorageFilePreview
        activePath="reports/status.html"
        filePreview={makeTextPreview({
          content: "<script>window.preview = true</script>",
          path: "reports/status.html",
        })}
        isLoading={false}
        pinnedPath={MANAGER_STATUS_FILE_PATH}
        threadId="thr_manager"
      />,
      { wrapper },
    );

    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute("src")).toBe(
      "/api/v1/threads/thr_manager/thread-storage/files/reports/status.html",
    );
    expect(iframe?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(iframe?.getAttribute("srcdoc")).toBeNull();
    expect(container.textContent).not.toContain("bbStatusState");
    expect(container.textContent).not.toContain("bbThreadTell");
  });

  it.each([
    MANAGER_STATUS_HTML_FILE_PATH,
    MANAGER_STATUS_INDEX_FILE_PATH,
    MANAGER_STATUS_MARKDOWN_FILE_PATH,
  ])("renders %s through the unified STATUS route", (activePath) => {
    installFetchRoutes([
      {
        pathname: "/api/v1/threads/thr_manager/status-version",
        handler: () => jsonResponse({ source: "html", hash: "status-hash" }),
      },
    ]);
    const { wrapper } = createQueryClientTestHarness();
    const { container } = render(
      <ThreadStorageFilePreview
        activePath={activePath}
        filePreview={makeTextPreview({
          content: "# Status",
          path: activePath,
        })}
        isLoading={false}
        pinnedPath={MANAGER_STATUS_FILE_PATH}
        threadId="thr_manager"
      />,
      { wrapper },
    );

    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute("src")).toBe(
      "/api/v1/threads/thr_manager/status/",
    );
  });
});
