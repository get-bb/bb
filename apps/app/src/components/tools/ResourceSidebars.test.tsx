// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { pluginListQueryKey } from "@/hooks/queries/query-keys";
import { pluginListingsQueryKey } from "@/hooks/queries/plugin-listing-queries";
import { SidebarProvider } from "@/components/ui/sidebar";
import { ResourceSidebar } from "./ResourceSidebar";
import type { ToolsSectionId } from "./tools-navigation";

afterEach(cleanup);

function renderSidebarAt(
  workspace: ToolsSectionId,
  path: string,
  appRoutePath = "/",
) {
  const { wrapper } = createQueryClientTestHarness();
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SidebarProvider>
        <ResourceSidebar
          workspace={workspace}
          appRoutePath={appRoutePath}
          isResizing={false}
          onResizeMouseDown={() => {}}
          showTopReserve={false}
        />
      </SidebarProvider>
    </MemoryRouter>,
    { wrapper },
  );
}

const row = (name: string) => screen.getByRole("link", { name });

describe("Plugins sidebar", () => {
  it("owns only the Plugins pages and the app back target", () => {
    renderSidebarAt("plugins", "/plugins", "/projects/proj_one");

    expect(screen.getByText("Plugins")).toBeTruthy();
    expect(row("Browse plugins").getAttribute("href")).toBe("/plugins");
    expect(row("Installed plugins").getAttribute("href")).toBe(
      "/plugins?view=installed",
    );
    expect(row("Browse plugins").querySelector("svg")).toBeNull();
    expect(row("Installed plugins").querySelector("svg")).toBeNull();
    expect(screen.queryByText("Skills")).toBeNull();
    expect(screen.queryByRole("link", { name: "Browse skills" })).toBeNull();
    expect(screen.queryByRole("link", { name: "My skills" })).toBeNull();
    expect(row("Back to app").getAttribute("href")).toBe("/projects/proj_one");
  });

  it.each([false, true])(
    "hides Installed only when both collections are empty (authored: %s)",
    (authored) => {
      const { queryClient, wrapper } = createQueryClientTestHarness();
      queryClient.setQueryData(pluginListQueryKey(true), []);
      queryClient.setQueryData(pluginListingsQueryKey(), {
        records: authored
          ? [
              {
                pluginId: "review-notes",
                authorship: "explicit",
                entry: {
                  id: "review-notes",
                  displayName: "Review Notes",
                  description: "Review notes",
                  icon: "BookOpen",
                  author: { name: "Bersabel" },
                  source: {
                    git: {
                      url: "https://github.com/brsbl/review-notes",
                      ref: "main",
                    },
                  },
                },
                lifecycle: { status: "draft" },
              },
            ]
          : [],
        notices: [],
      });
      render(
        <MemoryRouter initialEntries={["/plugins"]}>
          <SidebarProvider>
            <ResourceSidebar
              workspace="plugins"
              appRoutePath="/"
              isResizing={false}
              onResizeMouseDown={() => {}}
              showTopReserve={false}
            />
          </SidebarProvider>
        </MemoryRouter>,
        { wrapper },
      );
      expect(
        screen.queryByRole("link", { name: "Installed plugins" }) !== null,
      ).toBe(authored);
      expect(screen.getByRole("link", { name: "Browse plugins" })).toBeTruthy();
    },
  );

  it.each([
    ["/plugins", "Browse plugins"],
    ["/plugins?view=installed", "Installed plugins"],
    ["/plugins/github", "Browse plugins"],
    ["/plugins/github?view=installed", "Installed plugins"],
  ])("marks %s as %s", (path, expected) => {
    renderSidebarAt("plugins", path);

    expect(row(expected).getAttribute("aria-current")).toBe("page");
  });
});

describe("Skills sidebar", () => {
  it("owns only the Skills pages and the app back target", () => {
    renderSidebarAt("skills", "/skills", "/projects/proj_one");

    expect(screen.getByText("Skills")).toBeTruthy();
    expect(row("Browse skills").getAttribute("href")).toBe("/skills");
    expect(row("My skills").getAttribute("href")).toBe("/skills?view=library");
    expect(row("Browse skills").querySelector("svg")).toBeNull();
    expect(row("My skills").querySelector("svg")).toBeNull();
    expect(screen.queryByText("Plugins")).toBeNull();
    expect(screen.queryByRole("link", { name: "Browse plugins" })).toBeNull();
    expect(
      screen.queryByRole("link", { name: "Installed plugins" }),
    ).toBeNull();
    expect(row("Back to app").getAttribute("href")).toBe("/projects/proj_one");
  });

  it.each([
    ["/skills", "Browse skills"],
    ["/skills/registry", "Browse skills"],
    ["/skills?view=library", "My skills"],
    ["/skills/library/my-skill", "My skills"],
    ["/skills/registry/owner%2Frepo%2Fskill", "Browse skills"],
  ])("marks %s as %s", (path, expected) => {
    renderSidebarAt("skills", path);

    expect(row(expected).getAttribute("aria-current")).toBe("page");
  });
});
