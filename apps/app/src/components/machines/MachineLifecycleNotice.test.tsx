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

    recoveryState: "healthy",
    message: "Machine suspension failed",
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

it.each(["Machine suspension failed"])(
  "shows maintenance failure: %s",
  async (message) => {
    vi.mocked(sdk.hosts.experimental_lifecycle).mockResolvedValue({
      phase: "active",

      recoveryState: "recoverable",
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
