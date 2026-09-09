// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SystemMachineProvider } from "@bb/server-contract";
import { makeSystemConfig } from "@/test/fixtures/system-config";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { CreateMachineDialog } from "./CreateMachineDialog";

const slots = vi.hoisted(() => ({ owner: "command-plugin" }));
vi.mock("@/lib/plugin-slots", () => ({
  usePluginSlots: () => ({
    machineProviderInputs: [],
    machineSetup: [
      {
        machineProviderId: "command-provider",
        pluginId: slots.owner,
        generation: 1,
        component: () => <button>Plugin-owned setup</button>,
      },
    ],
  }),
}));
vi.mock("@/components/plugin/PluginSlotMount", () => ({
  PluginSlotMount: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/lib/sdk", () => ({
  sdk: {
    system: { config: vi.fn(), updateGeneralSettings: vi.fn() },
    projects: { list: vi.fn().mockResolvedValue([]) },
    hosts: {
      submit: vi.fn(),
      follow: vi.fn(),
      list: vi.fn().mockResolvedValue([]),
      listProviders: vi.fn(),
    },
  },
}));
vi.mock("@/lib/ws", () => ({
  wsManager: { subscribe: vi.fn(), unsubscribe: vi.fn() },
}));
beforeEach(() => {
  slots.owner = "command-plugin";
  vi.mocked(sdk.system.config).mockResolvedValue(
    makeSystemConfig({
      serverAccess: {
        defaultProviderId: "connect",
        effectiveUrl: null,
        urlSource: null,
        providers: [
          {
            id: "connect",
            displayName: "bb connect",
            attention: null,
            availability: { status: "available" },
          },
        ],
      },
    }),
  );
  vi.mocked(sdk.hosts.listProviders).mockResolvedValue(
    ["command-provider", "tailscale"].map((id): SystemMachineProvider => ({
      id,
      displayName: id,
      icon: null,
      logoUrl: null,
      pluginId:
        id === "command-provider" ? "command-plugin" : "tailscale-plugin",
      requires: { gitRemote: false },
      inputs: null,
      acceptsEmptyInputs: true,
      supportsSuspend: false,
      environmentRow: null,

      availability: { status: "available" },
    })),
  );
  vi.mocked(sdk.hosts.submit).mockResolvedValue({
    id: "launch",
    hostId: null,
    phase: "creating",
    step: "",
    message: null,
    log: "",
    cancelPending: false,
    terminal: false,
  });
  vi.mocked(sdk.hosts.follow).mockImplementation(
    async () => new Promise(() => {}),
  );
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function show() {
  const { wrapper } = createQueryClientTestHarness();
  return render(
    <MemoryRouter>
      <CreateMachineDialog open onOpenChange={() => {}} />
    </MemoryRouter>,
    { wrapper },
  );
}
it("opens the only provider directly without submitting in core", async () => {
  const providers = await sdk.hosts.listProviders();
  vi.mocked(sdk.hosts.listProviders).mockResolvedValue(providers.slice(0, 1));
  show();
  await screen.findByRole("button", { name: "Plugin-owned setup" });
  expect(sdk.hosts.submit).not.toHaveBeenCalled();
});
it("offers the generic provider picker when no owned default setup exists", async () => {
  slots.owner = "unrelated-plugin";
  show();
  fireEvent.click(await screen.findByRole("button", { name: "tailscale" }));
  expect(
    screen.getAllByRole("button", { name: "command-provider" }),
  ).toHaveLength(1);
  fireEvent.click(
    screen.getByRole("button", { name: "Create tailscale machine" }),
  );
  await waitFor(() =>
    expect(sdk.hosts.submit).toHaveBeenCalledWith(
      expect.objectContaining({ machineProviderId: "tailscale" }),
    ),
  );
});
it("does not mount another plugin's setup for a provider it does not own", async () => {
  slots.owner = "unrelated-plugin";
  show();
  await screen.findByRole("button", { name: "command-provider" });
  expect(
    screen.queryByRole("button", { name: "Plugin-owned setup" }),
  ).toBeNull();
});

it("shows multiple providers before opening their setup", async () => {
  show();
  fireEvent.click(
    await screen.findByRole("button", { name: "command-provider" }),
  );
  await screen.findByRole("button", { name: "Plugin-owned setup" });
});
it("blocks provider selection until access is configured", async () => {
  const config = await sdk.system.config();
  config.serverAccess.providers[0]!.availability = {
    status: "setup-required",
    message: "Pair bb connect",
  };
  vi.mocked(sdk.system.config).mockResolvedValue(config);
  show();
  await screen.findByRole("link", { name: "Set up bb connect" });
  expect(screen.queryByRole("button", { name: "command-provider" })).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Plugin-owned setup" }),
  ).toBeNull();
  expect(sdk.hosts.submit).not.toHaveBeenCalled();
});

it("saves a manual address in the access gate and advances without reopening", async () => {
  const config = await sdk.system.config();
  config.serverAccess = {
    defaultProviderId: "direct",
    effectiveUrl: "http://127.0.0.1:19635",
    urlSource: null,
    providers: [
      {
        id: "direct",
        displayName: "Manual",
        attention: null,
        availability: { status: "available" },
      },
    ],
  };
  vi.mocked(sdk.system.config).mockResolvedValue(config);
  vi.mocked(sdk.system.updateGeneralSettings).mockImplementation(
    async (settings) => {
      vi.mocked(sdk.system.config).mockResolvedValue({
        ...config,
        generalSettings: { ...config.generalSettings, ...settings },
        serverAccess: {
          ...config.serverAccess,
          effectiveUrl: settings.machineServerUrl,
        },
      });
      return { ...config.generalSettings, ...settings };
    },
  );
  show();
  const address = await screen.findByRole("textbox", {
    name: "Server address",
  });
  fireEvent.change(address, { target: { value: "http://localhost:3000" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText(
    "Other machines cannot reach localhost. Use a domain or shared-network address.",
  );
  expect(sdk.system.updateGeneralSettings).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "command-provider" })).toBeNull();
  fireEvent.change(address, { target: { value: "https://bb.example.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("button", { name: "command-provider" });
  expect(sdk.system.updateGeneralSettings).toHaveBeenCalledWith(
    expect.objectContaining({ machineServerUrl: "https://bb.example.com" }),
  );
});
