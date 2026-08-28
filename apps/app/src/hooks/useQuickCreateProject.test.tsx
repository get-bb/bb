// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import type { Host } from "@bb/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as localPathPicker from "@/hooks/useLocalPathPicker";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { hostsQueryKey } from "@/hooks/queries/query-keys";
import { useQuickCreateProject } from "./useQuickCreateProject";

const mocks = {
  openPathEntry: vi.fn(),
};

const pathPickerController = {
  isAvailable: true,
  hostId: "host_atum",
  hostName: "atum",
  openPathEntry: mocks.openPathEntry,
  openPicker: vi.fn(),
  platform: "linux" as const,
  projectPathDialog: {
    isOpen: false,
    onClose: vi.fn(),
    onOpen: vi.fn(),
    onOpenChange: vi.fn(),
    setTarget: vi.fn(),
    target: null,
  },
  submitProjectPath: vi.fn(),
} satisfies ReturnType<typeof localPathPicker.useLocalPathPicker>;

const pathPickerSpy = vi
  .spyOn(localPathPicker, "useLocalPathPicker")
  .mockReturnValue(pathPickerController);

function host(
  id: string,
  name: string,
  status: Host["status"] = "connected",
): Host {
  return {
    id,
    name,
    type: "persistent",
    status,
    lastSeenAt: null,
    maxPermissionMode: "full",
    lastRejectedProtocolVersion: null,
    createdAt: 0,
    updatedAt: 0,
  };
}

beforeEach(() => {
  pathPickerSpy.mockReturnValue(pathPickerController);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useQuickCreateProject", () => {
  it("delegates opening to the shared path-entry surface", () => {
    const { queryClient, wrapper: queryWrapper } =
      createQueryClientTestHarness();
    queryClient.setQueryData(hostsQueryKey(), [host("host_atum", "atum")]);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={["/"]}>
        {queryWrapper({ children })}
      </MemoryRouter>
    );
    const { result } = renderHook(() => useQuickCreateProject(), { wrapper });

    act(() => result.current.openCreateDialog());

    expect(mocks.openPathEntry).toHaveBeenCalledWith({ kind: "create" });
  });

  it("exposes the machine list for the dialog's picker", () => {
    const { queryClient, wrapper: queryWrapper } =
      createQueryClientTestHarness();
    queryClient.setQueryData(hostsQueryKey(), [
      host("host_atum", "atum"),
      host("host_thoth", "Thoth"),
    ]);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={["/"]}>
        {queryWrapper({ children })}
      </MemoryRouter>
    );
    const { result } = renderHook(() => useQuickCreateProject(), { wrapper });

    expect(result.current.hosts.map((item) => item.id)).toEqual([
      "host_atum",
      "host_thoth",
    ]);
  });
});
