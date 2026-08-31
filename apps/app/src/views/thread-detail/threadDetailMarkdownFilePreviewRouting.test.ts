import { describe, expect, it, vi } from "vitest";
import {
  buildThreadHostFilePreviewUrl,
  buildThreadStoragePreviewUrl,
  buildThreadWorktreeRawContentUrl,
} from "@/lib/file-content-urls";
import { buildThreadDetailMarkdownFilePreviewRouting } from "./threadDetailMarkdownFilePreviewRouting";

const onOpenLink = vi.fn(() => true);
const onOpenLocalFileLink = vi.fn(() => true);

function resolveSibling(
  routing: ReturnType<typeof buildThreadDetailMarkdownFilePreviewRouting>,
) {
  const baseDir = routing.localImage?.relativePaths?.baseDir;
  return baseDir === undefined
    ? undefined
    : routing.localImage?.resolveSrc({
        lineRange: null,
        path: `${baseDir}/asset space-资料%.png`,
      });
}

describe("buildThreadDetailMarkdownFilePreviewRouting", () => {
  it("routes workspace Markdown links and resources beside the preview file", () => {
    const routing = buildThreadDetailMarkdownFilePreviewRouting({
      onOpenLink,
      onOpenLocalFileLink,
      source: {
        absolutePath: "/workspace/项目%/docs/readme.md",
        environmentId: "env-1",
        fileSource: { kind: "working-tree" },
        kind: "workspace",
        projectId: "project-1",
        rootPath: "/workspace/项目%",
        threadId: "thread-1",
      },
    });

    expect(routing.localFile?.relativeLinks).toEqual({
      baseDir: "/workspace/项目%/docs",
      rootPath: "/workspace/项目%",
    });
    expect(resolveSibling(routing)).toBe(
      buildThreadWorktreeRawContentUrl(
        "thread-1",
        "docs/asset space-资料%.png",
      ),
    );
  });

  it("selects the containing root for host Markdown resources", () => {
    const routing = buildThreadDetailMarkdownFilePreviewRouting({
      onOpenLink,
      onOpenLocalFileLink,
      source: {
        filePath: "/storage/thread-1/current/docs/readme.md",
        kind: "host",
        rootPaths: ["/workspace/project", "/storage/thread-1"],
        threadId: "thread-1",
      },
    });

    expect(routing.localFile?.relativeLinks?.rootPath).toBe(
      "/storage/thread-1",
    );
    expect(resolveSibling(routing)).toBe(
      buildThreadHostFilePreviewUrl(
        "thread-1",
        "/storage/thread-1/current/docs/asset space-资料%.png",
      ),
    );
  });

  it("routes storage Markdown links and resources beside the preview file", () => {
    const routing = buildThreadDetailMarkdownFilePreviewRouting({
      onOpenLink,
      onOpenLocalFileLink,
      source: {
        absolutePath: "/storage/thread-1/current/docs/readme.md",
        kind: "thread-storage",
        rootPath: "/storage/thread-1",
        threadId: "thread-1",
      },
    });

    expect(routing.localFile?.relativeLinks).toEqual({
      baseDir: "/storage/thread-1/current/docs",
      rootPath: "/storage/thread-1",
    });
    expect(resolveSibling(routing)).toBe(
      buildThreadStoragePreviewUrl(
        "thread-1",
        "current/docs/asset space-资料%.png",
      ),
    );
  });
});
