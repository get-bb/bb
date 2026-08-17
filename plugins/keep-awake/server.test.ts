import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";
import plugin from "./server.js";

type HostChangedSubscription = Extract<
  Parameters<BbPluginApi["sdk"]["subscribe"]>[0],
  { event: "host:changed" }
>;
type HostChangedEvent = Parameters<HostChangedSubscription["callback"]>[0];
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
  subscribe: BbPluginApi["sdk"]["subscribe"];
} {
  let hostCallback: HostChangedSubscription["callback"] | null = null;
  let realtimeCallback: RealtimeConnectionSubscription["callback"] | null =
    null;
  const subscribe = (args: SdkSubscription): (() => void) => {
    if (isHostChangedSubscription(args)) hostCallback = args.callback;
    if (isRealtimeConnectionSubscription(args))
      realtimeCallback = args.callback;
    return () => {
      if (isHostChangedSubscription(args)) hostCallback = null;
      if (isRealtimeConnectionSubscription(args)) realtimeCallback = null;
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
    subscribe,
  };
}

describe("builtin Keep Awake server entry", () => {
  it("keeps all hosts awake or only the selected hosts", async () => {
    const subscriptions = lifecycleSubscriptions();
    const host = createFakePluginHost({
      pluginId: "keep-awake",
      settings: { enabled: true },
      sdk: {
        subscribe: subscriptions.subscribe,
        hosts: {
          list: async () => [hostRecord("host-1"), hostRecord("host-2")],
        },
      },
      experimental_callHostRpc: ({ input }) => ({
        enabled: enabledInput(input),
        supported: true,
      }),
    });
    await plugin(host.bb);

    expect(host.harness.registrations.settingsDescriptors).toEqual({
      enabled: {
        type: "boolean",
        label: "Keep hosts awake",
        description:
          "Prevent idle sleep on the selected Macs while bb is running. Closing the lid or choosing Sleep still sleeps the Mac.",
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
        hostId: "host-1",
      },
      {
        method: "setEnabled",
        input: { enabled: true },
        hostId: "host-2",
      },
    ]);

    await expect(
      host.harness.callRpc("setHostSelection", {
        mode: "selected",
        hostIds: ["host-2"],
      }),
    ).resolves.toMatchObject({
      selection: { mode: "selected", hostIds: ["host-2"] },
    });
    await expect(host.bb.storage.kv.get("host-selection")).resolves.toEqual({
      mode: "selected",
      hostIds: ["host-2"],
    });
    await vi.waitFor(() => {
      expect(host.harness.experimental_hostRpcCalls).toHaveLength(4);
    });
    expect(host.harness.experimental_hostRpcCalls.slice(2)).toMatchObject([
      { input: { enabled: false }, hostId: "host-1" },
      { input: { enabled: true }, hostId: "host-2" },
    ]);

    await host.harness.setSettings({ enabled: false });
    await vi.waitFor(() => {
      expect(host.harness.experimental_hostRpcCalls).toHaveLength(6);
    });
    expect(host.harness.experimental_hostRpcCalls.slice(4)).toMatchObject([
      { input: { enabled: false }, hostId: "host-1" },
      { input: { enabled: false }, hostId: "host-2" },
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
      },
      experimental_callHostRpc: () => ({ enabled: true, supported: true }),
    });
    await plugin(host.bb);
    const running = host.harness.runService("desired-state-reconciler");
    await vi.waitFor(() => {
      expect(host.harness.inspection.sdk.callsTo("hosts.list")).toHaveLength(1);
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

  it("reconciles immediately after its host worker exits unexpectedly", async () => {
    const subscriptions = lifecycleSubscriptions();
    const host = createFakePluginHost({
      pluginId: "keep-awake",
      settings: { enabled: true },
      sdk: {
        subscribe: subscriptions.subscribe,
        hosts: { list: async () => [hostRecord("host-1")] },
      },
      experimental_callHostRpc: () => ({ enabled: true, supported: true }),
    });
    await plugin(host.bb);
    const running = host.harness.runService("desired-state-reconciler");
    await vi.waitFor(() => {
      expect(host.harness.experimental_hostRpcCalls).toHaveLength(1);
    });

    await host.harness.experimental_emitHostWorkerExit("host-1");

    await vi.waitFor(() => {
      expect(host.harness.experimental_hostRpcCalls).toHaveLength(2);
    });
    expect(host.harness.logEntries).toContainEqual({
      level: "warn",
      message:
        "Keep Awake host worker exited unexpectedly on host host-1; retrying",
    });

    running.controller.abort();
    await running.done;
    await host.harness.dispose();
  });

  it("loads its host selection from plugin KV and exposes CLI parity", async () => {
    const host = createFakePluginHost({
      pluginId: "keep-awake",
      sdk: {
        hosts: {
          list: async () => [hostRecord("host-1"), hostRecord("host-2")],
        },
      },
    });
    await host.bb.storage.kv.set("host-selection", {
      mode: "selected",
      hostIds: ["host-2"],
    });
    await plugin(host.bb);

    await expect(host.harness.callRpc("getHostConfiguration")).resolves.toEqual(
      {
        selection: { mode: "selected", hostIds: ["host-2"] },
        hosts: [
          { id: "host-1", name: "host-1", status: "connected" },
          { id: "host-2", name: "host-2", status: "connected" },
        ],
      },
    );
    await expect(
      host.harness.runCli(["hosts", "all", "--json"]),
    ).resolves.toMatchObject({
      exitCode: 0,
      stdout: JSON.stringify({ mode: "all" }),
    });
    await expect(host.bb.storage.kv.get("host-selection")).resolves.toEqual({
      mode: "all",
    });
    await expect(
      host.harness.runCli(["hosts", "host-1", "host-2"]),
    ).resolves.toMatchObject({
      exitCode: 0,
      stdout: "host-1\nhost-2",
    });

    await host.harness.dispose();
  });

  it("falls back to all hosts when plugin KV contains an invalid selection", async () => {
    const host = createFakePluginHost({
      pluginId: "keep-awake",
      sdk: { hosts: { list: async () => [] } },
    });
    await host.bb.storage.kv.set("host-selection", {
      mode: "selected",
      hostIds: [],
    });
    await plugin(host.bb);

    await expect(host.harness.callRpc("getHostConfiguration")).resolves.toEqual(
      {
        selection: { mode: "all" },
        hosts: [],
      },
    );

    await host.harness.dispose();
  });
});
