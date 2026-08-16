import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";
import plugin from "./server.js";

type HostChangedSubscription = Extract<
  Parameters<BbPluginApi["sdk"]["subscribe"]>[0],
  { event: "host:changed" }
>;
type HostChangedEvent = Parameters<HostChangedSubscription["callback"]>[0];
type SystemConfigSubscription = Extract<
  Parameters<BbPluginApi["sdk"]["subscribe"]>[0],
  { event: "system:config-changed" }
>;
type SystemConfigEvent = Parameters<SystemConfigSubscription["callback"]>[0];
type RealtimeConnectionSubscription = Extract<
  Parameters<BbPluginApi["sdk"]["subscribe"]>[0],
  { event: "realtime:connection" }
>;
type SdkSubscription = Parameters<BbPluginApi["sdk"]["subscribe"]>[0];
type HostRecord = Awaited<
  ReturnType<BbPluginApi["sdk"]["hosts"]["list"]>
>[number];

function isHostChangedSubscription(
  subscription: SdkSubscription,
): subscription is HostChangedSubscription {
  return subscription.event === "host:changed";
}

function isSystemConfigSubscription(
  subscription: SdkSubscription,
): subscription is SystemConfigSubscription {
  return subscription.event === "system:config-changed";
}

function isRealtimeConnectionSubscription(
  subscription: SdkSubscription,
): subscription is RealtimeConnectionSubscription {
  return subscription.event === "realtime:connection";
}

function hostRecord(
  id: string,
  status: HostRecord["status"] = "connected",
): HostRecord {
  return {
    id,
    name: id,
    type: "persistent",
    status,
    maxPermissionMode: "full",
    lastSeenAt: null,
    lastRejectedProtocolVersion: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

function enabledInput(input: unknown): boolean {
  if (typeof input !== "object" || input === null) {
    throw new Error("expected host RPC input object");
  }
  const enabled = Reflect.get(input, "enabled");
  if (typeof enabled !== "boolean") {
    throw new Error("expected host RPC enabled boolean");
  }
  return enabled;
}

function lifecycleSubscriptions(): {
  emitHost(changes: HostChangedEvent["changes"]): void;
  emitReconnect(): void;
  emitSystemConfig(): void;
  subscribe: BbPluginApi["sdk"]["subscribe"];
} {
  let hostCallback: HostChangedSubscription["callback"] | null = null;
  let realtimeCallback: RealtimeConnectionSubscription["callback"] | null =
    null;
  let systemConfigCallback: SystemConfigSubscription["callback"] | null = null;
  const subscribe = (args: SdkSubscription): (() => void) => {
    if (isHostChangedSubscription(args)) hostCallback = args.callback;
    if (isRealtimeConnectionSubscription(args))
      realtimeCallback = args.callback;
    if (isSystemConfigSubscription(args)) systemConfigCallback = args.callback;
    return () => {
      if (isHostChangedSubscription(args)) hostCallback = null;
      if (isRealtimeConnectionSubscription(args)) realtimeCallback = null;
      if (isSystemConfigSubscription(args)) systemConfigCallback = null;
    };
  };
  return {
    emitHost(changes) {
      hostCallback?.({
        type: "changed",
        entity: "host",
        id: "host-1",
        changes,
      });
    },
    emitReconnect() {
      realtimeCallback?.({
        reconnectDelayMs: null,
        reconnected: true,
        state: "connected",
      });
    },
    emitSystemConfig() {
      const event: SystemConfigEvent = {
        type: "changed",
        entity: "system",
        changes: ["config-changed"],
      };
      systemConfigCallback?.(event);
    },
    subscribe,
  };
}

describe("builtin Keep Awake server entry", () => {
  it("owns its setting and reconciles it to the primary host", async () => {
    const subscriptions = lifecycleSubscriptions();
    let primaryHostId = "host-1";
    const host = createFakePluginHost({
      pluginId: "keep-awake",
      settings: { enabled: true },
      sdk: {
        subscribe: subscriptions.subscribe,
        hosts: {
          list: async () => [hostRecord("host-1"), hostRecord("host-2")],
        },
        system: { config: async () => ({ primaryHostId }) },
      },
      experimental_callHostRpc: ({ input }) => ({
        enabled: enabledInput(input),
        supported: true,
      }),
    });
    plugin(host.bb);

    expect(host.harness.registrations.settingsDescriptors).toEqual({
      enabled: {
        type: "boolean",
        label: "Keep this Mac awake",
        description:
          "Prevent system idle sleep while bb is running. Closing the lid or choosing Sleep still sleeps the Mac.",
        default: false,
      },
    });
    const running = host.harness.runService("desired-state-reconciler");
    await vi.waitFor(() => {
      expect(host.harness.experimental_hostRpcCalls).toHaveLength(2);
    });
    expect(host.harness.experimental_hostRpcCalls).toMatchObject([
      {
        method: "setEnabled",
        input: { enabled: true },
        target: { hostId: "host-1" },
      },
      {
        method: "setEnabled",
        input: { enabled: false },
        target: { hostId: "host-2" },
      },
    ]);

    primaryHostId = "host-2";
    subscriptions.emitSystemConfig();
    await vi.waitFor(() => {
      expect(host.harness.experimental_hostRpcCalls).toHaveLength(4);
    });
    expect(host.harness.experimental_hostRpcCalls.slice(2)).toMatchObject([
      { input: { enabled: false }, target: { hostId: "host-1" } },
      { input: { enabled: true }, target: { hostId: "host-2" } },
    ]);

    await host.harness.setSettings({ enabled: false });
    await vi.waitFor(() => {
      expect(host.harness.experimental_hostRpcCalls).toHaveLength(6);
    });
    expect(host.harness.experimental_hostRpcCalls.slice(4)).toMatchObject([
      { input: { enabled: false }, target: { hostId: "host-1" } },
      { input: { enabled: false }, target: { hostId: "host-2" } },
    ]);

    subscriptions.emitReconnect();
    await vi.waitFor(() => {
      expect(host.harness.experimental_hostRpcCalls).toHaveLength(8);
    });

    running.controller.abort();
    await running.done;
    await host.harness.dispose();
  });

  it("reconciles when a host connects after startup", async () => {
    const subscriptions = lifecycleSubscriptions();
    let status: HostRecord["status"] = "disconnected";
    const host = createFakePluginHost({
      pluginId: "keep-awake",
      settings: { enabled: true },
      sdk: {
        subscribe: subscriptions.subscribe,
        hosts: { list: async () => [hostRecord("host-1", status)] },
        system: { config: async () => ({ primaryHostId: "host-1" }) },
      },
      experimental_callHostRpc: () => ({ enabled: true, supported: true }),
    });
    plugin(host.bb);
    const running = host.harness.runService("desired-state-reconciler");
    await vi.waitFor(() => {
      expect(host.harness.inspection.sdk.callsTo("system.config")).toHaveLength(
        1,
      );
    });
    expect(host.harness.experimental_hostRpcCalls).toHaveLength(0);

    status = "connected";
    subscriptions.emitHost(["host-connected"]);
    await vi.waitFor(() => {
      expect(host.harness.experimental_hostRpcCalls).toHaveLength(1);
    });

    running.controller.abort();
    await running.done;
    await host.harness.dispose();
  });
});
