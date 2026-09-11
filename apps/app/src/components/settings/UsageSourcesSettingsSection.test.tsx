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
  selectHosts: (hosts: unknown[] | undefined) => hosts ?? [],
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
  calls.rpc.mockImplementation(async ({ pluginId, method }) => {
    if (pluginId === "broken") throw new Error("Unavailable");
    const snapshot = {
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
    return method.endsWith("listResources")
      ? snapshot
      : {
          observedAt: snapshot.resources[0]!.observedAt,
          usage: snapshot.resources[0]!.usage,
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
          pluginId: "local",
          method: "provider-usage.v1.getResource",
          input: { resourceId: "same-local-id", refresh: true },
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
  calls.rpc.mockImplementation(async ({ method }) =>
    method.endsWith("listResources")
      ? snapshot
      : {
          observedAt: snapshot.resources[0]!.observedAt,
          usage: snapshot.resources[0]!.usage,
        },
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
    expect(await screen.findByText("42% used")).toBeTruthy();
    calls.rpc.mockRejectedValue(new Error("Unexpected token b"));
    fireEvent.click(screen.getByLabelText("Reload usage data"));
    expect(await screen.findByText(/Showing the last update/)).toBeTruthy();
    expect(screen.getByText("42% used")).toBeTruthy();
    expect(screen.queryByText(/Unexpected token/)).toBeNull();
    calls.rpc.mockImplementation(async ({ method }) =>
      method.endsWith("listResources")
        ? snapshot
        : {
            observedAt: snapshot.resources[0]!.observedAt,
            usage: snapshot.resources[0]!.usage,
          },
    );
    fireEvent.click(screen.getByLabelText("Reload usage data"));
    await waitFor(() =>
      expect(screen.queryByText(/Showing the last update/)).toBeNull(),
    );
  } finally {
    client.clear();
  }
});

it("waits for the default shared inventory before fetching a fallback machine", async () => {
  let release!: (value: { label: string; resources: never[] }) => void;
  const pool = new Promise<{ label: string; resources: never[] }>((resolve) => {
    release = resolve;
  });
  calls.discover.mockResolvedValue([
    { pluginId: "pool", displayName: "Pool" },
    { pluginId: "local", displayName: "Local" },
  ]);
  calls.rpc.mockImplementation(async ({ pluginId, method }) => {
    if (!method.endsWith("listResources"))
      throw new Error("Should not collect any quota for an empty pool");
    return pluginId === "pool"
      ? pool
      : {
          resources: [
            {
              id: "host-a",
              providerId: "codex",
              label: "Codex",
              scope: {
                kind: "host",
                hostId: "host-a",
                hostName: "Build machine",
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
    await waitFor(() =>
      expect(calls.rpc).toHaveBeenCalledWith(
        expect.objectContaining({
          pluginId: "local",
          method: "provider-usage.v1.listResources",
        }),
      ),
    );
    release({ label: "Pool", resources: [] });
    expect(
      await screen.findByText(/No accounts report usage yet/),
    ).toBeTruthy();
    expect(
      calls.rpc.mock.calls.every(([args]) =>
        args.method.endsWith("listResources"),
      ),
    ).toBe(true);
  } finally {
    client.clear();
  }
});

it("deduplicates known inventory identities without merging unknown accounts sharing an email", async () => {
  calls.discover.mockResolvedValue([
    { pluginId: "pool", displayName: "Account Pooler" },
  ]);
  calls.rpc.mockImplementation(async ({ method, input }) =>
    method.endsWith("listResources")
      ? {
          label: "Account Pooler",
          resources: ["first", "duplicate", "unknown", "unknown2"].map(
            (id) => ({
              id,
              providerId: "custom",
              accountKey: id.startsWith("unknown") ? null : "issuer:account:1",
              label: "person@example.com",
              scope: { kind: "shared" },
            }),
          ),
        }
      : {
          accountKey: input.resourceId.startsWith("unknown")
            ? null
            : "issuer:account:1",
          observedAt: 123,
          usage: {
            status: "ok",
            accountEmail: "person@example.com",
            planLabel: "max",
            plan: { id: "max", multiplier: 20 },
            windows: [
              {
                id: "week",
                kind: "weekly",
                label: "168 hour window",
                model: null,
                resetsAt: null,
                cost: null,
                usedPercent: 42,
              },
            ],
          },
        },
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
    await waitFor(() =>
      expect(screen.getAllByText("42% used")).toHaveLength(3),
    );
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(1);
    expect(screen.getAllByText("person@example.com")).toHaveLength(3);
    expect(screen.getAllByText("Max (20x)")).toHaveLength(3);
    expect(screen.getAllByText("Weekly limit")).toHaveLength(3);
    expect(
      calls.rpc.mock.calls
        .filter(([args]) => args.method.endsWith("getResource"))
        .map(([args]) => args.input.resourceId),
    ).toEqual(["first", "unknown", "unknown2"]);
  } finally {
    client.clear();
  }
});
