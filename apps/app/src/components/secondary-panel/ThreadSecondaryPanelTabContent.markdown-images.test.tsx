import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  HostFilePreviewTabContent,
  HostScopedFilePreviewTabContent,
  ProjectFilePreviewTabContent,
  ThreadStorageFilePreviewTabContent,
  WorkspaceFilePreviewTabContent,
} from "./ThreadSecondaryPanelTabContent";
import type { FilePreview } from "@bb/client-core";

function markdownPreview(path: string, url = `/content/${path}`): FilePreview {
  return {
    kind: "text",
    content: [
      "![absolute](/workspace/generated.png)",
      "![relative](images/chart.png)",
      "![escape](../../outside.png)",
    ].join("\n\n"),
    mimeType: "text/markdown",
    name: path.split("/").at(-1),
    path,
    url,
  };
}

function previewQuery(path: string, url?: string) {
  return {
    data: markdownPreview(path, url),
    error: null,
    isFetching: false,
    isLoading: false,
    refetch: vi.fn(),
  };
}

vi.mock("@/hooks/queries/environment-queries", () => ({
  useEnvironment: () => ({
    data: { path: "/workspace", projectId: "proj_preview" },
  }),
  useEnvironmentDiffFiles: vi.fn(),
  useEnvironmentFilePreview: (_environmentId: string, path: string) =>
    previewQuery(path),
}));

vi.mock("@/hooks/queries/project-queries", () => ({
  useProjectFilePreview: (_projectId: string, path: string) =>
    previewQuery(path),
}));

vi.mock("@/hooks/queries/thread-queries", () => ({
  useThreadHostFilePreview: (
    _threadId: string,
    _environmentId: string,
    path: string,
  ) => previewQuery(path),
  useThreadStorageFilePreview: (_threadId: string, path: string) =>
    previewQuery(path),
}));

vi.mock("@/hooks/queries/host-file-preview-query", () => ({
  useHostFilePreview: (_hostId: string, path: string) =>
    previewQuery(
      path,
      "/api/v1/hosts/host_preview/files/workspace/docs/readme.md",
    ),
}));

function renderImageSources(element: ReactElement): Map<string, string> {
  const sources = new Map<string, string>();
  for (const [tag] of renderToStaticMarkup(element).matchAll(
    /<img\b[^>]*>/gu,
  )) {
    const alt = /\balt="([^"]*)"/u.exec(tag)?.[1];
    const src = /\bsrc="([^"]*)"/u.exec(tag)?.[1];
    if (alt !== undefined && src !== undefined) sources.set(alt, src);
  }
  return sources;
}

describe("secondary-panel Markdown image routing", () => {
  it("routes workspace images when the preview caller supplies no routing", () => {
    const imageSrc = renderImageSources(
      <WorkspaceFilePreviewTabContent
        activePath="docs/readme.md"
        environmentId="env_preview"
        isPanelOpen
        lineRange={null}
        source={{ kind: "working-tree" }}
        statusLabel={null}
        threadId="thr_preview"
      />,
    );

    expect(imageSrc.get("absolute")).toBe(
      "/api/v1/threads/thr_preview/host-files/workspace/generated.png",
    );
    expect(imageSrc.get("relative")).toBe(
      "/api/v1/environments/env_preview/files/docs/images/chart.png",
    );
    expect(imageSrc.get("escape")).toBe("../../outside.png");
  });

  it("routes project images through the selected project source", () => {
    const imageSrc = renderImageSources(
      <ProjectFilePreviewTabContent
        activePath="docs/readme.md"
        environmentId={null}
        hostId="host_preview"
        isPanelOpen
        lineRange={null}
        projectId="proj_preview"
        rootPath="/workspace"
      />,
    );

    expect(imageSrc.get("absolute")).toBe(
      "/api/v1/projects/proj_preview/hosts/host_preview/files/generated.png",
    );
    expect(imageSrc.get("relative")).toBe(
      "/api/v1/projects/proj_preview/hosts/host_preview/files/docs/images/chart.png",
    );
    expect(imageSrc.get("escape")).toBe("../../outside.png");
  });

  it("routes thread host-file images through the host content endpoint", () => {
    const imageSrc = renderImageSources(
      <HostFilePreviewTabContent
        activePath="/workspace/docs/readme.md"
        copyPath="/workspace/docs/readme.md"
        environmentId="env_preview"
        isPanelOpen
        lineRange={null}
        threadId="thr_preview"
      />,
    );

    expect(imageSrc.get("absolute")).toBe(
      "/api/v1/threads/thr_preview/host-files/workspace/generated.png",
    );
    expect(imageSrc.get("relative")).toBe(
      "/api/v1/threads/thr_preview/host-files/workspace/docs/images/chart.png",
    );
    expect(imageSrc.get("escape")).toBe("../../outside.png");
  });

  it("confines host-scoped relative images to the previewed folder", () => {
    const imageSrc = renderImageSources(
      <HostScopedFilePreviewTabContent
        activePath="/workspace/docs/readme.md"
        hostId="host_preview"
        isPanelOpen
        lineRange={null}
      />,
    );

    expect(imageSrc.get("absolute")).toBe("/workspace/generated.png");
    expect(imageSrc.get("relative")).toBe(
      "/api/v1/hosts/host_preview/files/workspace/docs/images/chart.png",
    );
    expect(imageSrc.get("escape")).toBe("../../outside.png");
  });

  it("routes thread-storage images when the preview caller supplies no routing", () => {
    const imageSrc = renderImageSources(
      <ThreadStorageFilePreviewTabContent
        activePath="docs/readme.md"
        isPanelOpen
        lineRange={null}
        threadId="thr_preview"
      />,
    );

    expect(imageSrc.get("absolute")).toBe(
      "/api/v1/threads/thr_preview/host-files/workspace/generated.png",
    );
    expect(imageSrc.get("relative")).toBe(
      "/api/v1/threads/thr_preview/thread-storage/files/docs/images/chart.png",
    );
    expect(imageSrc.get("escape")).toBe("../../outside.png");
  });
});
