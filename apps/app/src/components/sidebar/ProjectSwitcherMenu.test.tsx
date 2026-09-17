// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getRootComposeRoutePath } from "@/lib/route-paths";
import { ProjectSwitcherMenu } from "./ProjectSwitcherMenu";

function makeProject(id: string, name: string) {
  return {
    id,
    name,
    sources: [],
    threads: [],
    defaultExecutionOptions: null,
  };
}

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  setRootComposeProjectId: vi.fn(),
  rootComposeProjectId: "proj_bravo",
  openCreateDialog: vi.fn(),
  isAvailable: true,
  isCreating: false,
  navigation: {
    sections: [],
    projects: [
      makeProject("proj_alpha", "Alpha Web"),
      makeProject("proj_bravo", "Bravo API"),
      makeProject("proj_charlie", "Charlie Docs"),
    ],
    personalProject: makeProject("personal", "Personal"),
  },
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock("@/hooks/queries/sidebar-navigation-query", () => ({
  useSidebarNavigation: () => ({ data: mocks.navigation }),
}));

vi.mock("@/lib/root-compose-selection", () => ({
  useRootComposeProjectId: () => [mocks.rootComposeProjectId],
  useSetRootComposeProjectId: () => mocks.setRootComposeProjectId,
}));

vi.mock("@/hooks/useQuickCreateProject", () => ({
  useQuickCreateProjectController: () => ({
    isAvailable: mocks.isAvailable,
    isCreating: mocks.isCreating,
    openCreateDialog: mocks.openCreateDialog,
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.rootComposeProjectId = "proj_bravo";
  mocks.isAvailable = true;
  mocks.isCreating = false;
});

describe("ProjectSwitcherMenu", () => {
  it("lists projects and marks the current root compose project", () => {
    render(<ProjectSwitcherMenu defaultOpen modal={false} />);

    expect(
      screen.getByRole("button", { name: "Bravo API" }),
    ).toBeTruthy();
    expect(screen.getByRole("option", { name: "Alpha Web" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Bravo API" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Charlie Docs" })).toBeTruthy();
    expect(
      screen
        .getByRole("option", { name: "Bravo API" })
        .getAttribute("aria-current"),
    ).toBe("true");
    expect(
      screen
        .getByRole("option", { name: "Alpha Web" })
        .getAttribute("aria-current"),
    ).toBeNull();
  });

  it("falls back to Projects when the current project is unknown", () => {
    mocks.rootComposeProjectId = "proj_missing";
    render(<ProjectSwitcherMenu defaultOpen modal={false} />);

    expect(screen.getByRole("button", { name: "Projects" })).toBeTruthy();
  });

  it("selects a project by setting the root compose project and navigating", () => {
    const onNavigate = vi.fn();
    render(<ProjectSwitcherMenu onNavigate={onNavigate} defaultOpen modal={false} />);

    fireEvent.click(screen.getByRole("option", { name: "Alpha Web" }));

    expect(mocks.setRootComposeProjectId).toHaveBeenCalledWith("proj_alpha");
    expect(mocks.navigate).toHaveBeenCalledWith(getRootComposeRoutePath(), {
      state: { focusPrompt: true },
    });
    expect(onNavigate).toHaveBeenCalledOnce();
  });

  it("opens the create dialog from the New project row", () => {
    render(<ProjectSwitcherMenu defaultOpen modal={false} />);

    fireEvent.click(screen.getByRole("option", { name: "New project" }));

    expect(mocks.openCreateDialog).toHaveBeenCalledOnce();
  });

  it("disables New project while creation is unavailable and labels it while creating", () => {
    mocks.isAvailable = false;
    const { rerender } = render(
      <ProjectSwitcherMenu defaultOpen modal={false} />,
    );

    expect(
      screen.getByRole("option", { name: "New project" }).getAttribute("aria-disabled"),
    ).toBe("true");

    mocks.isAvailable = true;
    mocks.isCreating = true;
    rerender(<ProjectSwitcherMenu defaultOpen modal={false} />);

    expect(
      screen.getByRole("option", { name: "Creating..." }),
    ).toBeTruthy();
  });
});
