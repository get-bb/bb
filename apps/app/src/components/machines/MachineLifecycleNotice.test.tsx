// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { MachineLifecycleNotice } from "./MachineLifecycleNotice";
import { sdk } from "@/lib/sdk";

vi.mock("@/lib/sdk", () => ({
  sdk: { hosts: { experimental_lifecycle: vi.fn() } },
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("keeps retention explicitly and delegates removal through the existing confirmation flow", async () => {
  let kept = false;
  vi.mocked(sdk.hosts.experimental_lifecycle).mockImplementation(
    async (args) => {
      if (args.keep !== undefined) kept = args.keep;
      return {
        phase: "suspended",
        expiresAt: null,
        maintenanceAt: null,
        lastSnapshotAt: 1,
        recoveryState: "healthy",
        message: null,
        retentionAt: Date.now() + 60_000,
        keep: kept,
      };
    },
  );
  const remove = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <MachineLifecycleNotice hostId="machine" onRemove={remove} />
    </QueryClientProvider>,
  );
  fireEvent.click(await view.findByText("Keep machine"));
  await view.findByText("Allow automatic deletion");
  expect(sdk.hosts.experimental_lifecycle).toHaveBeenCalledWith({
    hostId: "machine",
    keep: true,
  });
  fireEvent.click(view.getByText("Remove machine"));
  expect(remove).toHaveBeenCalledTimes(1);
  fireEvent.click(view.getByText("Allow automatic deletion"));
  await waitFor(() => expect(kept).toBe(false));
  client.clear();
});

it.each(["Compute disappeared before preservation completed", null])(
  "shows preservation loss without lifecycle dates: %s",
  async (message) => {
    vi.mocked(sdk.hosts.experimental_lifecycle).mockResolvedValue({
      phase: "active",
      expiresAt: null,
      maintenanceAt: null,
      lastSnapshotAt: null,
      recoveryState: "lost-since-last-snapshot",
      message,
      retentionAt: null,
      keep: true,
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const view = render(
      <QueryClientProvider client={client}>
        <MachineLifecycleNotice hostId="lost" onRemove={() => {}} />
      </QueryClientProvider>,
    );
    expect(
      await view.findByText(
        message ??
          "Machine preservation was lost. Explicit recovery is required.",
      ),
    ).toBeTruthy();
    expect(view.getByText("Remove machine")).toBeTruthy();
    client.clear();
  },
);
