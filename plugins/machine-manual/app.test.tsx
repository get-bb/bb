// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { createBrowserBbSdk } from "@bb/sdk/browser";
import { makeSystemConfig } from "../../apps/app/src/test/fixtures/system-config.js";
import { ManualMachineSetup } from "./app.js";

vi.mock("@get-bb/plugin-sdk/app", () => ({
  definePluginApp: vi.fn(),
  UrlLink: (props: React.ComponentProps<"a">) => <a {...props} />,
}));
const client = createBrowserBbSdk({ baseUrl: "http://localhost" });
const launch = {
  id: "manual-launch",
  machineProviderId: "manual",
  projectId: null,
  hostId: null,
  phase: "creating" as const,
  step: "",
  message: null,
  log: "",
  cancelPending: false,
  terminal: false,
};
beforeEach(() => {
  vi.spyOn(client.system, "config").mockResolvedValue(
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
  vi.spyOn(client.hosts, "submit").mockResolvedValue(launch);
  vi.spyOn(client.hosts, "follow").mockImplementation(
    async () => new Promise(() => {}),
  );
  vi.spyOn(client.hosts, "cancel").mockResolvedValue({
    ...launch,
    phase: "cancelled",
    terminal: true,
  });
  vi.spyOn(client.hosts, "experimental_enrollmentCommand").mockResolvedValue({
    command: "test-command",
    expiresAt: Date.now() + 60_000,
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("waits for a command before showing connection status and leaves enrollment valid on close", async () => {
  let resolveCommand!: (value: { command: string; expiresAt: number }) => void;
  vi.mocked(client.hosts.experimental_enrollmentCommand).mockReturnValue(
    new Promise((resolve) => {
      resolveCommand = resolve;
    }),
  );
  const view = render(
    <ManualMachineSetup client={client} onClose={() => {}} />,
  );
  await waitFor(() => expect(client.hosts.submit).toHaveBeenCalledTimes(1));
  expect(screen.getByText("Preparing command…")).toBeTruthy();
  expect(screen.queryByText("Waiting for the machine to connect…")).toBeNull();
  await act(async () => {
    resolveCommand({ command: "test-command", expiresAt: Date.now() + 60_000 });
  });
  await screen.findByRole("button", { name: "Copy command" });
  expect(screen.getByText("Waiting for the machine to connect…")).toBeTruthy();
  view.unmount();
  expect(client.hosts.cancel).not.toHaveBeenCalled();
  expect(vi.mocked(client.hosts.follow).mock.calls[0][0].signal?.aborted).toBe(
    true,
  );
});

it("offers provider alternatives without creating a command when access is unconfigured", async () => {
  const config = await client.system.config();
  config.serverAccess.providers[0].availability = {
    status: "setup-required",
    message: "Pair bb connect",
  };
  vi.mocked(client.system.config).mockResolvedValue(config);
  const showProviders = vi.fn();
  render(
    <ManualMachineSetup
      client={client}
      onClose={() => {}}
      onShowProviders={showProviders}
    />,
  );
  await screen.findByRole("link", { name: "Set up bb connect" });
  expect(client.hosts.submit).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Other ways to add a machine" }),
  );
  expect(showProviders).toHaveBeenCalledOnce();
});

it("cancels the current enrollment before switching providers", async () => {
  const showProviders = vi.fn();
  render(
    <ManualMachineSetup
      client={client}
      onClose={() => {}}
      onShowProviders={showProviders}
    />,
  );
  await screen.findByRole("button", { name: "Copy command" });
  fireEvent.click(
    screen.getByRole("button", { name: "Other ways to add a machine" }),
  );
  await waitFor(() => expect(showProviders).toHaveBeenCalledOnce());
  expect(client.hosts.cancel).toHaveBeenCalledWith({ id: "manual-launch" });
});
