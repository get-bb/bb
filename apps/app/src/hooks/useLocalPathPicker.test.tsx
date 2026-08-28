// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { Host } from "@bb/domain";
import * as HostDaemonModule from "@/hooks/useHostDaemon";
import * as HostQueriesModule from "@/hooks/queries/host-queries";
import { sdk } from "@/lib/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocalPathPicker } from "./useLocalPathPicker";

const mocks = {
  hosts:
    /* SAFETY: The test controls this fixture and verifies its behavior. */ undefined as
      | Host[]
      | undefined,
  isLoadingHosts: false,
  primaryHost:
    /* SAFETY: The test controls this fixture and verifies its behavior. */ null as Host | null,
  supportsNativeFolderPicker: true,
};

vi.spyOn(HostDaemonModule, "useHostDaemon").mockImplementation(() => ({
  localDaemonHostId: "host_atum",
  localHostId: "host_atum",
  hasDaemon: true,
  supportsNativeFolderPicker: mocks.supportsNativeFolderPicker,
  platform: "linux",
  isLocalDaemonHost: (hostId: string | null | undefined) =>
    hostId === "host_atum",
}));

/* SAFETY: This fake returns only the query fields that the hook reads. */
vi.spyOn(HostQueriesModule, "useHosts").mockImplementation(
  () =>
    ({
      data: mocks.hosts,
      isPending: mocks.isLoadingHosts,
    }) as ReturnType<typeof HostQueriesModule.useHosts>,
);
vi.spyOn(HostQueriesModule, "usePrimaryHost").mockImplementation(
  () => mocks.primaryHost,
);

const pickFolderMock = vi.spyOn(sdk.hosts, "pickFolder");

const atum: Host = {
  id: "host_atum",
  name: "atum",
  type: "persistent",
  status: "connected",
  lastSeenAt: null,
  maxPermissionMode: "full",
  lastRejectedProtocolVersion: null,
  createdAt: 0,
  updatedAt: 0,
};

function host(
  id: string,
  name: string,
  status: Host["status"] = "connected",
): Host {
  return { ...atum, id, name, status };
}

beforeEach(() => {
  mocks.primaryHost = atum;
  mocks.supportsNativeFolderPicker = true;
  mocks.hosts = [atum];
  mocks.isLoadingHosts = false;
  pickFolderMock.mockResolvedValue({ path: "/home/me/repo" });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useLocalPathPicker", () => {
  it("drops a submit that carries no machine", () => {
    const submit = vi.fn();
    const { result } = renderHook(() =>
      useLocalPathPicker({ isPending: false, submit }),
    );

    act(() => {
      result.current.submitProjectPath({ kind: "create" }, "/srv/thing", null);
    });

    expect(submit).not.toHaveBeenCalled();
  });

  it("submits on the machine the dialog reports", () => {
    const submit = vi.fn();
    const { result } = renderHook(() =>
      useLocalPathPicker({ isPending: false, submit }),
    );

    act(() => {
      result.current.submitProjectPath(
        { kind: "create" },
        "/srv/thing",
        "host_kunst",
      );
    });

    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ hostId: "host_kunst", path: "/srv/thing" }),
    );
  });

  it("still submits on the primary host after the native folder picker", async () => {
    const submit = vi.fn();
    const { result } = renderHook(() =>
      useLocalPathPicker({ isPending: false, submit }),
    );

    act(() => {
      result.current.openPicker({ kind: "create" });
    });

    await waitFor(() => {
      expect(submit).toHaveBeenCalledWith(
        expect.objectContaining({ hostId: "host_atum", path: "/home/me/repo" }),
      );
    });
  });
});

describe("useLocalPathPicker openPathEntry", () => {
  it("opens the dialog instead of the native picker when several machines exist", () => {
    mocks.hosts = [atum, host("host_thoth", "Thoth")];
    const { result } = renderHook(() =>
      useLocalPathPicker({ isPending: false, submit: vi.fn() }),
    );

    act(() => result.current.openPathEntry({ kind: "create" }));

    expect(result.current.projectPathDialog.isOpen).toBe(true);
    expect(pickFolderMock).not.toHaveBeenCalled();
  });

  it("uses the native picker with one machine", () => {
    const { result } = renderHook(() =>
      useLocalPathPicker({ isPending: false, submit: vi.fn() }),
    );

    act(() => result.current.openPathEntry({ kind: "create" }));

    expect(pickFolderMock).toHaveBeenCalled();
    expect(result.current.projectPathDialog.isOpen).toBe(false);
  });

  it("keeps the native picker when the only other machine is offline", () => {
    mocks.hosts = [atum, host("host_dead", "Old laptop", "disconnected")];
    const { result } = renderHook(() =>
      useLocalPathPicker({ isPending: false, submit: vi.fn() }),
    );

    act(() => result.current.openPathEntry({ kind: "create" }));

    expect(pickFolderMock).toHaveBeenCalled();
    expect(result.current.projectPathDialog.isOpen).toBe(false);
  });

  it("opens the dialog while the machine list is still loading", () => {
    mocks.hosts = undefined;
    mocks.isLoadingHosts = true;
    const { result } = renderHook(() =>
      useLocalPathPicker({ isPending: false, submit: vi.fn() }),
    );

    act(() => result.current.openPathEntry({ kind: "create" }));

    expect(result.current.projectPathDialog.isOpen).toBe(true);
    expect(pickFolderMock).not.toHaveBeenCalled();
  });
});
