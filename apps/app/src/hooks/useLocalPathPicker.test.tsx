// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { Host } from "@bb/domain";
import { makeHost } from "@bb/test-helpers/domain-fixtures";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocalPathPicker } from "./useLocalPathPicker";

const mocks = vi.hoisted(() => ({
  hosts: undefined as Host[] | undefined,
  isLoadingHosts: false,
  localDaemonHostId: "host_atum" as string | null,
  pickFolder: vi.fn(),
  primaryHost: null as Host | null,
  supportsNativeFolderPicker: true,
}));

vi.mock("@/hooks/useHostDaemon", () => ({
  useHostDaemon: () => ({
    localDaemonHostId: mocks.localDaemonHostId,
    localHostId: "host_atum",
    hasDaemon: true,
    supportsNativeFolderPicker: mocks.supportsNativeFolderPicker,
    platform: "linux",
    isLocalDaemonHost: (hostId: string | null) => hostId === "host_atum",
  }),
}));

vi.mock("@/hooks/queries/host-queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/queries/host-queries")>()),
  useHosts: () => ({ data: mocks.hosts, isPending: mocks.isLoadingHosts }),
  usePrimaryHost: () => mocks.primaryHost,
}));

vi.mock("@/lib/sdk", () => ({
  sdk: { hosts: { pickFolder: mocks.pickFolder } },
}));

const atum = makeHost({
  id: "host_atum",
  name: "atum",
});

const kunst = makeHost({
  id: "host_kunst",
  name: "kunst",
});

beforeEach(() => {
  mocks.localDaemonHostId = atum.id;
  mocks.primaryHost = atum;
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
  it.each([
    {
      scenario: "prefers the enrolled client over a connected remote primary",
      localDaemonHostId: atum.id,
      primaryHost: kunst,
      hosts: [atum, kunst],
      expectedHost: atum,
    },
    {
      scenario: "uses the primary when no local daemon is available",
      localDaemonHostId: null,
      primaryHost: kunst,
      hosts: [kunst],
      expectedHost: kunst,
    },
    {
      scenario: "does not prefer a daemon absent from the enrolled hosts",
      localDaemonHostId: atum.id,
      primaryHost: kunst,
      hosts: [kunst],
      expectedHost: kunst,
    },
    {
      scenario: "does not prefer an offline client over the connected primary",
      localDaemonHostId: atum.id,
      primaryHost: kunst,
      hosts: [{ ...atum, status: "disconnected" as const }, kunst],
      expectedHost: kunst,
    },
    {
      scenario: "uses the client while the primary is offline",
      localDaemonHostId: atum.id,
      primaryHost: { ...kunst, status: "disconnected" as const },
      hosts: [atum, { ...kunst, status: "disconnected" as const }],
      expectedHost: atum,
    },
    {
      scenario: "uses the shared host for a local server connection",
      localDaemonHostId: atum.id,
      primaryHost: atum,
      hosts: [atum],
      expectedHost: atum,
    },
  ])("$scenario", ({ localDaemonHostId, primaryHost, hosts, expectedHost }) => {
    mocks.localDaemonHostId = localDaemonHostId;
    mocks.primaryHost = primaryHost;
    mocks.hosts = hosts;
    const { result } = renderHook(() =>
      useLocalPathPicker({ isPending: false, submit: vi.fn() }),
    );

    expect(result.current.hostId).toBe(expectedHost.id);
    expect(result.current.hostName).toBe(expectedHost.name);
  });

  it("opens the native picker and submits on the client with a remote primary", async () => {
    mocks.primaryHost = kunst;
    mocks.hosts = [atum, kunst];
    const submit = vi.fn();
    const { result } = renderHook(() =>
      useLocalPathPicker({ isPending: false, submit }),
    );

    act(() => {
      result.current.openPicker({
        kind: "update",
        projectId: "project_test",
        projectName: "Test project",
        currentPath: "/old/repo",
        hostId: atum.id,
        hostName: atum.name,
      });
    });

    expect(mocks.pickFolder).toHaveBeenCalledWith({
      hostId: atum.id,
      clientHostId: atum.id,
    });
    await waitFor(() => {
      expect(submit).toHaveBeenCalledWith(
        expect.objectContaining({ hostId: atum.id, path: "/home/me/repo" }),
      );
    });
  });

  it("browses another machine's checkout instead of opening the native picker", () => {
    mocks.hosts = [atum, kunst];
    const target = {
      kind: "update" as const,
      projectId: "project_test",
      projectName: "Test project",
      currentPath: "/srv/repo",
      hostId: kunst.id,
      hostName: kunst.name,
    };
    const { result } = renderHook(() =>
      useLocalPathPicker({ isPending: false, submit: vi.fn() }),
    );

    act(() => {
      result.current.openPicker(target);
    });

    expect(mocks.pickFolder).not.toHaveBeenCalled();
    expect(result.current.projectPathDialog.target).toBe(target);
  });

  it("keeps manual path entry on the client when native picking is unavailable", () => {
    mocks.primaryHost = kunst;
    mocks.hosts = [atum, kunst];
    mocks.supportsNativeFolderPicker = false;
    const { result } = renderHook(() =>
      useLocalPathPicker({ isPending: false, submit: vi.fn() }),
    );

    act(() => {
      result.current.openPicker({ kind: "create" });
    });

    expect(result.current.hostId).toBe(atum.id);
    expect(result.current.projectPathDialog.isOpen).toBe(true);
    expect(mocks.pickFolder).not.toHaveBeenCalled();
  });

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
