// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import type { Host } from "@bb/domain";
import { makeHost } from "@bb/test-helpers/domain-fixtures";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useQuickCreateProject } from "./useQuickCreateProject";
import type { LocalPathSubmitParams } from "./useLocalPathPicker";

const mocks = vi.hoisted(() => ({
  hosts: [] as Host[] | undefined,
  isLoadingHosts: false,
  mutate: vi.fn(),
  navigate: vi.fn(),
  onClose: vi.fn(),
  onOpen: vi.fn(),
  onOpenChange: vi.fn(),
  openPathEntry: vi.fn(),
  openPicker: vi.fn(),
  setRootComposeProjectId: vi.fn(),
  submit: null as ((params: LocalPathSubmitParams) => void) | null,
}));

vi.mock("react-router-dom", () => ({
  useLocation: () => ({ pathname: "/" }),
  useNavigate: () => mocks.navigate,
}));

vi.mock("@/hooks/mutations/project-mutations", () => ({
  useCreateProject: () => ({ isPending: false, mutate: mocks.mutate }),
}));

vi.mock("@/hooks/queries/host-queries", () => ({
  selectPersistentHosts: (hosts: readonly Host[] | undefined) =>
    hosts ? [...hosts] : [],
  useHosts: () => ({ data: mocks.hosts, isPending: mocks.isLoadingHosts }),
}));

vi.mock("@/hooks/useLocalPathPicker", () => ({
  useLocalPathPicker: ({
    submit,
  }: {
    submit: (params: LocalPathSubmitParams) => void;
  }) => {
    mocks.submit = submit;
    return {
      isAvailable: true,
      hostId: "host_atum",
      hostName: "atum",
      openPathEntry: mocks.openPathEntry,
      openPicker: mocks.openPicker,
      platform: "linux",
      projectPathDialog: {
        isOpen: false,
        onClose: mocks.onClose,
        onOpen: mocks.onOpen,
        onOpenChange: mocks.onOpenChange,
        target: null,
      },
      submitProjectPath: vi.fn(),
    };
  },
}));

vi.mock("@/lib/root-compose-selection", () => ({
  useSetRootComposeProjectId: () => mocks.setRootComposeProjectId,
}));

function host(
  id: string,
  name: string,
  status: Host["status"] = "connected",
): Host {
  return makeHost({
    id,
    name,
    status,
  });
}

beforeEach(() => {
  mocks.hosts = [host("host_atum", "atum")];
  mocks.isLoadingHosts = false;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useQuickCreateProject", () => {
  it("delegates opening to the shared path-entry surface", () => {
    const { result } = renderHook(() => useQuickCreateProject());

    act(() => result.current.openCreateDialog());

    expect(mocks.openPathEntry).toHaveBeenCalledWith({ kind: "create" });
  });

  it("exposes the machine list for the dialog's picker", () => {
    mocks.hosts = [host("host_atum", "atum"), host("host_thoth", "Thoth")];
    const { result } = renderHook(() => useQuickCreateProject());

    expect(result.current.hosts.map((item) => item.id)).toEqual([
      "host_atum",
      "host_thoth",
    ]);
  });

  it("completes project selection without navigating away from the originating draft", async () => {
    const selected = vi.fn();
    const { result } = renderHook(() => useQuickCreateProject());
    act(() => result.current.openCreateDialogForSelection(selected));
    act(() =>
      mocks.submit?.({
        path: "/work/new-project",
        hostId: "host_atum",
        target: { kind: "create" },
        closeDialog: mocks.onClose,
      }),
    );
    const options = mocks.mutate.mock.calls[0][1];
    act(() => result.current.openCreateDialog());
    await act(async () => options.onSuccess({ id: "proj_created" }));
    expect(selected).toHaveBeenCalledWith("proj_created");
    expect(mocks.onClose).toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.setRootComposeProjectId).not.toHaveBeenCalled();
    act(() =>
      mocks.submit?.({
        path: "/work/sidebar-project",
        hostId: "host_atum",
        target: { kind: "create" },
        closeDialog: mocks.onClose,
      }),
    );
    await act(async () =>
      mocks.mutate.mock.calls[1][1].onSuccess({ id: "proj_sidebar" }),
    );
    expect(selected).toHaveBeenCalledTimes(1);
    expect(mocks.setRootComposeProjectId).toHaveBeenCalledWith("proj_sidebar");
    expect(mocks.navigate).toHaveBeenCalledWith("/", { replace: true });
  });
});
