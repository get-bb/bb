// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { Host } from "@bb/domain";
import { HOST_DAEMON_PROTOCOL_VERSION } from "@bb/host-daemon-contract";
import {
  defaultAppSettings,
  defaultAppTheme,
  defaultExperiments,
} from "@bb/domain";
import type { SystemConfigResponse } from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { MachinesSettingsSection } from "./MachinesSettingsSection";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    listHosts: vi.fn(),
    getSystemConfig: vi.fn(),
    updateHost: vi.fn(),
    deleteHost: vi.fn(),
  };
});

vi.mock("@/lib/ws", () => ({
  wsManager: { subscribe: vi.fn(), unsubscribe: vi.fn() },
}));

const NOW = Date.now();

function host(overrides: Partial<Host> & Pick<Host, "id" | "name">): Host {
  return {
    type: "persistent",
    status: "connected",
    lastSeenAt: NOW,
    lastRejectedProtocolVersion: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

const primaryHost = host({ id: "host_primary", name: "MacBook Pro" });
const offlineHost = host({
  id: "host_remote",
  name: "dev-vm",
  status: "disconnected",
  lastSeenAt: NOW - 2 * 60 * 60 * 1000,
});

function systemConfig(multiMachineEnabled: boolean): SystemConfigResponse {
  return {
    generalSettings: defaultAppSettings,
    keybindings: [],
    defaultKeybindings: [],
    keybindingOverrides: [],
    experiments: { ...defaultExperiments, multiMachine: multiMachineEnabled },
    appearance: defaultAppTheme,
    customThemes: [],
    pluginThemes: [],
    featureFlags: { placeholder: false },
    hostDaemonPort: null,
    primaryHostId: "host_primary",
    primaryHostPlatform: "darwin",
    voiceTranscriptionEnabled: false,
    dataDir: "/tmp/bb-test",
  };
}

/** Sidebar bootstrap with two projects on the primary host, one on dev-vm. */
function stubSidebarBootstrapFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          projects: [
            {
              id: "proj_1",
              sources: [
                { id: "src_1", hostId: "host_primary" },
                { id: "src_2", hostId: "host_remote" },
              ],
              threads: [],
            },
            {
              id: "proj_2",
              sources: [{ id: "src_3", hostId: "host_primary" }],
              threads: [],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ),
  );
}

function renderSection() {
  const { wrapper } = createQueryClientTestHarness();
  return render(<MachinesSettingsSection />, { wrapper });
}

async function openHostMenu(hostName: string): Promise<void> {
  fireEvent.pointerDown(
    await screen.findByRole("button", { name: `${hostName} actions` }),
    { button: 0 },
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("MachinesSettingsSection", () => {
  it("renders nothing while the multiMachine experiment is off", async () => {
    vi.mocked(api.getSystemConfig).mockResolvedValue(systemConfig(false));
    stubSidebarBootstrapFetch();

    renderSection();

    await waitFor(() => {
      expect(vi.mocked(api.getSystemConfig)).toHaveBeenCalled();
    });
    expect(screen.queryByText("Machines")).toBeNull();
    expect(vi.mocked(api.listHosts)).not.toHaveBeenCalled();
  });

  it("renders each machine with status, primary badge, and project counts", async () => {
    vi.mocked(api.getSystemConfig).mockResolvedValue(systemConfig(true));
    vi.mocked(api.listHosts).mockResolvedValue([primaryHost, offlineHost]);
    stubSidebarBootstrapFetch();

    renderSection();

    expect(await screen.findByText("MacBook Pro")).toBeDefined();
    expect(screen.getByText("dev-vm")).toBeDefined();
    expect(screen.getByText("this machine")).toBeDefined();
    await waitFor(() => {
      expect(screen.getByText("Online · macOS · 2 projects")).toBeDefined();
    });
    expect(
      screen.getByText("Offline · last seen 2h ago · 1 project"),
    ).toBeDefined();
  });

  it("shows protocol versions when a machine needs an update", async () => {
    vi.mocked(api.getSystemConfig).mockResolvedValue(systemConfig(true));
    vi.mocked(api.listHosts).mockResolvedValue([
      primaryHost,
      {
        ...offlineHost,
        lastRejectedProtocolVersion: HOST_DAEMON_PROTOCOL_VERSION - 1,
      },
    ]);
    stubSidebarBootstrapFetch();

    renderSection();

    expect(
      await screen.findByText(
        `Needs update · daemon protocol ${HOST_DAEMON_PROTOCOL_VERSION - 1} · server protocol ${HOST_DAEMON_PROTOCOL_VERSION} · 1 project`,
      ),
    ).toBeDefined();
  });

  it("renames a machine through the row menu", async () => {
    vi.mocked(api.getSystemConfig).mockResolvedValue(systemConfig(true));
    vi.mocked(api.listHosts).mockResolvedValue([primaryHost, offlineHost]);
    vi.mocked(api.updateHost).mockResolvedValue({
      ...offlineHost,
      name: "build box",
    });
    stubSidebarBootstrapFetch();

    renderSection();

    await screen.findByText("dev-vm");
    await openHostMenu("dev-vm");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Rename" }));

    const input = await screen.findByLabelText("Machine name");
    fireEvent.change(input, { target: { value: "build box" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename machine" }));

    await waitFor(() => {
      expect(vi.mocked(api.updateHost)).toHaveBeenCalledWith(
        "host_remote",
        "build box",
      );
    });
  });

  it("removes a machine after confirmation", async () => {
    vi.mocked(api.getSystemConfig).mockResolvedValue(systemConfig(true));
    vi.mocked(api.listHosts).mockResolvedValue([primaryHost, offlineHost]);
    vi.mocked(api.deleteHost).mockResolvedValue(undefined);
    stubSidebarBootstrapFetch();

    renderSection();

    await screen.findByText("dev-vm");
    await openHostMenu("dev-vm");
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Remove machine/ }),
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Remove machine" }),
    );

    await waitFor(() => {
      expect(vi.mocked(api.deleteHost)).toHaveBeenCalledWith("host_remote");
    });
  });

  it("disables removal of the primary machine", async () => {
    vi.mocked(api.getSystemConfig).mockResolvedValue(systemConfig(true));
    vi.mocked(api.listHosts).mockResolvedValue([primaryHost, offlineHost]);
    stubSidebarBootstrapFetch();

    renderSection();

    await screen.findByText("MacBook Pro");
    await openHostMenu("MacBook Pro");

    const removeItem = await screen.findByRole("menuitem", {
      name: /Remove machine/,
    });
    expect(removeItem.getAttribute("aria-disabled")).toBe("true");
    expect(vi.mocked(api.deleteHost)).not.toHaveBeenCalled();
  });
});
