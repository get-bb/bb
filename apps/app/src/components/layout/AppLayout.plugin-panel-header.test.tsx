// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppLayout } from "./AppLayout";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { QuickCreateProjectProvider } from "@/hooks/useQuickCreateProject";
import * as compactViewport from "@bb/shared-ui/hooks/use-compact-viewport";

function renderPluginPanelRoute(): void {
  const { wrapper: QueryWrapper } = createQueryClientTestHarness();
  render(
    <QueryWrapper>
      <MemoryRouter initialEntries={["/plugins/helm-wiki/wiki"]}>
        <QuickCreateProjectProvider>
          <AppLayout>
            <div>Plugin panel body</div>
          </AppLayout>
        </QuickCreateProjectProvider>
      </MemoryRouter>
    </QueryWrapper>,
  );
}

describe("AppLayout plugin panel header", () => {
  beforeEach(() => {
    vi.spyOn(compactViewport, "useIsCompactViewport").mockReturnValue(false);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("leaves the compact header to the plugin page panel host", () => {
    vi.spyOn(compactViewport, "useIsCompactViewport").mockReturnValue(true);
    renderPluginPanelRoute();

    expect(screen.queryByTestId("app-page-header")).toBeNull();
  });

  it("leaves the regular header to the plugin page panel host", () => {
    renderPluginPanelRoute();

    expect(screen.queryByTestId("app-page-header")).toBeNull();
  });
});
