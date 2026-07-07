// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ProjectResponse } from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { ProjectActionsMenu } from "./ProjectActionsMenu";

const mockPathPickerHost = vi.hoisted(() => ({
  value: { hostId: null as string | null, hostName: null as string | null },
}));

const mockProjectActions = vi.hoisted(() => ({
  requestRename: vi.fn(),
  requestDelete: vi.fn(),
  requestAddLocalPath: vi.fn(),
}));

vi.mock("@/hooks/useLocalPathPicker", () => ({
  usePathPickerHost: () => mockPathPickerHost.value,
}));

vi.mock("./ProjectActionsProvider", () => ({
  useProjectActions: () => mockProjectActions,
}));

function makeProject(): ProjectResponse {
  return {
    id: "proj_test",
    kind: "standard",
    name: "Test project",
    sources: [],
    createdAt: 0,
    updatedAt: 0,
  };
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function expectMenuItemIcon(label: string, iconName: string) {
  const menuItem = screen.getByRole("menuitem", { name: label });
  expect(menuItem.querySelector(`[data-icon="${iconName}"]`)).not.toBeNull();
}

describe("ProjectActionsMenu", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    mockPathPickerHost.value = { hostId: null, hostName: null };
  });

  it("does not bubble archived-thread selection to the project row", async () => {
    const onProjectRowClick = vi.fn();

    render(
      <MemoryRouter initialEntries={["/projects/proj_test"]}>
        <CompactViewportOverrideProvider isCompactViewport={true}>
          <div onClick={onProjectRowClick}>
            <ProjectActionsMenu project={makeProject()} />
          </div>
          <LocationProbe />
        </CompactViewportOverrideProvider>
      </MemoryRouter>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Test project actions" }),
    );
    fireEvent.click(await screen.findByRole("menuitem", {
      name: "Archived threads",
    }));

    expect(onProjectRowClick).not.toHaveBeenCalled();
    expect(screen.getByTestId("location").textContent).toBe(
      "/projects/proj_test/archived",
    );
  });

  it.each([
    {
      label: "Rename",
      action: mockProjectActions.requestRename,
      hostId: null,
    },
    {
      label: "Add local path",
      action: mockProjectActions.requestAddLocalPath,
      hostId: "host_test",
    },
    {
      label: "Remove",
      action: mockProjectActions.requestDelete,
      hostId: null,
    },
  ])("closes after selecting $label", async ({ label, action, hostId }) => {
    mockPathPickerHost.value = { hostId, hostName: null };
    const project = makeProject();

    render(
      <MemoryRouter>
        <ProjectActionsMenu project={project} />
      </MemoryRouter>,
    );

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Test project actions" }),
      { button: 0 },
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: label }));

    expect(action).toHaveBeenCalledWith(project);
    await waitFor(() => {
      expect(screen.queryByRole("menuitem", { name: label })).toBeNull();
    });
  });

  it("renders icons for project action menu items", async () => {
    const project = makeProject();

    render(
      <MemoryRouter>
        <ProjectActionsMenu project={project} />
      </MemoryRouter>,
    );

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Test project actions" }),
      { button: 0 },
    );

    await screen.findByRole("menuitem", { name: "Project settings" });

    expectMenuItemIcon("Project settings", "Settings");
    expectMenuItemIcon("Archived threads", "Archive");
    expectMenuItemIcon("Rename", "Edit");
    expectMenuItemIcon("Remove", "Trash2");
  });
});
