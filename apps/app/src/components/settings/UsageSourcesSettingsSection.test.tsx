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
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { makeHost } from "@bb/test-helpers/domain-fixtures";
import { UsageLimitsSettingsSection } from "./UsageLimitsSettingsSection";

const calls = vi.hoisted(() => ({ discover: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/sdk", () => ({
  sdk: {
    plugins: { experimental_discoverRpc: calls.discover, callRpc: calls.rpc },
  },
}));
vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemProviders: () => ({ data: [], isSuccess: true }),
  useSystemConfig: () => ({ data: { primaryHostId: "host-a" } }),
}));

vi.mock("@/hooks/queries/host-queries", () => ({
  useHosts: () => ({
    data: [makeHost({ id: "host-a", name: "Build machine" })],
  }),
  selectPrimaryHost: (hosts: unknown[]) => hosts[0],
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("keeps the existing presentation for discovered shared and host usage and refreshes through the copied contract", async () => {
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
        <TooltipProvider>
          <UsageLimitsSettingsSection />
        </TooltipProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("42% used")).toBeTruthy();
    expect(await screen.findByText("81% used")).toBeTruthy();
    expect(screen.queryByText(/Shared across machines/)).toBeNull();
    expect(screen.queryByText("Account Pooler")).toBeNull();
    expect(screen.queryByText(/Observed/)).toBeNull();
    expect(screen.getByText("Your provider subscription usage.")).toBeTruthy();
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
