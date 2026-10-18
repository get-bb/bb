// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProjectFilePreviewTabContent } from "./ThreadSecondaryPanelTabContent";

const projectPreviewQuery = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/queries/project-queries", () => ({
  useProjectFilePreview: projectPreviewQuery,
}));

afterEach(() => cleanup());

it("renders project HTML through the selected host's file route", () => {
  projectPreviewQuery.mockReturnValueOnce({
    error: null,
    isFetching: false,
    isLoading: false,
    refetch: vi.fn(),
    data: {
      kind: "text",
      content: "<!doctype html><h1>Report</h1>",
      mimeType: "text/html",
      path: "docs/report.html",
      url: "/content/docs/report.html",
    },
  });
  const view = render(
    <ProjectFilePreviewTabContent
      activePath="docs/report.html"
      environmentId={null}
      hostId="host_preview"
      isPanelOpen
      lineRange={null}
      projectId="proj_preview"
      rootPath="/workspace"
    />,
  );

  expect(view.container.querySelector("iframe")?.getAttribute("src")).toBe(
    "/api/v1/projects/proj_preview/hosts/host_preview/files/docs/report.html",
  );
});
