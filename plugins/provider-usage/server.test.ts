import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import plugin from "./server.js";
import {
  usageSnapshotSchema,
  usageSourceMethod,
} from "./usage-source-contract.js";

const discovery = [{ pluginId: "local-source", method: usageSourceMethod }];

afterEach(() => {
  vi.useRealTimers();
});

describe("provider usage backend", () => {
  it("loads ordered provider usage independently for every machine", async () => {
    const host = createFakePluginHost({
      pluginId: "provider-usage",
      sdk: {
        hosts: {
          list: async () => [
            {
              id: "host-m4",
              name: "M4",
              type: "persistent",
              status: "connected",
              maxPermissionMode: "full",
              lastSeenAt: 1,
              lastRejectedProtocolVersion: null,
              createdAt: 1,
              updatedAt: 1,
            },
            {
              id: "host-intel",
              name: "Intel",
              type: "persistent",
              status: "disconnected",
              maxPermissionMode: "full",
              lastSeenAt: 1,
              lastRejectedProtocolVersion: null,
              createdAt: 1,
              updatedAt: 1,
            },
          ],
        },
        providers: {
          list: async () => [
            {
              id: "claude-code",
              providerId: "claude-code",
              accountLabel: null,
              displayName: "Claude Code",
              logoUrl: "/api/v1/system/providers/claude-code/logo?h=claude",
              strings: {
                signInHint: "Sign in to Claude Code.",
                expiredHint: "Sign in to Claude Code again.",
                iconTint: { light: "#D97757", dark: "#E38A6E" },
              },
            },
            {
              id: "codex",
              providerId: "codex",
              accountLabel: null,
              displayName: "Codex",
              logoUrl: "/api/v1/system/providers/codex/logo?h=codex",
            },
          ],
        },
        plugins: {
          experimental_discoverRpc: async () => discovery,
          callRpc: async () =>
            usageSnapshotSchema.parse({
              resources: [
                {
                  id: "claude-code",
                  providerId: "claude-code",
                  label: "Claude Code",
                  scope: { kind: "host", hostId: "host-m4", hostName: "M4" },
                  observedAt: 1,
                  usage: {
                    status: "ok",
                    accountEmail: "dev@example.com",
                    planLabel: "Max",
                    windows: [
                      {
                        id: "five-hour",
                        label: "Five-hour limit",
                        usedPercent: 82,
                        resetsAt: "2026-09-02T18:42:00.000Z",
                        model: null,
                        cost: null,
                      },
                    ],
                  },
                },
                {
                  id: "codex",
                  providerId: "codex",
                  label: "Codex",
                  scope: { kind: "host", hostId: "host-m4", hostName: "M4" },
                  observedAt: null,
                  usage: {
                    status: "unauthenticated",
                    accountEmail: null,
                    planLabel: null,
                  },
                },
              ],
            }),
        },
      },
    });
    plugin(host.bb);

    await expect(
      host.harness.behavior.callRpc("getUsage", {
        force: false,
        machineIds: null,
        maxAgeMs: 30 * 60_000,
      }),
    ).resolves.toEqual({
      machines: [
        {
          id: "host-m4",
          displayName: "M4",
          status: "connected",
          error: null,
          providers: [
            {
              id: "local-source:claude-code",
              providerId: "claude-code",
              accountLabel: null,
              displayName: "Claude Code",
              logoUrl: "/api/v1/system/providers/claude-code/logo?h=claude",
              icon: null,
              strings: { iconTint: { light: "#D97757", dark: "#E38A6E" } },
              signInHint: "Sign in to Claude Code.",
              expiredHint: "Sign in to Claude Code again.",
              usage: {
                status: "ok",
                accountEmail: "dev@example.com",
                planLabel: "Max",
                windows: [
                  {
                    label: "Five-hour limit",
                    usedPercent: 82,
                    resetsAt: "2026-09-02T18:42:00.000Z",
                    cost: null,
                  },
                ],
              },
            },
            {
              id: "local-source:codex",
              providerId: "codex",
              accountLabel: null,
              displayName: "Codex",
              logoUrl: "/api/v1/system/providers/codex/logo?h=codex",
              icon: null,
              strings: { iconTint: null },
              signInHint: "Sign in to Codex, then reload usage.",
              expiredHint:
                "Your Codex session expired. Sign in again, then reload usage.",
              usage: { status: "unauthenticated" },
            },
          ],
        },
        {
          id: "host-intel",
          displayName: "Intel",
          status: "disconnected",
          error: null,
          providers: [
            {
              id: "claude-code",
              providerId: "claude-code",
              accountLabel: null,
              displayName: "Claude Code",
              logoUrl: "/api/v1/system/providers/claude-code/logo?h=claude",
              icon: null,
              strings: { iconTint: { light: "#D97757", dark: "#E38A6E" } },
              signInHint: "Sign in to Claude Code.",
              expiredHint: "Sign in to Claude Code again.",
              usage: null,
            },
            {
              id: "codex",
              providerId: "codex",
              accountLabel: null,
              displayName: "Codex",
              logoUrl: "/api/v1/system/providers/codex/logo?h=codex",
              icon: null,
              strings: { iconTint: null },
              signInHint: "Sign in to Codex, then reload usage.",
              expiredHint:
                "Your Codex session expired. Sign in again, then reload usage.",
              usage: null,
            },
          ],
        },
      ],
    });
    expect(host.harness.sdk.callsTo("hosts.list")).toEqual([[]]);
    expect(host.harness.sdk.callsTo("providers.list")).toEqual([
      [{ hostId: "host-m4", capability: "usage" }],
      [{ hostId: "host-intel", capability: "usage" }],
    ]);
    expect(host.harness.sdk.callsTo("plugins.callRpc")).toHaveLength(1);
    expect(host.harness.sdk.callsTo("plugins.callRpc")[0]?.[0]).toMatchObject({
      pluginId: "local-source",
      method: usageSourceMethod,
      input: { refresh: false },
    });

    await host.harness.behavior.callRpc("getUsage", {
      force: false,
      machineIds: null,
      maxAgeMs: 30 * 60_000,
    });
    expect(host.harness.sdk.callsTo("hosts.list")).toHaveLength(2);
    expect(host.harness.sdk.callsTo("providers.list")).toHaveLength(2);
    expect(host.harness.sdk.callsTo("plugins.callRpc")).toHaveLength(1);

    await host.harness.behavior.callRpc("getUsage", {
      force: true,
      machineIds: null,
      maxAgeMs: 0,
    });
    expect(host.harness.sdk.callsTo("hosts.list")).toHaveLength(3);
    expect(host.harness.sdk.callsTo("providers.list")).toHaveLength(4);
    expect(host.harness.sdk.callsTo("plugins.callRpc")).toHaveLength(2);

    await host.harness.behavior.callRpc("getUsage", {
      force: true,
      machineIds: ["host-m4"],
      maxAgeMs: 0,
    });
    expect(host.harness.sdk.callsTo("providers.list")).toHaveLength(5);
    expect(host.harness.sdk.callsTo("plugins.callRpc")).toHaveLength(3);
    expect(host.harness.sdk.callsTo("providers.list").at(-1)).toEqual([
      { hostId: "host-m4", capability: "usage" },
    ]);
  });

  it("marks only the affected machine dirty after thread completion", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-04T12:00:00.000Z"));
    const host = createFakePluginHost({
      pluginId: "provider-usage",
      sdk: {
        hosts: {
          list: async () => [
            { id: "host-m4", name: "M4", status: "connected" },
            { id: "host-m5", name: "M5", status: "connected" },
          ],
        },
        environments: {
          get: async () => ({ hostId: "host-m5" }),
        },
        providers: {
          list: async () => [],
        },
        plugins: {
          experimental_discoverRpc: async () => discovery,
          callRpc: async () => ({ resources: [] }),
        },
      },
    });
    plugin(host.bb);
    await host.harness.behavior.callRpc("getUsage", {
      force: false,
      machineIds: null,
      maxAgeMs: 30 * 60_000,
    });

    await host.harness.behavior.emitThreadEvent("thread.idle", {
      thread: makeThreadResponse({ environmentId: "environment-m5" }),
      lastAssistantText: "done",
    });
    await host.harness.behavior.emitThreadEvent("thread.failed", {
      thread: makeThreadResponse({ environmentId: "environment-m5" }),
      error: "failed",
    });
    expect(host.harness.sdk.callsTo("environments.get")).toEqual([
      [{ environmentId: "environment-m5" }],
    ]);
    expect(host.harness.sdk.callsTo("plugins.callRpc")).toHaveLength(1);

    vi.setSystemTime(new Date("2026-09-04T12:02:00.000Z"));
    await host.harness.behavior.callRpc("getUsage", {
      force: false,
      machineIds: null,
      maxAgeMs: 30 * 60_000,
    });

    expect(host.harness.sdk.callsTo("plugins.callRpc")).toHaveLength(2);
    expect(host.harness.sdk.callsTo("providers.list")).toEqual([
      [{ hostId: "host-m4", capability: "usage" }],
      [{ hostId: "host-m5", capability: "usage" }],
      [{ hostId: "host-m5", capability: "usage" }],
    ]);
    await host.harness.lifecycle.dispose();
  });
});

describe("usage source composition", () => {
  it("keeps shared accounts once, isolates failures, and removes disabled sources", async () => {
    let enabled = true;
    const host = createFakePluginHost({
      pluginId: "provider-usage",
      sdk: {
        hosts: { list: async () => [] },
        providers: {
          list: async () => [
            { id: "codex", displayName: "Codex", logoUrl: "/codex.svg" },
          ],
        },
        plugins: {
          experimental_discoverRpc: async () =>
            enabled
              ? [
                  { pluginId: "pool", method: usageSourceMethod },
                  { pluginId: "broken", method: usageSourceMethod },
                ]
              : [],
          callRpc: async ({ pluginId }) => {
            if (pluginId === "broken") throw new Error("Unavailable");
            return usageSnapshotSchema.parse({
              resources: [
                {
                  id: "account-1",
                  providerId: "codex",
                  label: "Team account",
                  scope: { kind: "shared" },
                  observedAt: 123,
                  usage: {
                    status: "ok",
                    accountEmail: "team@example.com",
                    planLabel: null,
                    windows: [
                      {
                        id: "budget",
                        label: "Budget",
                        usedPercent: 120,
                        resetsAt: null,
                        model: null,
                        cost: { usedUsdCents: 1.2, limitUsdCents: 1 },
                      },
                    ],
                  },
                },
              ],
            });
          },
        },
      },
    });
    plugin(host.bb);
    const request = { force: false, machineIds: null, maxAgeMs: 60_000 };
    const snapshot = await host.harness.behavior.callRpc("getUsage", request);
    expect(snapshot).toMatchObject({
      machines: [
        {
          id: "source:pool",
          providers: [
            {
              id: "pool:account-1",
              accountLabel: "Team account",
              providerId: "codex",
              displayName: "Codex",
              logoUrl: "/codex.svg",
              usage: {
                status: "ok",
                windows: [{ usedPercent: 120, cost: { usedUsdCents: 1.2 } }],
              },
            },
          ],
        },
        {
          id: "source:broken",
          providers: [],
          error: "Usage could not be loaded from broken.",
        },
      ],
    });
    await host.harness.behavior.callRpc("getUsage", {
      ...request,
      force: true,
      machineIds: ["source:pool"],
    });
    expect(host.harness.sdk.callsTo("plugins.callRpc")[2]?.[0]).toMatchObject({
      input: { refresh: true },
    });
    expect(host.harness.sdk.callsTo("system.usageLimits")).toEqual([]);
    enabled = false;
    await expect(
      host.harness.behavior.callRpc("getUsage", request),
    ).resolves.toEqual({ machines: [] });
    await host.harness.lifecycle.dispose();
  });
});
