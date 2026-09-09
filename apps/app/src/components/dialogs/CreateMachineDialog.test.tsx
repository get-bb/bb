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
import type { ExperimentalMachineSetupProps } from "@get-bb/plugin-sdk";
import type { SystemMachineProvider } from "@bb/server-contract";
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
        default: true,
        component: ({ onShowProviders }: ExperimentalMachineSetupProps) => (
          <button onClick={onShowProviders}>Plugin-owned setup</button>
        ),
      },
    ],
  }),
}));
vi.mock("@/components/plugin/PluginSlotMount", () => ({
  PluginSlotMount: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/lib/sdk", () => ({
  sdk: {
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
      policy: {
        idleSuspendMs: null,
        retire: { after: "never" },
        removeRetryMs: 60_000,
      },
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
it("opens a plugin-owned default without submitting in core", async () => {
  show();
  await screen.findByRole("button", { name: "Plugin-owned setup" });
  expect(sdk.hosts.submit).not.toHaveBeenCalled();
});
it("lets the plugin switch to alternative providers without requiring default access", async () => {
  show();
  fireEvent.click(
    await screen.findByRole("button", { name: "Plugin-owned setup" }),
  );
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
