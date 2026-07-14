import {
  createConnection,
  migrate,
  noopNotifier,
  openSession,
  upsertHost,
} from "@bb/db";
import {
  HOST_DAEMON_PROTOCOL_VERSION,
  hostDaemonServerWsMessageSchema,
  hostDaemonSessionOpenResponseSchema,
} from "@bb/host-daemon-contract";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../src/errors.js";
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

function setup(args: { enrolled?: boolean; online?: boolean } = {}) {
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
  if (args.enrolled !== false && args.online !== false) {
    const session = openSession(db, noopNotifier, {
      hostId: host.id,
      instanceId: "instance-1",
      hostName: host.name,
      hostType: host.type,
      dataDir: "/tmp/host-data",
      protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
      heartbeatIntervalMs: 30_000,
      leaseTimeoutMs: 90_000,
    });
    sharedPorts.recordHostConnectCapability({
      hostId: host.id,
      sessionId: session.id,
      hasMachineCredential: true,
    });
    return { db, host, hub, session, sharedPorts };
  }
  return { db, host, hub, session: null, sharedPorts };
}

describe("HostSharedPortCoordinator", () => {
  it("aggregates owner replacements and pushes only changed desired sets", () => {
    const { host, hub, session, sharedPorts } = setup();
    const daemonSocket = createMockHubSocket();
    if (!session) {
      throw new Error("expected an enrolled setup session");
    }
    hub.registerDaemon(session.id, host.id, daemonSocket);

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

  it("distinguishes unknown, unenrolled, and enrolled-but-offline hosts", () => {
    const { sharedPorts } = setup();
    expect(() =>
      sharedPorts.declareSharedPorts({
        ownerId: "connect",
        hostId: "missing-host",
        ports: [3000],
      }),
    ).toThrow(/unknown host missing-host/);

    const credentialless = setup({ enrolled: false });
    let unenrolledError: unknown;
    try {
      credentialless.sharedPorts.declareSharedPorts({
        ownerId: "connect",
        hostId: credentialless.host.id,
        ports: [3000],
      });
    } catch (error) {
      unenrolledError = error;
    }
    expect(unenrolledError).toBeInstanceOf(ApiError);
    expect(unenrolledError).toMatchObject({
      body: {
        code: "connect_host_unenrolled",
        message: expect.stringContaining("enroll it via Connect"),
      },
    });

    const offline = setup({ online: false });
    let offlineError: unknown;
    try {
      offline.sharedPorts.declareSharedPorts({
        ownerId: "connect",
        hostId: offline.host.id,
        ports: [3000],
      });
    } catch (error) {
      offlineError = error;
    }
    expect(offlineError).toBeInstanceOf(ApiError);
    expect(offlineError).toMatchObject({
      body: {
        code: "connect_host_offline",
        message: expect.stringContaining("bring the host online"),
      },
    });
    if (!(offlineError instanceof ApiError)) {
      throw new Error("expected an ApiError for the offline host");
    }
    expect(offlineError.body.message).not.toMatch(/remove and re-add|enroll/i);
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
      const previousSession = openSession(harness.db, harness.hub, {
        hostId: "host-1",
        instanceId: "previous-instance",
        hostName: "Host",
        hostType: "persistent",
        dataDir: "/tmp/host-data",
        protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
        heartbeatIntervalMs: 30_000,
        leaseTimeoutMs: 90_000,
      });
      harness.deps.sharedPorts.recordHostConnectCapability({
        hostId: "host-1",
        sessionId: previousSession.id,
        hasMachineCredential: true,
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
          hasMachineCredential: true,
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
          hasMachineCredential: true,
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

  it("rejects declarations when the current session lacks its persisted machine credential", async () => {
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
          instanceId: "restarted-without-credential",
          hostName: "Host",
          hostType: "persistent",
          hasMachineCredential: false,
          platform: "darwin",
          dataDir: "/tmp/host-data",
          protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
          activeThreads: [],
        }),
      });
      expect(response.status).toBe(201);
      const session = hostDaemonSessionOpenResponseSchema.parse(
        await response.json(),
      );
      const daemonSocket = createMockHubSocket();
      onDaemonSocketOpen(harness.deps, {
        hostId: "host-1",
        sessionId: session.sessionId,
        socket: daemonSocket,
      });
      const messagesBeforeDeclaration = [...daemonSocket.messages];

      expect(() =>
        harness.deps.sharedPorts.declareSharedPorts({
          ownerId: "connect",
          hostId: "host-1",
          ports: [4173],
        }),
      ).toThrow(
        'cannot share ports from host "Host" (host-1) because it has no bb connect machine credential; enroll it via Connect in Settings > Machines',
      );
      expect(daemonSocket.messages).toEqual(messagesBeforeDeclaration);
      expect(
        harness.deps.sharedPorts.reconcileSharedPortsForHost("host-1"),
      ).toEqual({ generation: 0, ports: [] });
    });
  });
});
