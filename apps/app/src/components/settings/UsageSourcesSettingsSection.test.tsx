// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { UsageLimitsSettingsSection } from "./UsageLimitsSettingsSection";

const calls = vi.hoisted(() => ({ discover: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/sdk", () => ({
  sdk: {
    plugins: { experimental_discoverRpc: calls.discover, callRpc: calls.rpc },
  },
}));
vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemProviders: () => ({ data: [] }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("renders independent sources with shared and host scope and refreshes through the copied contract", async () => {
  calls.discover.mockResolvedValue([
    { pluginId: "pool", displayName: "Account Pooler" },
    { pluginId: "local", displayName: "Codex provider" },
    { pluginId: "broken", displayName: "Unavailable provider" },
  ]);
  calls.rpc.mockImplementation(async ({ pluginId }) => {
    if (pluginId === "broken") throw new Error("Unavailable");
    return {
      resources: [
        {
          id: "same-local-id",
          providerId: "codex",
          label: pluginId === "pool" ? "Pooled account" : "Local account",
          scope:
            pluginId === "pool"
              ? { kind: "shared" }
              : { kind: "host", hostId: "host-a", hostName: "Build machine" },
          observedAt: 1_700_000_000_000,
          usage: {
            status: "ok",
            accountEmail: null,
            planLabel: null,
            windows: [
              {
                id: "weekly",
                label: "Weekly",
                usedPercent: pluginId === "pool" ? 42 : 81,
                resetsAt: null,
                model: null,
                cost: null,
              },
            ],
          },
        },
      ],
    };
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  try {
    render(
      <QueryClientProvider client={client}>
        <UsageLimitsSettingsSection />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("42% used")).toBeTruthy();
    expect(await screen.findByText("81% used")).toBeTruthy();
    expect(screen.getByText(/Shared across machines/)).toBeTruthy();
    expect(screen.getByText(/Build machine/)).toBeTruthy();
    expect(
      await screen.findByText(/This source could not be refreshed/),
    ).toBeTruthy();
    await waitFor(() =>
      expect(
        screen.getByLabelText("Reload usage data").hasAttribute("disabled"),
      ).toBe(false),
    );
    fireEvent.click(screen.getByLabelText("Reload usage data"));
    await waitFor(() =>
      expect(calls.rpc).toHaveBeenCalledWith(
        expect.objectContaining({
          pluginId: "pool",
          method: "provider-usage.v1.get",
          input: { refresh: true },
        }),
      ),
    );
  } finally {
    client.clear();
  }
});
