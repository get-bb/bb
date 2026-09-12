// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { UsageMachine, UsageProvider } from "./usage-schema.js";

afterEach(cleanup);

function account(id: string, providerId = "codex"): UsageProvider {
  return {
    id,
    providerId,
    accountLabel: `${id}@example.com`,
    displayName: providerId === "codex" ? "Codex" : "Claude Code",
    logoUrl: null,
    icon: null,
    strings: { iconTint: null },
    signInHint: "Sign in again.",
    expiredHint: "Session expired.",
    usage: {
      status: "ok",
      accountEmail: `${id}@example.com`,
      planLabel: "Max (20x)",
      windows: [
        {
          label: "Weekly limit",
          usedPercent: 42,
          resetsAt: new Date(Date.now() + 3600_000).toISOString(),
          cost: null,
        },
      ],
    },
  };
}
const machine = (id: string, providers: UsageProvider[]): UsageMachine => ({
  id,
  displayName: id === "source:pool" ? "Account Pooler" : "My machine",
  status: "connected",
  error: null,
  providers,
});

it("fetches all providers only in the selected source and keeps grouped accounts, icons, labels and reset times", async () => {
  const app = await loadPluginApp(() => import("./app"));
  const result = {
    machines: [
      machine("host", [account("local")]),
      machine("source:pool", [
        account("first"),
        account("second"),
        account("third", "claude-code"),
      ]),
    ],
  };
  const slot = renderSlot(
    app.settingsSections[0]!,
    {},
    { rpc: { getUsage: () => result } },
  );
  await waitFor(() =>
    expect(slot.getByLabelText("Reload usage data")).toBeTruthy(),
  );
  expect(slot.getAllByRole("heading", { name: "Codex" })).toHaveLength(2);
  expect(slot.getByText("first@example.com")).toBeTruthy();
  expect(slot.getByText("second@example.com")).toBeTruthy();
  expect(slot.queryByText("local@example.com")).toBeNull();
  expect(slot.getAllByText(/Resets in/)).toHaveLength(3);
  expect(slot.rpcCalls.map((call) => call.input)).toEqual([
    { force: false, machineIds: null, providerId: null, maxAgeMs: 60_000 },
    {
      force: false,
      machineIds: ["source:pool"],
      providerId: "codex",
      maxAgeMs: 60_000,
    },
    {
      force: false,
      machineIds: ["source:pool"],
      providerId: "claude-code",
      maxAgeMs: 60_000,
    },
  ]);
  fireEvent.click(slot.getByLabelText("Reload usage data"));
  await waitFor(() => expect(slot.rpcCalls).toHaveLength(6));
  expect(slot.rpcCalls[4]?.input).toMatchObject({
    force: true,
    machineIds: ["source:pool"],
  });
});

it("uses machine usage when the pool is disabled", async () => {
  const app = await loadPluginApp(() => import("./app"));
  const slot = renderSlot(
    app.settingsSections[0]!,
    {},
    {
      rpc: {
        getUsage: () => ({ machines: [machine("host", [account("local")])] }),
      },
    },
  );
  await slot.findByText("local@example.com");
  await waitFor(() => expect(slot.rpcCalls).toHaveLength(2));
  expect(slot.rpcCalls[1]?.input).toMatchObject({
    machineIds: ["host"],
    providerId: "codex",
  });
});

it("keeps an enabled empty pool selected without fetching machine quotas", async () => {
  const app = await loadPluginApp(() => import("./app"));
  const slot = renderSlot(
    app.settingsSections[0]!,
    {},
    {
      rpc: {
        getUsage: () => ({
          machines: [
            machine("host", [account("local")]),
            machine("source:pool", []),
          ],
        }),
      },
    },
  );
  await slot.findByText(/No accounts report usage yet/);
  expect(slot.rpcCalls).toHaveLength(1);
  expect(slot.queryByText("local@example.com")).toBeNull();
});

it("renders loading and a friendly transport error without exposing raw errors", async () => {
  const app = await loadPluginApp(() => import("./app"));
  let reject!: (error: Error) => void;
  const pending = new Promise<never>((_, fail) => {
    reject = fail;
  });
  const slot = renderSlot(
    app.settingsSections[0]!,
    {},
    { rpc: { getUsage: () => pending } },
  );
  expect(slot.getByText("Loading providers and usage…")).toBeTruthy();
  reject(new Error("Unexpected token 'b', bb connect..."));
  await slot.findByText("Couldn’t load usage. Try reloading usage.");
  expect(slot.queryByText(/Unexpected token/)).toBeNull();
});

it("retains measured accounts when reloading fails", async () => {
  const app = await loadPluginApp(() => import("./app"));
  let failed = false;
  const slot = renderSlot(
    app.settingsSections[0]!,
    {},
    {
      rpc: {
        getUsage: () => {
          if (failed) throw new Error("private transport detail");
          return { machines: [machine("source:pool", [account("first")])] };
        },
      },
    },
  );
  await waitFor(() =>
    expect(slot.getByLabelText("Reload usage data")).toBeTruthy(),
  );
  failed = true;
  fireEvent.click(slot.getByLabelText("Reload usage data"));
  await slot.findByText(/Showing the last available update/);
  expect(slot.getByText("first@example.com")).toBeTruthy();
  expect(slot.getByText("42% used")).toBeTruthy();
});

it("shows pending measurements without inventing usage, then reports an unavailable account gracefully", async () => {
  const app = await loadPluginApp(() => import("./app"));
  const resource = { ...account("pending"), usage: null };
  let finish!: () => void;
  let calls = 0;
  const slot = renderSlot(
    app.settingsSections[0]!,
    {},
    {
      rpc: {
        getUsage: async () => {
          if (calls++ === 0)
            return { machines: [machine("source:pool", [resource])] };
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
          return {
            machines: [
              {
                ...machine("source:pool", [resource]),
                error: "Some usage could not be refreshed.",
              },
            ],
          };
        },
      },
    },
  );
  await slot.findByText("Loading usage…");
  expect(slot.queryByText("0% used")).toBeNull();
  finish();
  await slot.findByText("Couldn’t load usage. Try reloading usage.");
  expect(
    slot.getByText("Couldn't load usage right now. Try reloading usage."),
  ).toBeTruthy();
  expect(slot.queryByText(/Showing the last/)).toBeNull();
});

it("keeps authentication and plans without limits distinct from loading and errors", async () => {
  const app = await loadPluginApp(() => import("./app"));
  const first = account("signed-out");
  first.usage = { status: "unauthenticated" };
  const second = account("expired");
  second.usage = { status: "expired" };
  const third = account("unlimited");
  third.usage = {
    status: "ok",
    accountEmail: "unlimited@example.com",
    planLabel: null,
    windows: [],
  };
  const slot = renderSlot(
    app.settingsSections[0]!,
    {},
    {
      rpc: {
        getUsage: () => ({
          machines: [machine("source:pool", [first, second, third])],
        }),
      },
    },
  );
  await slot.findByText("Sign in again.");
  expect(slot.getByText("Session expired.")).toBeTruthy();
  expect(
    slot.getByText("No usage limits reported for this plan."),
  ).toBeTruthy();
  expect(slot.queryByText("0% used")).toBeNull();
});
