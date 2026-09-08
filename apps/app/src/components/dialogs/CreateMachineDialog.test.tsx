// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { CreateMachineDialog } from "./CreateMachineDialog";

vi.mock("@/lib/sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sdk")>()),
  sdk: {
    hosts: {
      submit: vi.fn(),
      follow: vi.fn(),
      cancel: vi.fn(),
      createJoinCode: vi.fn(),
      list: vi.fn().mockResolvedValue([]),
      listProviders: vi.fn(),
    },
  },
}));
vi.mock("@/lib/ws", () => ({
  wsManager: { subscribe: vi.fn(), unsubscribe: vi.fn() },
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("lists manual alongside other providers and never mints a legacy join code", async () => {
  vi.mocked(sdk.hosts.listProviders).mockResolvedValue(
    ["manual", "ssh", "modal", "digitalocean", "tailscale"].map((id) => ({
      id,
      displayName: id === "manual" ? "Existing machine" : id,
      icon: null,
      logoUrl: null,
      pluginId: `machine-${id}`,
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
  const launch = {
    id: "launch-manual",
    machineProviderId: "manual",
    projectId: null,
    hostId: null,
    phase: "creating" as const,
    step: "Run on the target machine:\nbb machine enroll --bootstrap-env BB_ENROLLMENT",
    message: null,
    log: "",
    cancelPending: false,
  };
  vi.mocked(sdk.hosts.submit).mockResolvedValue(launch);
  vi.mocked(sdk.hosts.follow).mockImplementation(async (args) => {
    args.onProgress?.(launch);
    return new Promise(() => {});
  });
  vi.mocked(sdk.hosts.cancel).mockResolvedValue({
    ...launch,
    phase: "cancelled",
  });
  const { wrapper } = createQueryClientTestHarness();
  render(
    <MemoryRouter>
      <CreateMachineDialog open onOpenChange={() => {}} />
    </MemoryRouter>,
    { wrapper },
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Existing machine" }),
  );
  for (const name of ["ssh", "modal", "digitalocean", "tailscale"])
    expect(screen.getByRole("button", { name })).toBeDefined();
  fireEvent.click(
    screen.getByRole("button", { name: "Create Existing machine" }),
  );
  expect((await screen.findByRole("status")).textContent).toContain(
    "bb machine enroll",
  );
  fireEvent.click(screen.getByRole("button", { name: "Cancel enrollment" }));
  await waitFor(() =>
    expect(sdk.hosts.cancel).toHaveBeenCalledWith({ id: "launch-manual" }),
  );
  expect(sdk.hosts.createJoinCode).not.toHaveBeenCalled();
});
