// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ProjectResponse } from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { CompactViewportOverrideProvider } from "@/components/ui/hooks/use-compact-viewport";
import { ProjectActionsMenu } from "./ProjectActionsMenu";

vi.mock("@/hooks/useLocalPathPicker", () => ({
  usePathPickerHost: () => ({ hostId: null, hostName: null }),
}));

vi.mock("./ProjectActionsProvider", () => ({
  useProjectActions: () => ({
    requestRename: vi.fn(),
    requestDelete: vi.fn(),
    requestAddLocalPath: vi.fn(),
  }),
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

describe("ProjectActionsMenu", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
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
});
