// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { Host } from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sdk } from "@/lib/sdk";
import { hostsQueryKey } from "@/hooks/queries/query-keys";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { AddMachineDialog } from "./AddMachineDialog";

vi.mock("@/lib/sdk", () => ({
  BbHttpError: class BbHttpError extends Error {},
  sdk: {
    hosts: {
      createJoinCode: vi.fn(),
      list: vi.fn(),
    },
    plugins: { callRpc: vi.fn() },
  },
}));

vi.mock("@/lib/ws", () => ({
  wsManager: { subscribe: vi.fn(), unsubscribe: vi.fn() },
}));

function host(overrides: Partial<Host> & Pick<Host, "id" | "name">): Host {
  return {
    type: "persistent",
    status: "connected",
    lastSeenAt: null,
    lastRejectedProtocolVersion: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

const existingHost = host({ id: "host_primary", name: "MacBook Pro" });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AddMachineDialog", () => {
  it("mints a join code, shows the pairing command, and detects the new machine connecting", async () => {
    vi.mocked(sdk.hosts.createJoinCode).mockResolvedValue({
      joinCode: "jc_test123",
      hostId: "host_new",
      expiresAt: Date.now() + 15 * 60 * 1000,
    });
    // The connect serverUrl differs from the browser origin (bb viewed on
    // localhost while paired through a tunnel) — the command must use it.
    vi.mocked(sdk.plugins.callRpc).mockResolvedValue({
      code: "mc_test456",
      expiresAt: Date.now() + 10 * 60 * 1000,
      serverUrl: "https://example.getbb.app",
    });
    vi.mocked(sdk.hosts.list).mockResolvedValue([existingHost]);

    const { queryClient, wrapper } = createQueryClientTestHarness();
    render(<AddMachineDialog open onOpenChange={vi.fn()} />, { wrapper });

    const command = await screen.findByText(/--join-code jc_test123/);
    expect(sdk.plugins.callRpc).toHaveBeenCalledWith(
      expect.objectContaining({
        pluginId: "connect",
        method: "createMachineCode",
        input: null,
      }),
    );
    expect(command.textContent).toContain("--host-id host_new");
    expect(command.textContent).toContain(
      "curl -fsSL https://example.getbb.app/install.sh",
    );
    expect(command.textContent).toContain(
      "--server https://example.getbb.app",
    );
    expect(command.textContent).toContain("--machine-code mc_test456");
    expect(command.textContent).not.toContain(window.location.origin);
    expect(screen.getByText(/Code expires in \d+:\d{2}/)).toBeDefined();
    expect(
      screen.getByText("Waiting for the machine to connect…"),
    ).toBeDefined();

    // Baseline host list is loaded before the new machine appears.
    await waitFor(() => {
      expect(queryClient.getQueryData<Host[]>(hostsQueryKey())).toHaveLength(1);
    });

    act(() => {
      queryClient.setQueryData<Host[]>(hostsQueryKey(), [
        existingHost,
        host({ id: "host_new", name: "Mac Studio" }),
      ]);
    });

    expect(await screen.findByText("Mac Studio connected")).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Set up a project on it →" }),
    ).toBeDefined();
    expect(
      screen.queryByText("Waiting for the machine to connect…"),
    ).toBeNull();
  });

  it("ignores hosts that were already known at open time", async () => {
    vi.mocked(sdk.hosts.createJoinCode).mockResolvedValue({
      joinCode: "jc_test123",
      hostId: "host_new",
      expiresAt: Date.now() + 15 * 60 * 1000,
    });
    vi.mocked(sdk.plugins.callRpc).mockResolvedValue(null);
    vi.mocked(sdk.hosts.list).mockResolvedValue([
      existingHost,
      host({ id: "host_offline", name: "dev-vm", status: "disconnected" }),
    ]);

    const { queryClient, wrapper } = createQueryClientTestHarness();
    render(<AddMachineDialog open onOpenChange={vi.fn()} />, { wrapper });

    // No machine code (not connect-paired): the direct/LAN command uses the
    // browser origin and carries no --machine-code flag.
    const command = await screen.findByText(/--join-code jc_test123/);
    expect(command.textContent).toContain(
      `curl -fsSL ${window.location.origin}/install.sh`,
    );
    expect(command.textContent).toContain(`--server ${window.location.origin}`);
    expect(command.textContent).not.toContain("--machine-code");

    await waitFor(() => {
      expect(queryClient.getQueryData<Host[]>(hostsQueryKey())).toHaveLength(2);
    });

    // A pre-existing machine reconnecting is not the machine being added.
    act(() => {
      queryClient.setQueryData<Host[]>(hostsQueryKey(), [
        existingHost,
        host({ id: "host_offline", name: "dev-vm" }),
      ]);
    });

    expect(
      await screen.findByText("Waiting for the machine to connect…"),
    ).toBeDefined();
    expect(screen.queryByText("dev-vm connected")).toBeNull();
  });
});
