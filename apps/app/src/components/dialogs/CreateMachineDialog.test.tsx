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

const accessState = vi.hoisted(() => ({ ready: false }));
vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: {
      serverUrl: "http://127.0.0.1:19635",
      serverAccess: {
        defaultProviderId: "connect",
        effectiveUrl: null,
        providers: [
          {
            id: "connect",
            displayName: "bb connect",
            availability: accessState.ready
              ? { status: "available" }
              : { status: "setup-required", message: "Pair bb connect" },
          },
        ],
      },
    },
  }),
}));
vi.mock("@/lib/sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sdk")>()),
  sdk: {
    projects: { list: vi.fn().mockResolvedValue([]) },
    hosts: {
      submit: vi.fn(),
      experimental_enrollmentCommand: vi.fn().mockResolvedValue({
        command: "bb machine enroll --bootstrap-env BB_ENROLLMENT",
      }),
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
  accessState.ready = false;
});

it("lists alternative providers without duplicating the manual command flow", async () => {
  accessState.ready = true;
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
  vi.mocked(sdk.projects.list).mockResolvedValue([
    {
      id: "project-fixture",
      kind: "standard",
      name: "Fixture",
      gitRemoteUrl: null,
      createdAt: 1,
      updatedAt: 1,
      sources: [],
    },
  ]);
  const launch = {
    id: "launch-manual",
    machineProviderId: "manual",
    projectId: null,
    hostId: null,
    phase: "creating" as const,
    step: "Run the enrollment command shown in the picker",
    message: null,
    log: "",
    cancelPending: false,
    terminal: false,
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
  await screen.findByRole("button", { name: "Copy command" });
  fireEvent.click(
    screen.getByRole("button", { name: "Other ways to add a machine" }),
  );
  await screen.findByRole("button", { name: "ssh" });
  expect(screen.queryByRole("button", { name: "Existing machine" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "ssh" }));
  for (const name of ["ssh", "modal", "digitalocean", "tailscale"])
    expect(screen.getByRole("button", { name })).toBeDefined();
  await screen.findByRole("option", { name: "Fixture" });
  fireEvent.change(screen.getByRole("combobox", { name: "Machine project" }), {
    target: { value: "project-fixture" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create ssh machine" }));
  expect((await screen.findByRole("status")).textContent).toContain(
    "Run the enrollment command shown in the picker",
  );
  expect(
    await screen.findByText("bb machine enroll --bootstrap-env BB_ENROLLMENT"),
  ).toBeTruthy();
  expect(sdk.hosts.experimental_enrollmentCommand).toHaveBeenCalledWith({
    id: "launch-manual",
    scope: "launch",
    signal: expect.any(AbortSignal),
  });
  fireEvent.click(screen.getByRole("button", { name: "Cancel setup" }));
  await waitFor(() =>
    expect(sdk.hosts.cancel).toHaveBeenCalledWith({ id: "launch-manual" }),
  );
  expect(sdk.hosts.submit).toHaveBeenCalledWith(
    expect.objectContaining({ projectId: "project-fixture" }),
  );
  expect(sdk.hosts.createJoinCode).not.toHaveBeenCalled();
});

it("prepares the manual command immediately when access is ready", async () => {
  accessState.ready = true;
  const { wrapper } = createQueryClientTestHarness();
  try {
    render(
      <MemoryRouter>
        <CreateMachineDialog open onOpenChange={() => {}} />
      </MemoryRouter>,
      { wrapper },
    );
    await screen.findByRole("button", { name: "Copy command" });
    expect(sdk.hosts.submit).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ machineProviderId: "manual", projectId: null }),
    );
    expect(
      screen.queryByRole("combobox", { name: "Machine project" }),
    ).toBeNull();
  } finally {
    accessState.ready = false;
  }
});

it("offers access alternatives, not machine providers, while remote access is missing", async () => {
  const { wrapper } = createQueryClientTestHarness();
  render(
    <MemoryRouter>
      <CreateMachineDialog open onOpenChange={() => {}} />
    </MemoryRouter>,
    { wrapper },
  );
  expect(
    (
      await screen.findByRole("link", { name: "Set up bb connect" })
    ).getAttribute("href"),
  ).toBe("/settings/plugins/connect");
  expect(
    screen
      .getByRole("link", { name: "Other ways to connect" })
      .getAttribute("href"),
  ).toBe("/settings/machines#advanced-machine-settings");
  expect(
    screen.queryByRole("button", { name: "Other ways to add a machine" }),
  ).toBeNull();
  expect(sdk.hosts.submit).not.toHaveBeenCalled();
});
