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

it("selects pooled or machine usage without mixing sources, preserves cards, and refreshes through the copied contract", async () => {
  calls.discover.mockResolvedValue([
    { pluginId: "pool", displayName: "Account Pooler [Experimental]" },
    { pluginId: "local", displayName: "Codex provider" },
    { pluginId: "broken", displayName: "Unavailable provider" },
  ]);
  calls.rpc.mockImplementation(async ({ pluginId }) => {
    if (pluginId === "broken") throw new Error("Unavailable");
    return {
      ...(pluginId === "pool" ? { label: "Account Pooler" } : {}),
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
            accountEmail: "person@example.com",
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
    expect(screen.queryByText("81% used")).toBeNull();
    expect(screen.getAllByText("person@example.com")).toHaveLength(1);
    expect(screen.queryByText(/Shared across machines/)).toBeNull();
    expect(screen.getByText("Account Pooler")).toBeTruthy();
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Usage source" }),
      { button: 0 },
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Build machine" }));
    expect(await screen.findByText("81% used")).toBeTruthy();
    expect(screen.queryByText("42% used")).toBeNull();
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

it("distinguishes an empty shared source, empty host sources, removal, and discovery failure", async () => {
  calls.discover.mockResolvedValue([
    { pluginId: "pool", displayName: "Account Pooler [Experimental]" },
    { pluginId: "local", displayName: "Local provider" },
  ]);
  calls.rpc.mockImplementation(async ({ pluginId }) =>
    pluginId === "pool"
      ? { label: "Account Pooler", resources: [] }
      : { resources: [] },
  );
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
    expect(await screen.findByText("Account Pooler")).toBeTruthy();
    expect(screen.getByText(/No accounts report usage yet/)).toBeTruthy();
    expect(screen.queryByText("Local provider")).toBeNull();
    calls.discover.mockResolvedValue([]);
    fireEvent.click(screen.getByLabelText("Reload usage data"));
    expect(
      await screen.findByText(/No usage sources are available/),
    ).toBeTruthy();
    expect(screen.queryByText("Account Pooler")).toBeNull();
    calls.discover.mockRejectedValue(new Error("private technical details"));
    fireEvent.click(screen.getByLabelText("Reload usage data"));
    expect(await screen.findByRole("status")).toHaveProperty(
      "textContent",
      "Couldn’t discover usage sources. Try reloading usage.",
    );
    expect(screen.queryByText(/private technical/)).toBeNull();
  } finally {
    client.clear();
  }
});

it("keeps successful measurements visible after a failed refresh and recovers", async () => {
  calls.discover.mockResolvedValue([
    { pluginId: "pool", displayName: "Account Pooler" },
  ]);
  const snapshot = {
    label: "Account Pooler",
    resources: [
      {
        id: "account",
        providerId: "codex",
        label: "Account",
        scope: { kind: "shared" },
        observedAt: 123,
        usage: {
          status: "ok",
          accountEmail: "person@example.com",
          planLabel: null,
          windows: [
            {
              id: "weekly",
              label: "Weekly",
              usedPercent: 42,
              resetsAt: null,
              model: null,
              cost: null,
            },
          ],
        },
      },
    ],
  };
  calls.rpc.mockResolvedValue(snapshot);
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
    calls.rpc.mockRejectedValue(new Error("Unexpected token b"));
    fireEvent.click(screen.getByLabelText("Reload usage data"));
    expect(await screen.findByText(/Showing the last update/)).toBeTruthy();
    expect(screen.getByText("42% used")).toBeTruthy();
    expect(screen.queryByText(/Unexpected token/)).toBeNull();
    calls.rpc.mockResolvedValue(snapshot);
    fireEvent.click(screen.getByLabelText("Reload usage data"));
    await waitFor(() =>
      expect(screen.queryByText(/Showing the last update/)).toBeNull(),
    );
  } finally {
    client.clear();
  }
});
