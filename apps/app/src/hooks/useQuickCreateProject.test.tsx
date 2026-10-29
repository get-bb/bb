// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import type { Host } from "@bb/domain";
import { createDeferredPromise } from "@bb/test-helpers";
import type { LocalPathSubmitParams } from "./useLocalPathPicker";
import { makeHost } from "@bb/test-helpers/domain-fixtures";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useQuickCreateProject } from "./useQuickCreateProject";

const mocks = vi.hoisted(() => ({
  hosts: [] as Host[] | undefined,
  isLoadingHosts: false,
  mutateAsync: vi.fn(),
  navigate: vi.fn(),
  onClose: vi.fn(),
  onOpen: vi.fn(),
  onOpenChange: vi.fn(),
  openPathEntry: vi.fn(),
  openPicker: vi.fn(),
  setRootComposeProjectId: vi.fn(),
}));

vi.mock("react-router-dom", () => ({
  useLocation: () => ({ pathname: "/" }),
  useNavigate: () => mocks.navigate,
}));

vi.mock("@/hooks/mutations/project-mutations", () => ({
  useCreateProject: () => ({
    isPending: false,
    mutateAsync: mocks.mutateAsync,
  }),
}));

vi.mock("@/hooks/queries/host-queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/queries/host-queries")>()),
  useHosts: () => ({ data: mocks.hosts, isPending: mocks.isLoadingHosts }),
}));

vi.mock("@/hooks/useLocalPathPicker", () => ({
  useLocalPathPicker: ({
    submit,
  }: {
    submit: (params: LocalPathSubmitParams) => void;
  }) => ({
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
    submitProjectPath: (
      target: LocalPathSubmitParams["target"],
      path: string,
      hostId: string,
    ) => submit({ target, path, hostId, closeDialog: mocks.onClose }),
  }),
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

  it("exposes every machine for the dialog's picker", () => {
    mocks.hosts = [
      host("host_atum", "atum"),
      host("host_thoth", "Thoth"),
      makeHost({
        id: "host_sandbox",
        name: "Sandbox",
        type: "ephemeral",
        machineProviderId: "modal-sandbox",
      }),
    ];
    const { result } = renderHook(() => useQuickCreateProject());

    expect(result.current.hosts.map((item) => item.id)).toEqual([
      "host_atum",
      "host_thoth",
      "host_sandbox",
    ]);
  });
});

describe("manual folder observation", () => {
  it("waits for the usable project and retains attribution after the observer unmounts", async () => {
    const pending = createDeferredPromise<{ id: string }>();
    mocks.mutateAsync.mockReturnValueOnce(pending.promise);
    const onResult = vi.fn();
    const view = renderHook(() => useQuickCreateProject());
    act(() => view.result.current.openCreateDialogWithResult(onResult));
    act(() =>
      view.result.current.submitProjectPath(
        { kind: "create" },
        "/private/repo",
        "host_atum",
      ),
    );
    expect(onResult).not.toHaveBeenCalled();
    view.unmount();
    await act(async () => pending.resolve({ id: "project_created" }));
    expect(onResult).toHaveBeenCalledExactlyOnceWith("selected");
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("reports real mutation failures but does not infer cancellation from dialog closure", async () => {
    mocks.mutateAsync.mockRejectedValueOnce(new Error("private path"));
    const onResult = vi.fn();
    const view = renderHook(() => useQuickCreateProject());
    act(() => view.result.current.openCreateDialogWithResult(onResult));
    act(() => view.result.current.projectPathDialog.onOpenChange(false));
    expect(onResult).not.toHaveBeenCalled();
    await act(async () =>
      view.result.current.submitProjectPath(
        { kind: "create" },
        "/private/repo",
        "host_atum",
      ),
    );
    expect(onResult).toHaveBeenCalledExactlyOnceWith("failed");
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
