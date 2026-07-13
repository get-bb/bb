import { createConnection, migrate, noopNotifier, upsertHost } from "@bb/db";
import {
  HOST_DAEMON_PROTOCOL_VERSION,
  hostDaemonServerWsMessageSchema,
  hostDaemonSessionOpenResponseSchema,
} from "@bb/host-daemon-contract";
import { describe, expect, it } from "vitest";
import { HostSharedPortCoordinator } from "../../src/ws/host-shared-ports.js";
import { NotificationHub } from "../../src/ws/hub.js";
import { readJson } from "../helpers/json.js";
import { createMockHubSocket } from "../helpers/mock-hub-socket.js";
import {
  createTestDaemonHostKey,
  withTestHarness,
} from "../helpers/test-app.js";

function setup() {
  const db = createConnection(":memory:");
  migrate(db);
  const hub = new NotificationHub();
  const sharedPorts = new HostSharedPortCoordinator({ db, hub });
  const host = upsertHost(db, noopNotifier, {
    id: "host-1",
    name: "test-host",
    type: "persistent",
  });
  return { db, host, hub, sharedPorts };
}

describe("HostSharedPortCoordinator", () => {
  it("reconciles at session open and pushes only changed desired sets", () => {
    const { host, hub, sharedPorts } = setup();
    const daemonSocket = createMockHubSocket();
    hub.registerDaemon("session-1", host.id, daemonSocket);

    expect(sharedPorts.reconcileSharedPortsForHost(host.id)).toEqual({
      generation: 0,
      ports: [],
      tunnel: null,
    });

    const first = sharedPorts.declareSharedPorts({
      ownerId: "connect",
      hostId: host.id,
      ports: [8080, 3000, 8080],
      tunnel: { label: "sawyer-air", baseDomain: "getbb.app" },
    });
    expect(first).toEqual({
      generation: 1,
      ports: [3000, 8080],
      tunnel: { label: "sawyer-air", baseDomain: "getbb.app" },
    });
    expect(daemonSocket.messages).toHaveLength(1);
    expect(
      hostDaemonServerWsMessageSchema.parse(
        JSON.parse(daemonSocket.messages[0]!),
      ),
    ).toEqual({ type: "connect-shares.replace", ...first });

    // An identical plugin re-declaration is a no-op and retains generation.
    expect(
      sharedPorts.declareSharedPorts({
        ownerId: "connect",
        hostId: host.id,
        ports: [3000, 8080],
        tunnel: { label: "sawyer-air", baseDomain: "getbb.app" },
      }),
    ).toEqual(first);
    expect(daemonSocket.messages).toHaveLength(1);

    sharedPorts.clearDeclarationsForOwner("connect");
    expect(daemonSocket.messages).toHaveLength(2);
    expect(
      hostDaemonServerWsMessageSchema.parse(
        JSON.parse(daemonSocket.messages[1]!),
      ),
    ).toEqual({
      type: "connect-shares.replace",
      generation: 2,
      ports: [],
      tunnel: null,
    });
  });

  it("rejects unknown hosts and conflicting tunnel identities", () => {
    const { host, sharedPorts } = setup();

    expect(() =>
      sharedPorts.declareSharedPorts({
        ownerId: "connect",
        hostId: "missing-host",
        ports: [3000],
        tunnel: null,
      }),
    ).toThrow(/unknown host missing-host/);

    sharedPorts.declareSharedPorts({
      ownerId: "connect",
      hostId: host.id,
      ports: [3000],
      tunnel: { label: "sawyer-air", baseDomain: "getbb.app" },
    });
    expect(() =>
      sharedPorts.declareSharedPorts({
        ownerId: "other-plugin",
        hostId: host.id,
        ports: [8080],
        tunnel: { label: "different", baseDomain: "getbb.app" },
      }),
    ).toThrow(/conflicting tunnel identities/);
    expect(sharedPorts.reconcileSharedPortsForHost(host.id)).toMatchObject({
      generation: 1,
      ports: [3000],
      tunnel: { label: "sawyer-air" },
    });
  });
});

describe("daemon session connect shares", () => {
  it("includes the current set in the session-open response", async () => {
    await withTestHarness(async (harness) => {
      upsertHost(harness.db, harness.hub, {
        id: "host-1",
        name: "Host",
        type: "persistent",
      });
      harness.deps.sharedPorts.declareSharedPorts({
        ownerId: "connect",
        hostId: "host-1",
        ports: [4173],
        tunnel: { label: "sawyer-air", baseDomain: "getbb.app" },
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
        connectShares: {
          generation: 1,
          ports: [4173],
          tunnel: { label: "sawyer-air", baseDomain: "getbb.app" },
        },
      });
    });
  });

  it("pushes a higher generation when plugin load follows session open", async () => {
    await withTestHarness(async (harness) => {
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
      expect(session.connectShares).toEqual({
        generation: 0,
        ports: [],
        tunnel: null,
      });

      const daemonSocket = createMockHubSocket();
      harness.hub.registerDaemon(session.sessionId, "host-1", daemonSocket);
      harness.deps.sharedPorts.declareSharedPorts({
        ownerId: "connect",
        hostId: "host-1",
        ports: [4173],
        tunnel: { label: "sawyer-air", baseDomain: "getbb.app" },
      });

      expect(daemonSocket.messages).toHaveLength(1);
      expect(
        hostDaemonServerWsMessageSchema.parse(
          JSON.parse(daemonSocket.messages[0]!),
        ),
      ).toEqual({
        type: "connect-shares.replace",
        generation: 1,
        ports: [4173],
        tunnel: { label: "sawyer-air", baseDomain: "getbb.app" },
      });
    });
  });
});
