import {
  HOST_DAEMON_PROTOCOL_VERSION,
  createHostDaemonClient,
} from "@bb/host-daemon-contract";
import { describe, expect, it } from "vitest";
import {
  createTestDaemonHostKey,
  startTestServer,
} from "../helpers/test-app.js";

describe("internal session protocol version", () => {
  it("rejects a session open whose protocol version does not match the server", async () => {
    const server = await startTestServer();
    try {
      const hostKey = createTestDaemonHostKey({ hostId: "host-protocol" });
      const daemonClient = createHostDaemonClient(server.baseUrl, hostKey);
      const staleProtocolVersion = HOST_DAEMON_PROTOCOL_VERSION - 1;
      const response = await daemonClient.session.open.$post({
        json: {
          hostId: "host-protocol",
          instanceId: "instance-1",
          hostName: "Protocol Host",
          hostType: "persistent",
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
    } finally {
      await server.close();
    }
  });
});
