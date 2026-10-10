// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import { ResourceSidebar } from "./ResourceSidebar";
import type { ToolsSectionId } from "./tools-navigation";

afterEach(cleanup);

function renderSidebarAt(workspace: ToolsSectionId, path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SidebarProvider>
        <ResourceSidebar
          workspace={workspace}
          isResizing={false}
          onResizeMouseDown={() => {}}
        />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

const row = (name: string) => screen.getByRole("link", { name });

describe("Plugins sidebar", () => {
  it("owns only the Plugins pages, leaving the title and the way back to the rail", () => {
    renderSidebarAt("plugins", "/plugins");

    expect(screen.queryByText("Plugins")).toBeNull();
    expect(screen.queryByRole("link", { name: "Back to app" })).toBeNull();
    expect(screen.getByTestId("plugins-sidebar-body")).toBeTruthy();
    expect(row("Browse plugins").getAttribute("href")).toBe("/plugins");
    expect(row("Installed plugins").getAttribute("href")).toBe(
      "/plugins?view=installed",
    );
    expect(row("Browse plugins").querySelector("svg")).toBeNull();
    expect(row("Installed plugins").querySelector("svg")).toBeNull();
    expect(screen.queryByText("Skills")).toBeNull();
    expect(screen.queryByRole("link", { name: "Browse skills" })).toBeNull();
    expect(screen.queryByRole("link", { name: "My skills" })).toBeNull();
  });

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
  it("owns only the Skills pages", () => {
    renderSidebarAt("skills", "/skills");

    expect(screen.queryByText("Skills")).toBeNull();
    expect(row("Browse skills").getAttribute("href")).toBe("/skills");
    expect(row("My skills").getAttribute("href")).toBe("/skills?view=library");
    expect(row("Browse skills").querySelector("svg")).toBeNull();
    expect(row("My skills").querySelector("svg")).toBeNull();
    expect(screen.queryByText("Plugins")).toBeNull();
    expect(screen.queryByRole("link", { name: "Browse plugins" })).toBeNull();
    expect(
      screen.queryByRole("link", { name: "Installed plugins" }),
    ).toBeNull();
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
