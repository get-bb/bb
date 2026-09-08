// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FilePreview } from "@/components/secondary-panel/FilePreview";
import {
  buildMarkdownFileImageRouting,
  buildMarkdownLeaseImageRouting,
} from "./markdown-file-image-routing";
import type { MarkdownLinkRouting } from "./markdown-link-routing";
import {
  buildThreadStorageRawContentUrl,
  buildThreadWorktreeRawContentUrl,
} from "@/lib/file-content-urls";

afterEach(cleanup);

function renderMarkdownFilePreview({
  content,
  imageContent,
  path,
  rootPath,
}: {
  content: string;
  imageContent: {
    kind: "thread-storage" | "worktree";
    threadId: string;
  };
  path: string;
  rootPath: string;
}) {
  render(
    <FilePreview
      headerMode="none"
      markdownLinkRouting={buildMarkdownFileImageRouting({
        path,
        threadId: imageContent.threadId,
        resolveRelativeSrc: (relativePath) =>
          imageContent.kind === "thread-storage"
            ? buildThreadStorageRawContentUrl(
                imageContent.threadId,
                relativePath,
              )
            : buildThreadWorktreeRawContentUrl(
                imageContent.threadId,
                relativePath,
              ),
        rootPath,
      })}
      path={path}
      state={{
        kind: "ready",
        file: { contents: content, name: path },
        lineRange: null,
        textPreviewKind: "markdown",
      }}
    />,
  );
}

describe("Markdown file preview image routing", () => {
  it("preserves explicit image routing and file-link handlers", () => {
    const linkRouting: MarkdownLinkRouting = {
      onOpenLink: vi.fn(() => false),
      localImage: {
        absolutePaths: { kind: "trusted-host" },
        resolveSrc: vi.fn(() => "/custom/image.png"),
      },
    };
    expect(
      buildMarkdownFileImageRouting({
        path: "docs/report.md",
        rootPath: "/workspace",
        threadId: "thr_preview",
        linkRouting,
        resolveRelativeSrc: vi.fn(),
      }),
    ).toBe(linkRouting);
  });

  it("resolves nested skill and host files within their shared preview lease", () => {
    render(
      <FilePreview
        headerMode="none"
        markdownLinkRouting={buildMarkdownLeaseImageRouting({
          path: "references/guide.md",
          rootPath: "/skills/example",
          previewUrl: "/api/v1/file-previews/lease_skill/SKILL.md",
        })}
        path="references/guide.md"
        state={{
          kind: "ready",
          file: {
            contents:
              "![relative](../assets/chart.png)\n\n![absolute](/skills/example/assets/chart.png)\n\n![escape](../../outside.png)",
            name: "guide.md",
          },
          lineRange: null,
          textPreviewKind: "markdown",
        }}
      />,
    );
    for (const name of ["relative", "absolute"]) {
      expect(screen.getByRole("img", { name }).getAttribute("src")).toBe(
        "/api/v1/file-previews/lease_skill/assets/chart.png",
      );
    }
    expect(
      screen.getByRole("img", { name: "escape" }).getAttribute("src"),
    ).toBe("../../outside.png");
  });

  it("routes absolute and file-relative images in thread-storage Markdown previews", () => {
    renderMarkdownFilePreview({
      content: [
        "![absolute](/Users/me/.bb/thread-storage/thr_preview/generated.png)",
        "![relative](screenshots/chart.png)",
      ].join("\n\n"),
      imageContent: { kind: "thread-storage", threadId: "thr_preview" },
      path: "reports/nested/report.md",
      rootPath: "/Users/me/.bb/thread-storage/thr_preview",
    });

    expect(
      screen.getByRole("img", { name: "absolute" }).getAttribute("src"),
    ).toBe(
      "/api/v1/threads/thr_preview/host-files/content?path=%2FUsers%2Fme%2F.bb%2Fthread-storage%2Fthr_preview%2Fgenerated.png",
    );
    expect(
      screen.getByRole("img", { name: "relative" }).getAttribute("src"),
    ).toBe(
      "/api/v1/threads/thr_preview/thread-storage/files/reports/nested/screenshots/chart.png",
    );
  });

  it("routes absolute and file-relative images in workspace Markdown previews", () => {
    renderMarkdownFilePreview({
      content: [
        "![absolute](/Users/me/project/generated.png)",
        "![relative](../assets/chart.png)",
      ].join("\n\n"),
      imageContent: { kind: "worktree", threadId: "thr_preview" },
      path: "docs/guides/report.md",
      rootPath: "/Users/me/project",
    });

    expect(
      screen.getByRole("img", { name: "absolute" }).getAttribute("src"),
    ).toBe(
      "/api/v1/threads/thr_preview/host-files/content?path=%2FUsers%2Fme%2Fproject%2Fgenerated.png",
    );
    expect(
      screen.getByRole("img", { name: "relative" }).getAttribute("src"),
    ).toBe("/api/v1/threads/thr_preview/worktree/files/docs/assets/chart.png");
  });

  it("does not rewrite relative images that escape the workspace root", () => {
    renderMarkdownFilePreview({
      content: "![escape](../../outside.png)",
      imageContent: { kind: "worktree", threadId: "thr_preview" },
      path: "docs/report.md",
      rootPath: "/Users/me/project",
    });

    expect(
      screen.getByRole("img", { name: "escape" }).getAttribute("src"),
    ).toBe("../../outside.png");
  });
});
