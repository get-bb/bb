// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FilePreview } from "@/lib/file-preview";
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

  it("toggles HTML files between rendered preview and raw source", () => {
    const htmlContent = "<!doctype html><h1>Report</h1>";
    const { container } = render(
      <SecondaryPanelFilePreview
        activePath="public/report.html"
        filePreview={makeTextPreview({
          content: htmlContent,
          path: "public/report.html",
        })}
        htmlPreviewUrl="/api/v1/threads/thr_standard/worktree/files/public/report.html"
        isLoading={false}
      />,
    );

    expect(
      screen.getByRole("tablist", { name: "HTML view mode" }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Preview" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(container.querySelector("iframe")).not.toBeNull();
    expect(container.textContent).not.toContain(htmlContent);

    fireEvent.click(screen.getByRole("button", { name: "Raw" }));

    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("diffs-container")).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Raw" }).getAttribute("aria-pressed"),
    ).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute("src")).toBe(
      "/api/v1/threads/thr_standard/worktree/files/public/report.html",
    );
    expect(container.querySelector("diffs-container")).toBeNull();
    expect(container.textContent).not.toContain(htmlContent);
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

  it("routes markdown preview local file links through the provided handler", () => {
    const onOpenLocalFileLink = vi.fn(() => true);
    render(
      <SecondaryPanelFilePreview
        activePath="notes/current.md"
        filePreview={makeTextPreview({
          content: "[Plan](../plan.md)",
          path: "notes/current.md",
        })}
        isLoading={false}
        markdownLinkRouting={{
          localFile: {
            absoluteLinks: {
              kind: "contained",
              rootPath: "/storage/thr_1",
            },
            onOpenLink: onOpenLocalFileLink,
            relativeLinks: {
              baseDir: "/storage/thr_1/notes",
              rootPath: "/storage/thr_1",
            },
          },
        }}
      />,
    );

    const link = screen.getByRole("link", { name: "Plan" });
    expect(link.getAttribute("href")).toBe("file:///storage/thr_1/plan.md");

    fireEvent.click(link);

    expect(onOpenLocalFileLink).toHaveBeenCalledWith({
      lineRange: null,
      path: "/storage/thr_1/plan.md",
    });
  });

  it("renders generic storage HTML files through a sandboxed raw iframe", () => {
    const { container } = render(
      <ThreadStorageFilePreview
        activePath="reports/preview.html"
        filePreview={makeTextPreview({
          content: "<script>window.preview = true</script>",
          path: "reports/preview.html",
        })}
        isLoading={false}
        threadId="thr_parent"
      />,
    );

    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute("src")).toBe(
      "/api/v1/threads/thr_parent/thread-storage/files/reports/preview.html",
    );
    expect(iframe?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(iframe?.getAttribute("srcdoc")).toBeNull();
    expect(container.textContent).not.toContain("window.bb");
  });
});
