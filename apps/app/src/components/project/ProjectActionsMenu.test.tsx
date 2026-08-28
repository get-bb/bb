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
import { MemoryRouter } from "react-router-dom";
import { Provider as JotaiProvider } from "jotai";
import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import * as localPathPicker from "@/hooks/useLocalPathPicker";
import { ProjectActionsProvider } from "./ProjectActionsProvider";
import { ProjectActionsMenu } from "./ProjectActionsMenu";

interface TestPathPickerHost {
  value: { hostId: string | null; hostName: string | null };
}

const mockPathPickerHost: TestPathPickerHost = {
  value: { hostId: null, hostName: null },
};
const mockLocalPathPicker = {
  isAvailable: false,
  hostId: null,
  hostName: null,
  openPathEntry: vi.fn(),
  openPicker: vi.fn(),
  platform: null,
  projectPathDialog: {
    isOpen: false,
    onClose: vi.fn(),
    onOpen: vi.fn(),
    onOpenChange: vi.fn(),
    setTarget: vi.fn(),
    target: null,
  },
  submitProjectPath: vi.fn(),
};

vi.spyOn(localPathPicker, "usePathPickerHost").mockImplementation(() => ({
  canUseNativeFolderPicker: false,
  clientHostId: null,
  ...mockPathPickerHost.value,
}));
vi.spyOn(localPathPicker, "useLocalPathPicker").mockReturnValue(
  mockLocalPathPicker,
);

function makeProject(): ProjectResponse {
  return {
    id: "proj_test",
    kind: "standard",
    name: "Test project",
    gitRemoteUrl: null,
    sources: [],
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("ProjectActionsMenu", () => {
  const { queryClient } = createQueryClientTestHarness();

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    mockPathPickerHost.value = { hostId: null, hostName: null };
  });

  it("closes after selecting an action", async () => {
    const project = makeProject();

    render(
      <MemoryRouter>
        <JotaiProvider>
          <QueryClientProvider client={queryClient}>
            <ProjectActionsProvider>
              <ProjectActionsMenu project={project} />
            </ProjectActionsProvider>
          </QueryClientProvider>
        </JotaiProvider>
      </MemoryRouter>,
    );

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Test project actions" }),
      { button: 0 },
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Rename" }));

    await waitFor(() => {
      expect(screen.queryByRole("menuitem", { name: "Rename" })).toBeNull();
    });
  });
});
