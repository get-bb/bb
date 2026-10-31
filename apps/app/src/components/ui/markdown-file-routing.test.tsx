// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FilePreview } from "@/components/secondary-panel/FilePreview";
import { buildMarkdownFileRouting } from "./markdown-file-routing";
import {
  buildHostFileContentUrl,
  buildThreadHostFileContentUrl,
  buildThreadStorageRawContentUrl,
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
    kind: "thread-storage" | "workspace";
    threadId: string;
  };
  path: string;
  rootPath: string;
}) {
  render(
    <FilePreview
      headerMode="none"
      markdownLinkRouting={buildMarkdownFileRouting({
        path,
        threadId: imageContent.threadId,
        resolveRelativeSrc: (relativePath, absolutePath) =>
          imageContent.kind === "thread-storage"
            ? buildThreadStorageRawContentUrl(
                imageContent.threadId,
                relativePath,
              )
            : buildThreadHostFileContentUrl(
                imageContent.threadId,
                absolutePath,
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
  it("cycles images rendered in a Markdown table", () => {
    render(
      <FilePreview
        headerMode="none"
        path="gallery.md"
        state={{
          kind: "ready",
          file: {
            contents:
              "| First | Second |\n| --- | --- |\n| ![one](one.png) | ![two](two.png) |",
            name: "gallery.md",
          },
          lineRange: null,
          textPreviewKind: "markdown",
        }}
      />,
    );

    const firstImage = screen.getByRole("img", { name: "one" });
    Object.defineProperty(firstImage, "currentSrc", {
      configurable: true,
      value: "https://app.example/one.png",
    });
    fireEvent.click(firstImage);
    fireEvent.click(screen.getByRole("button", { name: "Next image" }));

    expect(
      screen.getByRole("img", { name: "Expanded image" }).getAttribute("src"),
    ).toMatch(/two\.png$/u);

    fireEvent.click(screen.getByRole("button", { name: "Previous image" }));

    expect(
      screen.getByRole("img", { name: "Expanded image" }).getAttribute("src"),
    ).toMatch(/one\.png$/u);
  });

  it("opens links that stay inside the previewed file's root", () => {
    const openFile = vi.fn(() => true);
    render(
      <FilePreview
        headerMode="none"
        markdownLinkRouting={buildMarkdownFileRouting({
          path: "docs/report.md",
          rootPath: "/workspace",
          threadId: null,
          resolveRelativeSrc: (path) => `/content/${path}`,
          openFile,
        })}
        path="docs/report.md"
        state={{
          kind: "ready",
          file: {
            contents:
              "[sibling](notes.md#L3) [parent](../README.md) [absolute](/workspace/src/a.ts) [escape](../../etc/passwd) [outside](/tmp/x.md)",
            name: "report.md",
          },
          lineRange: null,
          textPreviewKind: "markdown",
        }}
      />,
    );

    for (const name of ["sibling", "parent", "absolute", "escape", "outside"]) {
      fireEvent.click(
        screen.queryByRole("link", { name }) ?? screen.getByText(name),
      );
    }

    expect(openFile.mock.calls).toEqual([
      [
        "docs/notes.md",
        "/workspace/docs/notes.md",
        { kind: "range", startLine: 3, endLine: 3 },
      ],
      ["README.md", "/workspace/README.md", null],
      ["src/a.ts", "/workspace/src/a.ts", null],
    ]);
  });

  it("resolves nested skill and host images within the previewed folder", () => {
    render(
      <FilePreview
        headerMode="none"
        markdownLinkRouting={buildMarkdownFileRouting({
          path: "references/guide.md",
          rootPath: "/skills/example",
          threadId: null,
          resolveRelativeSrc: (_relativePath, path) =>
            buildHostFileContentUrl("host_skill", path),
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
        "/api/v1/hosts/host_skill/files/skills/example/assets/chart.png",
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
      "/api/v1/threads/thr_preview/host-files/Users/me/.bb/thread-storage/thr_preview/generated.png",
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
      imageContent: { kind: "workspace", threadId: "thr_preview" },
      path: "docs/guides/report.md",
      rootPath: "/Users/me/project",
    });

    expect(
      screen.getByRole("img", { name: "absolute" }).getAttribute("src"),
    ).toBe(
      "/api/v1/threads/thr_preview/host-files/Users/me/project/generated.png",
    );
    expect(
      screen.getByRole("img", { name: "relative" }).getAttribute("src"),
    ).toBe(
      "/api/v1/threads/thr_preview/host-files/Users/me/project/docs/assets/chart.png",
    );
  });

  it("does not rewrite relative images that escape the workspace root", () => {
    renderMarkdownFilePreview({
      content: "![escape](../../outside.png)",
      imageContent: { kind: "workspace", threadId: "thr_preview" },
      path: "docs/report.md",
      rootPath: "/Users/me/project",
    });

    expect(
      screen.getByRole("img", { name: "escape" }).getAttribute("src"),
    ).toBe("../../outside.png");
  });
});
