import { createConnection, migrate, noopNotifier, upsertHost } from "@bb/db";
import {
  HOST_DAEMON_PROTOCOL_VERSION,
  hostDaemonServerWsMessageSchema,
  hostDaemonSessionOpenResponseSchema,
} from "@bb/host-daemon-contract";
import { describe, expect, it } from "vitest";
import { HostSharedPortCoordinator } from "../../src/ws/host-shared-ports.js";
import { NotificationHub } from "../../src/ws/hub.js";
import {
  onDaemonSocketMessage,
  onDaemonSocketOpen,
} from "../../src/ws/daemon-protocol.js";
import { readJson } from "../helpers/json.js";
import { createMockHubSocket } from "../helpers/mock-hub-socket.js";
import {
  createTestDaemonHostKey,
  withTestHarness,
} from "../helpers/test-app.js";

function setup(args: { enrolled?: boolean } = {}) {
  const db = createConnection(":memory:");
  migrate(db);
  const hub = new NotificationHub();
  const sharedPorts = new HostSharedPortCoordinator({ db, hub });
  const host = upsertHost(db, noopNotifier, {
    id: "host-1",
    name: "test-host",
    type: "persistent",
    ...(args.enrolled === false ? {} : { connectMachineId: "machine-1" }),
  });
  return { db, host, hub, sharedPorts };
}

describe("HostSharedPortCoordinator", () => {
  it("aggregates owner replacements and pushes only changed desired sets", () => {
    const { host, hub, sharedPorts } = setup();
    const daemonSocket = createMockHubSocket();
    hub.registerDaemon("session-1", host.id, daemonSocket);

    expect(sharedPorts.reconcileSharedPortsForHost(host.id)).toEqual({
      generation: 0,
      ports: [],
    });

    const first = sharedPorts.declareSharedPorts({
      ownerId: "connect",
      hostId: host.id,
      ports: [8080, 3000, 8080],
    });
    expect(first).toEqual({ generation: 1, ports: [3000, 8080] });
    expect(
      hostDaemonServerWsMessageSchema.parse(
        JSON.parse(daemonSocket.messages[0]!),
      ),
    ).toEqual({ type: "connect-shares.replace", ...first });

    // Current-state replacement for one owner removes 3000 while another
    // owner contributes 4173.
    sharedPorts.declareSharedPorts({
      ownerId: "other-plugin",
      hostId: host.id,
      ports: [4173],
    });
    const replacement = sharedPorts.declareSharedPorts({
      ownerId: "connect",
      hostId: host.id,
      ports: [8080],
    });
    expect(replacement).toEqual({ generation: 3, ports: [4173, 8080] });

    // Identical replacement is a no-op and retains generation.
    expect(
      sharedPorts.declareSharedPorts({
        ownerId: "connect",
        hostId: host.id,
        ports: [8080],
      }),
    ).toEqual(replacement);
    expect(daemonSocket.messages).toHaveLength(3);

    sharedPorts.clearDeclarationsForOwner("connect");
    expect(sharedPorts.reconcileSharedPortsForHost(host.id)).toEqual({
      generation: 4,
      ports: [4173],
    });
  });

  it("fails fast for unknown or credential-less hosts", () => {
    const { sharedPorts } = setup();
    expect(() =>
      sharedPorts.declareSharedPorts({
        ownerId: "connect",
        hostId: "missing-host",
        ports: [3000],
      }),
    ).toThrow(/unknown host missing-host/);

    const credentialless = setup({ enrolled: false });
    expect(() =>
      credentialless.sharedPorts.declareSharedPorts({
        ownerId: "connect",
        hostId: credentialless.host.id,
        ports: [3000],
      }),
    ).toThrow(
      'cannot share ports from host "test-host" (host-1) because it has no bb connect machine credential; remove and re-add the machine from Settings > Machines',
    );
  });

  it("stores only daemon-reported tunnel identity", () => {
    const { host, sharedPorts } = setup();
    expect(sharedPorts.getTunnelIdentity(host.id)).toBeNull();
    expect(
      sharedPorts.recordTunnelIdentity(host.id, {
        label: "sawyer-air",
        baseDomain: "getbb.app",
      }),
    ).toEqual({ label: "sawyer-air", baseDomain: "getbb.app" });
    expect(sharedPorts.getTunnelIdentity(host.id)).toEqual({
      label: "sawyer-air",
      baseDomain: "getbb.app",
    });
  });
});

describe("daemon session connect shares", () => {
  it("includes the current authoritative set in the session-open response", async () => {
    await withTestHarness(async (harness) => {
      upsertHost(harness.db, harness.hub, {
        id: "host-1",
        name: "Host",
        type: "persistent",
        connectMachineId: "machine-1",
      });
      harness.deps.sharedPorts.declareSharedPorts({
        ownerId: "connect",
        hostId: "host-1",
        ports: [4173],
      });

      const response = await harness.app.request("/internal/session/open", {
        method: "POST",
        headers: {
          authorization: `Bearer ${createTestDaemonHostKey({ hostId: "host-1" })}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          hostId: "host-1",
          instanceId: "instance-1",
          hostName: "Host",
          hostType: "persistent",
          platform: "darwin",
          dataDir: "/tmp/host-data",
          protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
          activeThreads: [],
        }),
      });

      expect(response.status).toBe(201);
      await expect(readJson(response)).resolves.toMatchObject({
        connectShares: { generation: 1, ports: [4173] },
      });
    });
  });

  it("reconciles a declaration made after HTTP open but before WebSocket registration", async () => {
    await withTestHarness(async (harness) => {
      upsertHost(harness.db, harness.hub, {
        id: "host-1",
        name: "Host",
        type: "persistent",
        connectMachineId: "machine-1",
      });
      const response = await harness.app.request("/internal/session/open", {
        method: "POST",
        headers: {
          authorization: `Bearer ${createTestDaemonHostKey({ hostId: "host-1" })}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          hostId: "host-1",
          instanceId: "instance-1",
          hostName: "Host",
          hostType: "persistent",
          platform: "darwin",
          dataDir: "/tmp/host-data",
          protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
          activeThreads: [],
        }),
      });
      const session = hostDaemonSessionOpenResponseSchema.parse(
        await response.json(),
      );
      expect(session.connectShares).toEqual({ generation: 0, ports: [] });

      // No daemon socket exists yet, so this immediate publication cannot be
      // delivered. Socket-open reconciliation must recover it.
      harness.deps.sharedPorts.declareSharedPorts({
        ownerId: "connect",
        hostId: "host-1",
        ports: [4173],
      });
      const daemonSocket = createMockHubSocket();
      onDaemonSocketOpen(harness.deps, {
        hostId: "host-1",
        sessionId: session.sessionId,
        socket: daemonSocket,
      });

      expect(
        daemonSocket.messages.map((message) => JSON.parse(message)),
      ).toContainEqual({
        type: "connect-shares.replace",
        generation: 1,
        ports: [4173],
      });

      onDaemonSocketMessage(harness.deps, {
        hostId: "host-1",
        sessionId: session.sessionId,
        socket: daemonSocket,
        raw: JSON.stringify({
          type: "connect-tunnel.identity",
          identity: { label: "sawyer-air", baseDomain: "getbb.app" },
        }),
      });
      expect(harness.deps.sharedPorts.getTunnelIdentity("host-1")).toEqual({
        label: "sawyer-air",
        baseDomain: "getbb.app",
      });
    });
  });
});
