// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectsSettingsSection } from "./ProjectsSettingsSection";

function makeProject(
  id: string,
  name: string,
  options?: {
    sources?: ReadonlyArray<{
      id: string;
      projectId: string;
      isDefault: boolean;
      path: string;
      hostId: string;
    }>;
    gitRemoteUrl?: string | null;
  },
) {
  return {
    id,
    kind: "standard",
    name,
    gitRemoteUrl: options?.gitRemoteUrl ?? null,
    createdAt: 0,
    updatedAt: 0,
    sources: (options?.sources ?? []).map((source) => ({
      ...source,
      type: "local_path",
      createdAt: 0,
      updatedAt: 0,
    })),
    threads: [],
    defaultExecutionOptions: null,
  };
}

const mocks = vi.hoisted(() => ({
  navigation: {
    sections: [],
    projects: [
      makeProject("proj_alpha", "Alpha Web", {
        sources: [
          {
            id: "src_alpha",
            projectId: "proj_alpha",
            isDefault: true,
            path: "/work/alpha",
            hostId: "host_1",
          },
        ],
      }),
      makeProject("proj_bravo", "Bravo API", {
        gitRemoteUrl: "git@github.com:acme/bravo.git",
      }),
      makeProject("proj_charlie", "Charlie Docs"),
    ],
    personalProject: makeProject("personal", "Personal"),
  } as { sections: unknown[]; projects: unknown[]; personalProject: unknown },
  requestRename: vi.fn(),
  requestDelete: vi.fn(),
  openCreateDialog: vi.fn(),
  isAvailable: true,
  isCreating: false,
}));

vi.mock("@/hooks/queries/sidebar-navigation-query", () => ({
  useSidebarNavigation: () => ({ data: mocks.navigation }),
}));

vi.mock("@/components/project/ProjectActionsProvider", () => ({
  useProjectActions: () => ({
    requestRename: mocks.requestRename,
    requestDelete: mocks.requestDelete,
  }),
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
  mocks.isAvailable = true;
  mocks.isCreating = false;
  mocks.navigation = {
    sections: [],
    projects: [
      makeProject("proj_alpha", "Alpha Web", {
        sources: [
          {
            id: "src_alpha",
            projectId: "proj_alpha",
            isDefault: true,
            path: "/work/alpha",
            hostId: "host_1",
          },
        ],
      }),
      makeProject("proj_bravo", "Bravo API", {
        gitRemoteUrl: "git@github.com:acme/bravo.git",
      }),
      makeProject("proj_charlie", "Charlie Docs"),
    ],
    personalProject: makeProject("personal", "Personal"),
  };
});

describe("ProjectsSettingsSection", () => {
  it("renders a row per project with path, remote, and em-dash fallbacks", () => {
    render(<ProjectsSettingsSection />);

    expect(screen.getByText("Alpha Web")).toBeTruthy();
    expect(screen.getByText("/work/alpha")).toBeTruthy();
    expect(screen.getByText("Bravo API")).toBeTruthy();
    expect(
      screen.getByText("git@github.com:acme/bravo.git"),
    ).toBeTruthy();
    expect(screen.getByText("Charlie Docs")).toBeTruthy();
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Rename" })).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: "Delete" })).toHaveLength(3);
  });

  it("dispatches rename and delete through useProjectActions", () => {
    render(<ProjectsSettingsSection />);

    const renameButtons = screen.getAllByRole("button", { name: "Rename" });
    const deleteButtons = screen.getAllByRole("button", { name: "Delete" });
    fireEvent.click(renameButtons[0]!);
    fireEvent.click(deleteButtons[1]!);

    expect(mocks.requestRename).toHaveBeenCalledOnce();
    expect(mocks.requestRename.mock.calls[0]![0]).toMatchObject({
      id: "proj_alpha",
    });
    expect(mocks.requestDelete).toHaveBeenCalledOnce();
    expect(mocks.requestDelete.mock.calls[0]![0]).toMatchObject({
      id: "proj_bravo",
    });
  });

  it("opens the create dialog from the New project button", () => {
    render(<ProjectsSettingsSection />);

    fireEvent.click(screen.getByRole("button", { name: "New project" }));

    expect(mocks.openCreateDialog).toHaveBeenCalledOnce();
  });

  it("disables New project when unavailable and labels it while creating", () => {
    mocks.isAvailable = false;
    const { rerender } = render(<ProjectsSettingsSection />);
    expect(
      screen.getByRole("button", { name: "New project" }).hasAttribute("disabled"),
    ).toBe(true);

    mocks.isAvailable = true;
    mocks.isCreating = true;
    rerender(<ProjectsSettingsSection />);
    const creatingButton = screen.getByRole("button", { name: "Creating..." });
    expect(creatingButton.hasAttribute("disabled")).toBe(true);
  });

  it("shows loading and empty states", () => {
    mocks.navigation = undefined as never;
    const { unmount } = render(<ProjectsSettingsSection />);
    expect(screen.getByText("Loading…")).toBeTruthy();
    unmount();
    cleanup();

    mocks.navigation = {
      sections: [],
      projects: [],
      personalProject: makeProject("personal", "Personal"),
    };
    render(<ProjectsSettingsSection />);
    expect(screen.getByText("No projects yet.")).toBeTruthy();
  });
});
