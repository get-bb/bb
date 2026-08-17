// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { Host } from "@bb/domain";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BbHttpError, sdk } from "@/lib/sdk";
import { hostsQueryKey } from "@/hooks/queries/query-keys";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { AddMachineDialog } from "./AddMachineDialog";

vi.mock("@/lib/sdk", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/sdk")>();
  return {
    ...original,
    sdk: {
      hosts: {
        createJoinCode: vi.fn(),
        list: vi.fn(),
      },
      plugins: { callRpc: vi.fn() },
    },
  };
});

vi.mock("@/lib/ws", () => ({
  wsManager: { subscribe: vi.fn(), unsubscribe: vi.fn() },
}));

function host(overrides: Partial<Host> & Pick<Host, "id" | "name">): Host {
  return {
    type: "persistent",
    status: "connected",
    lastSeenAt: null,
    maxPermissionMode: "full",
    lastRejectedProtocolVersion: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

const existingHost = host({ id: "host_primary", name: "MacBook Pro" });
const writeTextMock = vi.fn().mockResolvedValue(undefined);
Object.defineProperty(navigator, "clipboard", {
  configurable: true,
  value: { writeText: writeTextMock },
});

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
    render(
      <MemoryRouter>
        <AddMachineDialog
          open
          onOpenChange={vi.fn()}
          serverUrl="http://direct.example.test:38886"
        />
      </MemoryRouter>,
      { wrapper },
    );

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
      "curl -fL --progress-meter --connect-timeout 10 --max-time 60 --retry 2 https://example.getbb.app/install.sh",
    );
    expect(command.textContent).toContain("--server https://example.getbb.app");
    expect(command.textContent).toContain("--machine-code mc_test456");
    expect(command.textContent).not.toContain(window.location.origin);
    expect(screen.getByText(/Code expires in \d+:\d{2}/)).toBeDefined();
    expect(
      screen.getByText("Waiting for the machine to connect…"),
    ).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith(command.textContent);
      expect(screen.getByRole("button", { name: "Copied" })).toBeDefined();
    });

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

  it("falls back to direct pairing when connect is unpaired and ignores known hosts", async () => {
    vi.mocked(sdk.hosts.createJoinCode).mockResolvedValue({
      joinCode: "jc_test123",
      hostId: "host_new",
      expiresAt: Date.now() + 15 * 60 * 1000,
    });
    vi.mocked(sdk.plugins.callRpc).mockRejectedValue(
      new BbHttpError({
        body: {
          ok: false,
          error: { code: "handler_error", message: "not_paired" },
        },
        code: "handler_error",
        message: "not_paired",
        status: 500,
      }),
    );
    vi.mocked(sdk.hosts.list).mockResolvedValue([
      existingHost,
      host({ id: "host_offline", name: "dev-vm", status: "disconnected" }),
    ]);

    const { queryClient, wrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter>
        <AddMachineDialog
          open
          onOpenChange={vi.fn()}
          serverUrl="http://direct.example.test:38886"
        />
      </MemoryRouter>,
      { wrapper },
    );

    // No machine code (not connect-paired): the direct/LAN command uses the
    // server-reported URL and carries no --machine-code flag.
    const command = await screen.findByText(/--join-code jc_test123/);
    expect(command.textContent).toContain(
      "curl -fL --progress-meter --connect-timeout 10 --max-time 60 --retry 2 http://direct.example.test:38886/install.sh",
    );
    expect(command.textContent).toContain(
      "--server http://direct.example.test:38886",
    );
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

  it("explains that a loopback server is unreachable when connect is unpaired", async () => {
    vi.mocked(sdk.hosts.createJoinCode).mockResolvedValue({
      joinCode: "jc_test123",
      hostId: "host_new",
      expiresAt: Date.now() + 15 * 60 * 1000,
    });
    vi.mocked(sdk.plugins.callRpc).mockRejectedValue(
      new BbHttpError({
        body: {
          ok: false,
          error: { code: "handler_error", message: "not_paired" },
        },
        code: "handler_error",
        message: "not_paired",
        status: 500,
      }),
    );
    vi.mocked(sdk.hosts.list).mockResolvedValue([existingHost]);

    const { wrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter>
        <AddMachineDialog
          open
          onOpenChange={vi.fn()}
          serverUrl="http://127.0.0.1:38886"
        />
      </MemoryRouter>,
      { wrapper },
    );

    // The desktop server listens on loopback only. Another machine cannot
    // reach it, so a curl command against 127.0.0.1 can never work.
    const notice = await screen.findByRole("status");
    expect(notice.textContent).toContain(
      "Another machine cannot use this address.",
    );
    expect(notice.textContent).toContain("http://127.0.0.1:38886");
    expect(screen.queryByText(/--join-code jc_test123/)).toBeNull();
    const link = screen.getByRole("link", { name: "Set up remote access" });
    expect(link.getAttribute("href")).toBe("/settings/plugins/connect");
    expect(
      screen.queryByText("Waiting for the machine to connect…"),
    ).toBeNull();
  });

  it("offers a retry when connect is temporarily unavailable on a loopback server", async () => {
    vi.mocked(sdk.hosts.createJoinCode).mockResolvedValue({
      joinCode: "jc_test123",
      hostId: "host_new",
      expiresAt: Date.now() + 15 * 60 * 1000,
    });
    vi.mocked(sdk.plugins.callRpc).mockRejectedValue(
      new BbHttpError({
        body: { error: "plugin starting" },
        code: "unavailable",
        message: "unavailable",
        status: 503,
      }),
    );
    vi.mocked(sdk.hosts.list).mockResolvedValue([existingHost]);

    const { wrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter>
        <AddMachineDialog
          open
          onOpenChange={vi.fn()}
          serverUrl="http://0.0.0.0:38886"
        />
      </MemoryRouter>,
      { wrapper },
    );

    // A 503 says nothing about pairing. Do not print a command that dials the
    // new machine itself, and do not claim connect is unpaired: let the user
    // retry.
    expect(
      await screen.findByText("Remote access isn't ready yet."),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Try again" })).toBeDefined();
    expect(screen.queryByText(/--join-code jc_test123/)).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
