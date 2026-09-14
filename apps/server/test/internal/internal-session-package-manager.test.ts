import { HOST_DAEMON_PROTOCOL_VERSION } from "@bb/host-daemon-contract";
import { getHost, updateHost, upsertHost } from "@bb/db";
import { describe, expect, it } from "vitest";
import {
  createTestDaemonHostKey,
  startTestServer,
} from "../helpers/test-app.js";

async function openSession(
  server: Awaited<ReturnType<typeof startTestServer>>,
  args: {
    hostId: string;
    hostKey: string;
    instanceId: string;
    packageManagerOverride?: "auto" | "mise" | "npm" | null;
  },
): Promise<Response> {
  return fetch(`${server.baseUrl}/internal/session/open`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${args.hostKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      hostId: args.hostId,
      instanceId: args.instanceId,
      hostName: "Package Manager Host",
      hasMachineCredential: false,
      platform: "darwin",
      dataDir: `/tmp/${args.hostId}`,
      localApiPort: null,
      protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
      activeThreads: [],
      loadedEnvironments: [],
      ...(args.packageManagerOverride === undefined
        ? {}
        : { packageManagerOverride: args.packageManagerOverride }),
    }),
  });
}

describe("internal session package manager", () => {
  it("stores the daemon override and returns the effective package manager", async () => {
    const server = await startTestServer();
    try {
      const hostId = "host-package-manager";
      const hostKey = createTestDaemonHostKey({ hostId });
      upsertHost(server.db, server.hub, { id: hostId, name: "PM Host" });
      updateHost(server.db, server.hub, hostId, { packageManager: "mise" });

      const overridden = await openSession(server, {
        hostId,
        hostKey,
        instanceId: "instance-pm-1",
        packageManagerOverride: "npm",
      });
      expect(overridden.status).toBe(201);
      await expect(overridden.json()).resolves.toMatchObject({
        packageManager: "npm",
      });
      expect(getHost(server.db, hostId)).toMatchObject({
        packageManager: "mise",
        packageManagerOverride: "npm",
      });

      const cleared = await openSession(server, {
        hostId,
        hostKey,
        instanceId: "instance-pm-2",
        packageManagerOverride: null,
      });
      expect(cleared.status).toBe(201);
      await expect(cleared.json()).resolves.toMatchObject({
        packageManager: "mise",
      });
      expect(getHost(server.db, hostId)?.packageManagerOverride).toBeNull();

      const omitted = await openSession(server, {
        hostId,
        hostKey,
        instanceId: "instance-pm-3",
      });
      expect(omitted.status).toBe(201);
      await expect(omitted.json()).resolves.toMatchObject({
        packageManager: "mise",
      });
    } finally {
      await server.close();
    }
  });
});
