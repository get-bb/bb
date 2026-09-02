// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import { PluginsSidebar } from "@/components/plugin/PluginsSidebar";
import { SkillsSidebar } from "./SkillsSidebar";

afterEach(cleanup);

function renderPluginsAt(path: string, appRoutePath = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SidebarProvider>
        <PluginsSidebar
          appRoutePath={appRoutePath}
          isResizing={false}
          onResizeMouseDown={() => {}}
          showTopReserve={false}
        />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

function renderSkillsAt(path: string, appRoutePath = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SidebarProvider>
        <SkillsSidebar
          appRoutePath={appRoutePath}
          isResizing={false}
          onResizeMouseDown={() => {}}
          showTopReserve={false}
        />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

const row = (name: string) => screen.getByRole("link", { name });

describe("PluginsSidebar", () => {
  it("owns only the Plugins pages and the app back target", () => {
    renderPluginsAt("/plugins", "/projects/proj_one");

    expect(screen.getByText("Plugins")).toBeTruthy();
    expect(row("Browse plugins").getAttribute("href")).toBe("/plugins");
    expect(row("Installed plugins").getAttribute("href")).toBe(
      "/plugins?view=installed",
    );
    expect(screen.queryByText("Skills")).toBeNull();
    expect(screen.queryByRole("link", { name: "Browse skills" })).toBeNull();
    expect(screen.queryByRole("link", { name: "My skills" })).toBeNull();
    expect(row("Back to app").getAttribute("href")).toBe("/projects/proj_one");
  });

  it.each([
    ["/plugins", "Browse plugins"],
    ["/plugins?view=installed", "Installed plugins"],
    ["/plugins/github", "Browse plugins"],
    ["/plugins/github?view=installed", "Installed plugins"],
  ])("marks %s as %s", (path, expected) => {
    renderPluginsAt(path);

    expect(row(expected).getAttribute("aria-current")).toBe("page");
  });
});

describe("SkillsSidebar", () => {
  it("owns only the Skills pages and the app back target", () => {
    renderSkillsAt("/skills", "/projects/proj_one");

    expect(screen.getByText("Skills")).toBeTruthy();
    expect(row("Browse skills").getAttribute("href")).toBe("/skills");
    expect(row("My skills").getAttribute("href")).toBe("/skills?view=library");
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
    renderSkillsAt(path);

    expect(row(expected).getAttribute("aria-current")).toBe("page");
  });
});
