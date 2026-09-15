// @vitest-environment jsdom

import { createDeferredPromise } from "@bb/test-helpers";
import { makeHost } from "@bb/test-helpers/domain-fixtures";
import type { ServerAccessStatus } from "@bb/server-contract";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { makeSystemConfig } from "@/test/fixtures/system-config";
import { Dialog, DialogContent } from "@bb/shared-ui/dialog";
import { AddMachineContent, ManualMachineSetup } from "./AddMachineDialog";

vi.mock("@/lib/sdk", () => ({
  sdk: {
    hosts: {
      delete: vi.fn(),
      experimental_create: vi.fn(),
      experimental_getEnrollmentCommand: vi.fn(),
      get: vi.fn(),
      list: vi.fn(),
    },
    system: { config: vi.fn() },
  },
}));

vi.mock("@/lib/ws", () => ({
  wsManager: { subscribe: vi.fn(), unsubscribe: vi.fn() },
}));

const READY_SERVER_ACCESS: ServerAccessStatus = {
  providers: [
    {
      id: "direct",
      displayName: "Manual",
      description: "Use your own domain or network address.",
      pluginId: null,
      availability: null,
    },
  ],
  defaultProviderId: "direct",
  effectiveUrl: "https://bb.example.com",
  urlSource: "setting",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const reservedHost: Awaited<ReturnType<typeof sdk.hosts.experimental_create>> =
  {
    id: "host-reserved",
    name: "Manual machine",
    type: "persistent",
    status: "disconnected",
    machineProviderId: "manual",
    lifecycle: {
      phase: "creating",
      suspendedAt: null,
      message: "Waiting for the machine",
      pendingLog: "",
      teardown: null,
    },
    maxPermissionMode: "full",
    lastSeenAt: null,
    lastRejectedProtocolVersion: null,
    createdAt: 1,
    updatedAt: 1,
  };

function stubManualLaunch(configure?: () => void) {
  vi.mocked(sdk.hosts.experimental_create).mockResolvedValue(reservedHost);
  vi.mocked(sdk.hosts.experimental_getEnrollmentCommand).mockResolvedValue({
    command: "bb machine enroll test",
    expiresAt: Date.now() + 60_000,
  });
  vi.mocked(sdk.hosts.get).mockImplementation(() => new Promise(() => {}));
  vi.mocked(sdk.hosts.delete).mockResolvedValue({ ok: true });
  configure?.();
}

function renderInDialog(content: ReactNode) {
  const { wrapper } = createQueryClientTestHarness();
  return render(
    <MemoryRouter>
      <Dialog open modal={false}>
        <DialogContent>{content}</DialogContent>
      </Dialog>
    </MemoryRouter>,
    { wrapper },
  );
}

function setup(configure?: () => void) {
  stubManualLaunch(configure);
  return renderInDialog(
    <ManualMachineSetup serverMachineName={null} onOpenChange={() => {}} />,
  );
}

function renderAddMachineContent(primaryHostId: string | null) {
  stubManualLaunch(() => {
    vi.mocked(sdk.system.config).mockResolvedValue(
      makeSystemConfig({ serverAccess: READY_SERVER_ACCESS, primaryHostId }),
    );
    vi.mocked(sdk.hosts.list).mockResolvedValue([
      makeHost({ id: "host_laptop", name: "MacBook Pro" }),
      makeHost({ id: "host_server", name: "Mac mini" }),
    ]);
  });
  return renderInDialog(<AddMachineContent onOpenChange={() => {}} />);
}

it("names the server machine a new machine depends on", async () => {
  const rendered = renderAddMachineContent("host_server");
  expect(
    await screen.findByText(
      "The new machine will connect to the bb server on Mac mini. Keep that computer on so the new machine can keep working.",
    ),
  ).toBeDefined();
  rendered.unmount();
});

it("does not name a fallback machine when the server has no primary host", async () => {
  const rendered = renderAddMachineContent(null);
  await waitFor(() => expect(sdk.hosts.list).toHaveBeenCalled());
  await screen.findByText("bb machine enroll test");
  expect(
    screen.getByText(
      "The new machine will connect to your bb server. Keep the server machine on so the new machine can keep working.",
    ),
  ).toBeDefined();
  expect(screen.queryByText(/Mac mini|MacBook Pro/u)).toBeNull();
  rendered.unmount();
});

it("cancels a creating manual launch when the dialog content closes", async () => {
  const rendered = setup();
  await screen.findByText("bb machine enroll test");
  rendered.unmount();

  await waitFor(() => {
    expect(sdk.hosts.delete).toHaveBeenCalledWith({
      hostId: "host-reserved",
    });
  });
});

it("retrieves the enrollment command after asynchronous access preparation", async () => {
  const rendered = setup(() => {
    vi.mocked(sdk.hosts.experimental_getEnrollmentCommand)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        command: "delayed enrollment command",
        expiresAt: Date.now() + 60_000,
      });
    vi.mocked(sdk.hosts.get).mockResolvedValue({
      ...reservedHost,
      connectMachineId: null,
    });
  });
  await screen.findByText("delayed enrollment command", {}, { timeout: 3_000 });
  expect(sdk.hosts.experimental_getEnrollmentCommand).toHaveBeenCalledTimes(2);
  rendered.unmount();
});

it("accepts a connection before an enrollment command is returned", async () => {
  const rendered = setup(() => {
    vi.mocked(sdk.hosts.experimental_getEnrollmentCommand).mockResolvedValue(
      null,
    );
    vi.mocked(sdk.hosts.get).mockResolvedValue({
      ...reservedHost,
      connectMachineId: null,
      status: "connected",
      lifecycle: { ...reservedHost.lifecycle, phase: "active" },
    });
  });
  await screen.findByText("Manual machine connected", {}, { timeout: 3_000 });
  rendered.unmount();
  expect(sdk.hosts.delete).not.toHaveBeenCalled();
});

it("cancels the reserved host while enrollment command preparation is pending", async () => {
  const pending = createDeferredPromise<null>();
  const rendered = setup(() => {
    vi.mocked(sdk.hosts.experimental_getEnrollmentCommand).mockReturnValue(
      pending.promise,
    );
  });
  await waitFor(() =>
    expect(sdk.hosts.experimental_getEnrollmentCommand).toHaveBeenCalledOnce(),
  );
  const request = vi.mocked(sdk.hosts.experimental_getEnrollmentCommand).mock
    .calls[0]![0];
  rendered.unmount();
  expect(request.signal?.aborted).toBe(true);
  await waitFor(() =>
    expect(sdk.hosts.delete).toHaveBeenCalledWith({ hostId: reservedHost.id }),
  );
  pending.resolve(null);
  expect(sdk.hosts.experimental_create).toHaveBeenCalledOnce();
});
