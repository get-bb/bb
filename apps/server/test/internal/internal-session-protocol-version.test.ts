import {
  HOST_DAEMON_PROTOCOL_VERSION,
  createHostDaemonClient,
} from "@bb/host-daemon-contract";
import { describe, expect, it } from "vitest";
import { getHost, upsertHost } from "@bb/db";
import {
  createTestDaemonHostKey,
  startTestServer,
} from "../helpers/test-app.js";

describe("internal session protocol version", () => {
  it("rejects a session open whose protocol version does not match the server", async () => {
    const server = await startTestServer();
    try {
      const hostKey = createTestDaemonHostKey({ hostId: "host-protocol" });
      upsertHost(server.db, server.hub, {
        id: "host-protocol",
        name: "Protocol Host",
        type: "persistent",
      });
      const daemonClient = createHostDaemonClient(server.baseUrl, hostKey);
      const staleProtocolVersion = HOST_DAEMON_PROTOCOL_VERSION - 1;
      const response = await daemonClient.session.open.$post({
        json: {
          hostId: "host-protocol",
          instanceId: "instance-1",
          hostName: "Protocol Host",
          hostType: "persistent",
          hasMachineCredential: false,
          platform: "darwin",
          dataDir: "/tmp/host-protocol-data",
          protocolVersion: staleProtocolVersion,
          activeThreads: [],
        },
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        code: "protocol_version_mismatch",
        message: `Daemon protocol version ${staleProtocolVersion} does not match server protocol version ${HOST_DAEMON_PROTOCOL_VERSION}`,
      });
      expect(
        getHost(server.db, "host-protocol")?.lastRejectedProtocolVersion,
      ).toBe(staleProtocolVersion);
      await expect(
        fetch(`${server.baseUrl}/api/v1/hosts/host-protocol`).then((result) =>
          result.json(),
        ),
      ).resolves.toMatchObject({
        lastRejectedProtocolVersion: staleProtocolVersion,
      });

      const accepted = await daemonClient.session.open.$post({
        json: {
          hostId: "host-protocol",
          instanceId: "instance-2",
          hostName: "Protocol Host",
          hostType: "persistent",
          hasMachineCredential: false,
          platform: "darwin",
          dataDir: "/tmp/host-protocol-data",
          protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
          activeThreads: [],
        },
      });
      expect(accepted.status).toBe(201);
      expect(
        getHost(server.db, "host-protocol")?.lastRejectedProtocolVersion,
      ).toBeNull();
      await expect(
        fetch(`${server.baseUrl}/api/v1/hosts/host-protocol`).then((result) =>
          result.json(),
        ),
      ).resolves.toMatchObject({ lastRejectedProtocolVersion: null });
    } finally {
      await server.close();
    }
  });
});
