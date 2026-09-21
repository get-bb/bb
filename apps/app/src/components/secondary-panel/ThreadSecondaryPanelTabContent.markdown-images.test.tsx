// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
    previewQuery(path, "/api/v1/file-previews/lease_preview/readme.md"),
}));

afterEach(cleanup);

function imageSrc(name: string): string | null {
  return screen.getByRole("img", { name }).getAttribute("src");
}

describe("secondary-panel Markdown image routing", () => {
  it("routes workspace images when the preview caller supplies no routing", () => {
    render(
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

    expect(imageSrc("absolute")).toBe(
      "/api/v1/threads/thr_preview/host-files/content?path=%2Fworkspace%2Fgenerated.png",
    );
    expect(imageSrc("relative")).toBe(
      "/api/v1/threads/thr_preview/worktree/files/docs/images/chart.png",
    );
    expect(imageSrc("escape")).toBe("../../outside.png");
  });

  it("routes project images through the selected project source", () => {
    render(
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

    expect(imageSrc("absolute")).toContain(
      "/api/v1/projects/proj_preview/files/content?",
    );
    expect(imageSrc("absolute")).toContain("path=generated.png");
    expect(imageSrc("relative")).toContain("path=docs%2Fimages%2Fchart.png");
    expect(imageSrc("absolute")).toContain("hostId=host_preview");
    expect(imageSrc("escape")).toBe("../../outside.png");
  });

  it("routes thread host-file images through the host content endpoint", () => {
    render(
      <HostFilePreviewTabContent
        activePath="/workspace/docs/readme.md"
        copyPath="/workspace/docs/readme.md"
        environmentId="env_preview"
        isPanelOpen
        lineRange={null}
        threadId="thr_preview"
      />,
    );

    expect(imageSrc("absolute")).toBe(
      "/api/v1/threads/thr_preview/host-files/content?path=%2Fworkspace%2Fgenerated.png",
    );
    expect(imageSrc("relative")).toBe(
      "/api/v1/threads/thr_preview/host-files/content?path=%2Fworkspace%2Fdocs%2Fimages%2Fchart.png",
    );
    expect(imageSrc("escape")).toBe("../../outside.png");
  });

  it("confines host-scoped relative images to the preview lease root", () => {
    render(
      <HostScopedFilePreviewTabContent
        activePath="/workspace/docs/readme.md"
        hostId="host_preview"
        isPanelOpen
        lineRange={null}
      />,
    );

    expect(imageSrc("absolute")).toBe("/workspace/generated.png");
    expect(imageSrc("relative")).toBe(
      "/api/v1/file-previews/lease_preview/images/chart.png",
    );
    expect(imageSrc("escape")).toBe("../../outside.png");
  });

  it("routes thread-storage images when the preview caller supplies no routing", () => {
    render(
      <ThreadStorageFilePreviewTabContent
        activePath="docs/readme.md"
        isPanelOpen
        lineRange={null}
        threadId="thr_preview"
      />,
    );

    expect(imageSrc("absolute")).toBe(
      "/api/v1/threads/thr_preview/host-files/content?path=%2Fworkspace%2Fgenerated.png",
    );
    expect(imageSrc("relative")).toBe(
      "/api/v1/threads/thr_preview/thread-storage/files/docs/images/chart.png",
    );
    expect(imageSrc("escape")).toBe("../../outside.png");
  });
});
