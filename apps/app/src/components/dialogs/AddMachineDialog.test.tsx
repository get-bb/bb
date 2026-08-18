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
import type { InstalledPlugin } from "@bb/server-contract";
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
      plugins: { callRpc: vi.fn(), list: vi.fn() },
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

function connectPlugin(
  overrides: Pick<InstalledPlugin, "enabled" | "status">,
): InstalledPlugin {
  return {
    id: "connect",
    source: "builtin:connect",
    rootDir: "/plugins/connect",
    version: "0.1.0",
    provenance: "builtin",
    isOrphanedBuiltin: false,
    publisherLabel: "BB Official",
    sourceDisplay: "builtin · connect",
    updateState: {},
    description: null,
    name: "Remote access",
    icon: null,
    iconUrl: null,
    statusDetail: null,
    handlerStats: { count: 0, totalMs: 0, maxMs: 0, errorCount: 0 },
    services: [],
    schedules: [],
    cliCommand: null,
    capabilities: [],
    hasSettings: true,
    app: { hasApp: false, bundle: null },
    logoUrl: null,
    logoDarkUrl: null,
    ...overrides,
  };
}

/** What the rpc dispatcher returns for any plugin that is not running. */
function notRunningRpcError(status: string): BbHttpError {
  const message = `plugin "connect" is not running (status: ${status})`;
  return new BbHttpError({
    body: { ok: false, error: message },
    code: null,
    message,
    status: 503,
  });
}
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
      notRunningRpcError("degraded"),
    );
    vi.mocked(sdk.plugins.list).mockResolvedValue({
      plugins: [connectPlugin({ enabled: true, status: "degraded" })],
    });
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

  it("links to the Connect plugin when it is disabled on a loopback server", async () => {
    vi.mocked(sdk.hosts.createJoinCode).mockResolvedValue({
      joinCode: "jc_test123",
      hostId: "host_new",
      expiresAt: Date.now() + 15 * 60 * 1000,
    });
    // A disabled plugin answers 503 like a plugin that is still starting;
    // only the plugin list tells them apart.
    vi.mocked(sdk.plugins.callRpc).mockRejectedValue(
      notRunningRpcError("disabled"),
    );
    vi.mocked(sdk.plugins.list).mockResolvedValue({
      plugins: [connectPlugin({ enabled: false, status: "disabled" })],
    });
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

    // Retrying cannot help: point at the plugin instead of a dead end.
    const notice = await screen.findByRole("status");
    expect(notice.textContent).toContain("The Connect plugin is disabled");
    const link = screen.getByRole("link", {
      name: "Enable the Connect plugin",
    });
    expect(link.getAttribute("href")).toBe(
      "/extensions/plugins/connect?view=installed",
    );
    expect(screen.queryByText("Remote access isn't ready yet.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(
      screen.queryByText("Waiting for the machine to connect…"),
    ).toBeNull();
    expect(screen.queryByText(/--join-code jc_test123/)).toBeNull();
  });
});
