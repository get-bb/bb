// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { Dialog, DialogContent } from "@bb/shared-ui/dialog";
import { ManualMachineSetup } from "./AddMachineDialog";

vi.mock("@/lib/sdk", () => ({
  sdk: {
    hosts: {
      delete: vi.fn(),
      experimental_create: vi.fn(),
      experimental_getEnrollmentCommand: vi.fn(),
      get: vi.fn(),
    },
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("cancels a creating manual launch when the dialog content closes", async () => {
  vi.mocked(sdk.hosts.experimental_create).mockResolvedValue({
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
  });
  vi.mocked(sdk.hosts.experimental_getEnrollmentCommand).mockResolvedValue({
    command: "bb machine enroll test",
    expiresAt: Date.now() + 60_000,
  });
  vi.mocked(sdk.hosts.get).mockImplementation(() => new Promise(() => {}));
  vi.mocked(sdk.hosts.delete).mockResolvedValue({ ok: true });
  const { wrapper } = createQueryClientTestHarness();
  const rendered = render(
    <Dialog open modal={false}>
      <DialogContent>
        <ManualMachineSetup onOpenChange={() => {}} />
      </DialogContent>
    </Dialog>,
    { wrapper },
  );

  await screen.findByText("bb machine enroll test");
  rendered.unmount();

  await waitFor(() => {
    expect(sdk.hosts.delete).toHaveBeenCalledWith({
      hostId: "host-reserved",
    });
  });
});
