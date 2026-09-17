// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import type { Host } from "@bb/domain";
import { makeHost } from "@bb/test-helpers/domain-fixtures";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalPathSubmitParams } from "./useLocalPathPicker";
import { useQuickCreateProject } from "./useQuickCreateProject";

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
  capturedSubmit: null as ((params: LocalPathSubmitParams) => void) | null,
}));

vi.mock("react-router-dom", () => ({
  useLocation: () => ({ pathname: "/" }),
  useNavigate: () => mocks.navigate,
}));

vi.mock("@/hooks/mutations/project-mutations", () => ({
  useCreateProject: () => ({ isPending: false, mutate: mocks.mutate }),
}));

vi.mock("@/hooks/queries/host-queries", () => ({
  useHosts: () => ({ data: mocks.hosts, isPending: mocks.isLoadingHosts }),
}));

vi.mock("@/hooks/useLocalPathPicker", () => ({
  useLocalPathPicker: (options: {
    submit: (params: LocalPathSubmitParams) => void;
  }) => {
    mocks.capturedSubmit = options.submit;
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

function stageCreate(path = "/home/deploy/repos/givecare") {
  const closeDialog = vi.fn();
  act(() => {
    mocks.capturedSubmit?.({
      path,
      hostId: "host_atum",
      target: { kind: "create" },
      closeDialog,
    });
  });
  return closeDialog;
}

beforeEach(() => {
  mocks.hosts = [host("host_atum", "atum")];
  mocks.isLoadingHosts = false;
  mocks.capturedSubmit = null;
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

  it("stages a picked folder into the details dialog instead of creating", () => {
    const { result } = renderHook(() => useQuickCreateProject());
    expect(mocks.capturedSubmit).not.toBeNull();

    const closeDialog = stageCreate();

    expect(closeDialog).toHaveBeenCalled();
    expect(result.current.createDetails.target).toEqual({
      path: "/home/deploy/repos/givecare",
      hostId: "host_atum",
      suggestedName: "givecare",
    });
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("stages an empty suggested name and lets the dialog block confirm", () => {
    const { result } = renderHook(() => useQuickCreateProject());

    stageCreate("/");

    expect(result.current.createDetails.target).toEqual({
      path: "/",
      hostId: "host_atum",
      suggestedName: "",
    });
  });

  it("confirms with the edited name and navigates on success", () => {
    const { result } = renderHook(() => useQuickCreateProject());

    stageCreate();

    act(() => result.current.confirmCreateDetails("  My Project  "));

    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(mocks.mutate.mock.calls[0][0]).toEqual({
      name: "My Project",
      source: {
        type: "local_path",
        hostId: "host_atum",
        path: "/home/deploy/repos/givecare",
      },
    });

    const onSuccess = mocks.mutate.mock.calls[0][1].onSuccess;
    act(() => onSuccess({ id: "project_1" }));

    expect(result.current.createDetails.target).toBeNull();
    expect(mocks.setRootComposeProjectId).toHaveBeenCalledWith("project_1");
    expect(mocks.navigate).toHaveBeenCalled();
  });

  it("cancels the staged details without creating", () => {
    const { result } = renderHook(() => useQuickCreateProject());

    stageCreate();
    expect(result.current.createDetails.target).not.toBeNull();

    act(() => result.current.cancelCreateDetails());

    expect(result.current.createDetails.target).toBeNull();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
});
