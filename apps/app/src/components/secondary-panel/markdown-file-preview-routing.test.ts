import { describe, expect, it, vi } from "vitest";
import {
  buildProjectFilePreviewUrl,
  buildProjectAttachmentPreviewUrl,
  buildThreadHostFilePreviewUrl,
  buildThreadStoragePreviewUrl,
  buildThreadWorktreeRawContentUrl,
} from "@/lib/file-content-urls";
import {
  buildMarkdownFilePreviewRouting,
  resolveMarkdownFilePreviewRootPath,
  type MarkdownFilePreviewContentSource,
} from "./markdown-file-preview-routing";

const rootPath = "/work space/资料%";
const baseDir = `${rootPath}/docs`;
const resourcePath = `${baseDir}/asset space-图%.png`;
const onOpenLink = vi.fn(() => true);
const onOpenLocalFileLink = vi.fn(() => true);

function buildRouting(contentSource: MarkdownFilePreviewContentSource) {
  return buildMarkdownFilePreviewRouting({
    baseDir,
    contentSource,
    onOpenLink,
    onOpenLocalFileLink,
    rootPath,
  });
}

function resolveResource(
  contentSource: MarkdownFilePreviewContentSource,
  target:
    | { fragment?: string; lineRange: null }
    | {
        fragment?: undefined;
        lineRange: { endLineNumber: number; startLineNumber: number };
      } = { lineRange: null },
) {
  return buildRouting(contentSource).localImage?.resolveSrc({
    ...target,
    path: resourcePath,
  });
}

describe("buildMarkdownFilePreviewRouting", () => {
  it("routes working-tree resources through the authenticated thread route", () => {
    expect(
      resolveResource(
        {
          environmentId: "env-1",
          fileSource: { kind: "working-tree" },
          kind: "workspace",
          projectId: "project-1",
          threadId: "thread-1",
        },
        { fragment: "#section%20one", lineRange: null },
      ),
    ).toBe(
      `${buildThreadWorktreeRawContentUrl(
        "thread-1",
        "docs/asset space-图%.png",
      )}#section%20one`,
    );
  });

  it("uses the project route for a root workspace without thread context", () => {
    expect(
      resolveResource({
        environmentId: "env-1",
        fileSource: { kind: "working-tree" },
        kind: "workspace",
        projectId: "project-1",
        threadId: null,
      }),
    ).toBe(
      buildProjectFilePreviewUrl("project-1", "docs/asset space-图%.png", {
        environmentId: "env-1",
      }),
    );
  });

  it("omits resource routing for historical files and missing workspace context", () => {
    for (const contentSource of [
      {
        environmentId: "env-1",
        fileSource: { kind: "head" },
        kind: "workspace",
        projectId: "project-1",
        threadId: "thread-1",
      },
      {
        environmentId: null,
        fileSource: { kind: "working-tree" },
        kind: "workspace",
        projectId: null,
        threadId: null,
      },
    ] satisfies MarkdownFilePreviewContentSource[]) {
      const routing = buildRouting(contentSource);
      expect(routing.localImage).toBeUndefined();
      expect(routing.localFile?.relativeLinks).toEqual({ baseDir, rootPath });
    }
  });

  it("routes project, host, and storage resources through their source routes", () => {
    const projectSource = {
      environmentId: null,
      hostId: "host-1",
      kind: "project",
      projectId: "project-1",
    } satisfies MarkdownFilePreviewContentSource;
    expect(resolveResource(projectSource)).toBe(
      buildProjectFilePreviewUrl("project-1", "docs/asset space-图%.png", {
        hostId: "host-1",
      }),
    );
    expect(
      resolveResource(
        { kind: "host", threadId: "thread-1" },
        {
          lineRange: { endLineNumber: 14, startLineNumber: 12 },
        },
      ),
    ).toBe(
      `${buildThreadHostFilePreviewUrl("thread-1", resourcePath)}#L12-L14`,
    );
    expect(
      resolveResource({ kind: "thread-storage", threadId: "thread-1" }),
    ).toBe(
      buildThreadStoragePreviewUrl("thread-1", "docs/asset space-图%.png"),
    );
  });

  it("resolves project attachment resources beside the Markdown attachment", () => {
    const routing = buildMarkdownFilePreviewRouting({
      baseDir: "/uploads/01ABC",
      contentSource: {
        kind: "project-attachment",
        projectId: "project-1",
      },
      onOpenLink,
      onOpenLocalFileLink,
      rootPath: "/",
    });
    expect(
      routing.localImage?.resolveSrc({
        lineRange: null,
        path: "/uploads/01ABC/asset space-图%23.png",
      }),
    ).toBe(
      buildProjectAttachmentPreviewUrl(
        "project-1",
        "uploads/01ABC/asset space-图%23.png",
      ),
    );
  });

  it("keeps controls inactive when root context is missing", () => {
    const routing = buildMarkdownFilePreviewRouting({
      baseDir,
      contentSource: { kind: "host", threadId: "thread-1" },
      onOpenLink,
      onOpenLocalFileLink,
      rootPath: null,
    });

    expect(routing).toEqual({ onOpenLink });
  });
});

describe("resolveMarkdownFilePreviewRootPath", () => {
  it("selects the first containing root when roots overlap", () => {
    expect(
      resolveMarkdownFilePreviewRootPath({
        filePath: "/workspace/project/docs/readme.md",
        rootPaths: ["/workspace/project", "/workspace"],
      }),
    ).toBe("/workspace/project");
  });

  it("selects the containing root and rejects traversal or missing roots", () => {
    expect(
      resolveMarkdownFilePreviewRootPath({
        filePath: "/workspace/project/docs/readme.md",
        rootPaths: ["/workspace/project", "/storage/thread-1"],
      }),
    ).toBe("/workspace/project");
    expect(
      resolveMarkdownFilePreviewRootPath({
        filePath: "/storage/thread-1/current/../readme.md",
        rootPaths: ["/workspace/project", "/storage/thread-1"],
      }),
    ).toBe("/storage/thread-1");
    expect(
      resolveMarkdownFilePreviewRootPath({
        filePath: "/workspace/project/../../secret.md",
        rootPaths: ["/workspace/project", null, undefined],
      }),
    ).toBeNull();
  });
});
