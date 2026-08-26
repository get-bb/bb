// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { HostPlatform } from "@bb/host-daemon-contract";
import type { HostResponse } from "@bb/server-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocalPathPicker } from "./useLocalPathPicker";

const mocks = vi.hoisted(() => ({
  hosts: undefined as HostResponse[] | undefined,
  isLoadingHosts: false,
  localDaemonHostId: "host_atum" as string | null,
  localDaemonPlatform: "darwin" as const,
  pickFolder: vi.fn(),
  primaryHost: null as HostResponse | null,
  supportsNativeFolderPicker: true,
}));

vi.mock("@/hooks/useHostDaemon", () => ({
  useHostDaemon: () => ({
    localDaemonHostId: mocks.localDaemonHostId,
    localHostId: mocks.localDaemonHostId,
    hasDaemon: true,
    supportsNativeFolderPicker: mocks.supportsNativeFolderPicker,
    platform: mocks.localDaemonPlatform,
    isLocalDaemonHost: (hostId: string | null) =>
      hostId === mocks.localDaemonHostId,
  }),
}));

vi.mock("@/hooks/queries/host-queries", () => ({
  useHosts: () => ({ data: mocks.hosts, isPending: mocks.isLoadingHosts }),
  usePrimaryHost: () => mocks.primaryHost,
}));

vi.mock("@/lib/sdk", () => ({
  sdk: { hosts: { pickFolder: mocks.pickFolder } },
}));

const atum: HostResponse = {
  id: "host_atum",
  name: "atum",
  type: "persistent",
  status: "connected",
  connectedRuntime: { platform: "darwin" },
  lastSeenAt: null,
  maxPermissionMode: "full",
  lastRejectedProtocolVersion: null,
  createdAt: 0,
  updatedAt: 0,
};

function host(
  id: string,
  name: string,
  status: HostResponse["status"] = "connected",
  platform: HostPlatform = "linux",
): HostResponse {
  const fields = { ...atum, id, name };
  return status === "connected"
    ? { ...fields, status, connectedRuntime: { platform } }
    : { ...fields, status, connectedRuntime: null };
}

beforeEach(() => {
  mocks.primaryHost = atum;
  mocks.localDaemonHostId = atum.id;
  mocks.supportsNativeFolderPicker = true;
  mocks.hosts = [atum];
  mocks.isLoadingHosts = false;
  mocks.pickFolder.mockResolvedValue({ path: "/home/me/repo" });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useLocalPathPicker", () => {
  it("reports the selected work host platform instead of the Mac browser platform", () => {
    mocks.primaryHost = host("host_wsl", "WSL dev", "connected", "wsl");

    const { result } = renderHook(() =>
      useLocalPathPicker({ isPending: false, submit: vi.fn() }),
    );

    expect(result.current.platform).toBe("wsl");
    expect(result.current.nativeFolderPicker?.hostId).toBe("host_atum");
  });

  it("does not offer the Mac native picker for a selected Linux host", () => {
    const linuxHost = host("host_linux", "Linux dev");
    mocks.primaryHost = linuxHost;
    mocks.hosts = [atum, linuxHost];
    const { result } = renderHook(() =>
      useLocalPathPicker({ isPending: false, submit: vi.fn() }),
    );

    act(() => result.current.openPicker({ kind: "create" }));

    expect(result.current.platform).toBe("linux");
    expect(result.current.projectPathDialog.isOpen).toBe(true);
    expect(mocks.pickFolder).not.toHaveBeenCalled();
  });

  // The dialog reports the machine it actually resolved a path on. An explicit
  // null means "no machine selected" and must not silently fall back to the
  // primary host — the create would land on the wrong machine.
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
      expect(mocks.pickFolder).toHaveBeenCalledWith({
        hostId: "host_atum",
        clientHostId: "host_atum",
      });
      expect(submit).toHaveBeenCalledWith(
        expect.objectContaining({ hostId: "host_atum", path: "/home/me/repo" }),
      );
    });
  });
});

/**
 * Choosing between the native folder picker and the in-app dialog. This lived
 * in `useQuickCreateProject` until a second caller needed the same behavior; it
 * is shared here so every path-entry caller agrees.
 */
describe("useLocalPathPicker openPathEntry", () => {
  it("opens the dialog instead of the native picker when several machines exist", () => {
    mocks.hosts = [atum, host("host_thoth", "Thoth")];
    const { result } = renderHook(() =>
      useLocalPathPicker({ isPending: false, submit: vi.fn() }),
    );

    act(() => result.current.openPathEntry({ kind: "create" }));

    expect(result.current.projectPathDialog.isOpen).toBe(true);
    expect(mocks.pickFolder).not.toHaveBeenCalled();
  });

  it("uses the native picker with one machine", () => {
    const { result } = renderHook(() =>
      useLocalPathPicker({ isPending: false, submit: vi.fn() }),
    );

    act(() => result.current.openPathEntry({ kind: "create" }));

    expect(mocks.pickFolder).toHaveBeenCalled();
    expect(result.current.projectPathDialog.isOpen).toBe(false);
  });

  it("keeps the native picker when the only other machine is offline", () => {
    mocks.hosts = [atum, host("host_dead", "Old laptop", "disconnected")];
    const { result } = renderHook(() =>
      useLocalPathPicker({ isPending: false, submit: vi.fn() }),
    );

    act(() => result.current.openPathEntry({ kind: "create" }));

    expect(mocks.pickFolder).toHaveBeenCalled();
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
    expect(mocks.pickFolder).not.toHaveBeenCalled();
  });
});
