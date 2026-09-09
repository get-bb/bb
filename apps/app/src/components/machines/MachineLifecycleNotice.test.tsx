// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
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

it("delegates explicit removal through the existing confirmation flow", async () => {
  vi.mocked(sdk.hosts.experimental_lifecycle).mockResolvedValue({
    phase: "suspended",
    expiresAt: null,
    maintenanceAt: null,
    lastSnapshotAt: 1,
    recoveryState: "healthy",
    message: null,
  });
  const remove = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <MachineLifecycleNotice hostId="machine" onRemove={remove} />
    </QueryClientProvider>,
  );
  fireEvent.click(await view.findByText("Remove machine"));
  expect(remove).toHaveBeenCalledTimes(1);
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
