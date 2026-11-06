// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import type { Host } from "@bb/domain";
import { makeHost } from "@bb/test-helpers/domain-fixtures";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useQuickCreateProject } from "./useQuickCreateProject";

const mocks = vi.hoisted(() => ({
  hosts: [] as Host[] | undefined,
  isLoadingHosts: false,
  mutate: vi.fn(),
  pickerOptions: null as unknown,
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
  useCreateProject: () => ({ isPending: false, mutate: mocks.mutate }),
}));

vi.mock("@/hooks/queries/host-queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/queries/host-queries")>()),
  useHosts: () => ({ data: mocks.hosts, isPending: mocks.isLoadingHosts }),
}));

vi.mock("@/hooks/useLocalPathPicker", () => ({
  useLocalPathPicker: (options: unknown) => {
    mocks.pickerOptions = options;
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

function submitArgs() {
  return mocks.pickerOptions as {
    submit: (params: {
      path: string;
      hostId: string;
      target: { kind: "create" };
      closeDialog: () => void;
    }) => void;
  };
}

function mutateCallbacks() {
  return mocks.mutate.mock.lastCall?.[1] as {
    onSuccess: (project: { id: string }) => void;
    onError: (error: unknown) => void;
  };
}

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

  it("reports a create opened with an observer as started, then its outcome", () => {
    const { result } = renderHook(() => useQuickCreateProject());
    const submit = () =>
      submitArgs().submit({
        path: "/home/me/notes",
        hostId: "host_atum",
        target: { kind: "create" },
        closeDialog: vi.fn(),
      });
    const observer = { onStarted: vi.fn(), onSettled: vi.fn() };

    act(() => result.current.openObservedCreateDialog(observer));
    expect(mocks.openPathEntry).toHaveBeenCalledWith({ kind: "create" });
    act(() => submit());
    expect(observer.onStarted).toHaveBeenCalledOnce();
    const failure = new Error("exists");
    act(() => mutateCallbacks().onError(failure));
    expect(observer.onSettled).toHaveBeenLastCalledWith({
      outcome: "failed",
      error: failure,
    });

    act(() => submit());
    act(() => mutateCallbacks().onSuccess({ id: "prj_notes" }));
    expect(observer.onSettled).toHaveBeenLastCalledWith({
      outcome: "succeeded",
    });
    expect(observer.onStarted).toHaveBeenCalledTimes(2);

    act(() => result.current.openCreateDialog());
    act(() => submit());
    expect(observer.onStarted).toHaveBeenCalledTimes(2);
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
