// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ProjectResponse } from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ProjectRow } from "./ProjectRow";

vi.mock("@/hooks/useLocalPathPicker", () => ({
  usePathPickerHost: () => ({ hostId: null, hostName: null }),
}));

vi.mock("@/hooks/usePromptDraftStorage", () => ({
  usePromptDraftHasInput: () => false,
}));

vi.mock("@/components/project/ProjectActionsProvider", () => ({
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

function renderProjectRow(onToggleProjectCollapsed = vi.fn()) {
  render(
    <MemoryRouter>
      <ProjectRow
        project={makeProject()}
        threadListState={{ status: "ready", threads: [] }}
        isActive={false}
        isCollapsed={false}
        compareThreads={() => 0}
        collapsedThreadIds={new Set()}
        collapsedEnvironmentIds={new Set()}
        isLocalPathInvalid={false}
        onToggleProjectCollapsed={onToggleProjectCollapsed}
        onToggleThreadCollapsed={vi.fn()}
        onToggleEnvironmentCollapsed={vi.fn()}
      />
    </MemoryRouter>,
  );
  return { onToggleProjectCollapsed };
}

describe("ProjectRow interactions", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("does not toggle collapse when the project row is clicked", () => {
    const { onToggleProjectCollapsed } = renderProjectRow();

    fireEvent.click(screen.getByText("Test project"));

    expect(onToggleProjectCollapsed).not.toHaveBeenCalled();
  });

  it("toggles collapse when the project chevron is clicked", () => {
    const { onToggleProjectCollapsed } = renderProjectRow();

    fireEvent.click(
      screen.getByRole("button", { name: "Collapse Test project" }),
    );

    expect(onToggleProjectCollapsed).toHaveBeenCalledWith("proj_test");
  });
});
