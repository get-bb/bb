import {
  getEnvironment,
  getHost,
  getSessionById,
  setExperiments,
  updateHost,
} from "@bb/db";
import { defaultExperiments } from "@bb/domain";
import {
  createHostJoinCodeResponseSchema,
  type CreateHostJoinCodeResponse,
} from "@bb/server-contract";
import { describe, expect, it, vi } from "vitest";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHost,
  seedPrimaryHost,
  seedProjectWithSource,
  seedSession,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const API = "/api/v1";

function enableMultiMachine(db: Parameters<typeof setExperiments>[0]): void {
  setExperiments(db, { ...defaultExperiments, multiMachine: true });
}

async function createJoinCode(
  app: Parameters<typeof requestJoinCode>[0],
): Promise<CreateHostJoinCodeResponse> {
  const response = await requestJoinCode(app);
  expect(response.status).toBe(201);
  return createHostJoinCodeResponseSchema.parse(await readJson(response));
}

function requestJoinCode(app: {
  request: (path: string, init?: RequestInit) => Promise<Response> | Response;
}): Promise<Response> {
  return Promise.resolve(
    app.request(`${API}/hosts/join-codes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }),
  );
}

describe("public host management", () => {
  it("mints a join code that enrolls through the existing internal route", async () => {
    await withTestHarness(async (harness) => {
      enableMultiMachine(harness.db);

      const issued = await createJoinCode(harness.app);
      expect(issued.joinCode).toMatch(/^bbde_/u);
      expect(issued.expiresAt).toBeGreaterThan(Date.now());
      expect(issued.expiresAt).toBeLessThanOrEqual(Date.now() + 15 * 60 * 1000);
      // Minting must not create a host row — an unredeemed code would leave a
      // phantom offline machine in the Machines pane. The row is born at
      // enroll with the daemon-reported name.
      expect(getHost(harness.db, issued.hostId)).toBeNull();

      const enrollResponse = await harness.app.request(
        "/internal/hosts/enroll",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${issued.joinCode}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            hostId: issued.hostId,
            hostName: "Build Machine",
            hostType: "persistent",
          }),
        },
      );

      expect(enrollResponse.status).toBe(201);
      expect(getHost(harness.db, issued.hostId)).toMatchObject({
        name: "Build Machine",
        type: "persistent",
      });
    });
  });

  it("gates join-code minting when multi-machine is disabled", async () => {
    await withTestHarness(async (harness) => {
      const response = await requestJoinCode(harness.app);

      expect(response.status).toBe(400);
      expect(await readJson(response)).toMatchObject({
        code: "multi_machine_disabled",
      });
    });
  });

  it("renames a host, broadcasts it, and rejects unknown or destroyed hosts", async () => {
    await withTestHarness(async (harness) => {
      enableMultiMachine(harness.db);
      const host = seedHost(harness.deps, { id: "host_rename" });
      const notifyHost = vi.spyOn(harness.hub, "notifyHost");

      const response = await harness.app.request(`${API}/hosts/${host.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "  Renamed Machine  " }),
      });

      expect(response.status).toBe(200);
      expect(await readJson(response)).toMatchObject({
        id: host.id,
        name: "Renamed Machine",
      });
      expect(getHost(harness.db, host.id)?.name).toBe("Renamed Machine");
      expect(notifyHost).toHaveBeenCalledWith(host.id, ["host-connected"]);

      const unknownResponse = await harness.app.request(
        `${API}/hosts/host_unknown`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Unknown" }),
        },
      );
      expect(unknownResponse.status).toBe(404);

      updateHost(harness.db, harness.hub, host.id, {
        destroyedAt: Date.now(),
      });
      const destroyedResponse = await harness.app.request(
        `${API}/hosts/${host.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Too Late" }),
        },
      );
      expect(destroyedResponse.status).toBe(404);
    });
  });

  it("revokes host credentials, closes its live session, tombstones it, and preserves environments", async () => {
    await withTestHarness(async (harness) => {
      enableMultiMachine(harness.db);
      const primary = seedHost(harness.deps, { id: "host_primary" });
      seedPrimaryHost(harness.deps, primary.id);
      const host = seedHost(harness.deps, { id: "host_remove" });
      const session = seedSession(harness.deps, host.id);
      const socket = {
        close: vi.fn(),
        send: vi.fn(),
      };
      harness.hub.registerDaemon(session.id, host.id, socket);
      const project = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      }).project;
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const hostKey = await harness.deps.machineAuth.issueDaemonHostKey({
        hostId: host.id,
        hostType: "persistent",
      });
      const enrollKey = await harness.deps.machineAuth.issueHostEnrollKey({
        hostId: host.id,
        hostType: "persistent",
      });

      const response = await harness.app.request(`${API}/hosts/${host.id}`, {
        method: "DELETE",
      });

      expect(response.status).toBe(200);
      expect(await readJson(response)).toEqual({ ok: true });
      await expect(
        harness.deps.machineAuth.verifyDaemonHostKey(hostKey),
      ).resolves.toBeNull();
      expect(harness.hub.hasDaemonForHost(host.id)).toBe(false);
      expect(socket.send).toHaveBeenCalledWith(
        JSON.stringify({ type: "session-close", reason: "expired" }),
      );
      expect(socket.close).toHaveBeenCalledWith(1000, "expired");
      expect(
        getSessionById(harness.db, { sessionId: session.id }),
      ).toMatchObject({
        status: "closed",
        closeReason: "expired",
      });
      expect(getHost(harness.db, host.id)?.destroyedAt).not.toBeNull();
      expect(getEnvironment(harness.db, environment.id)).toMatchObject({
        id: environment.id,
        hostId: host.id,
      });

      const staleEnrollResponse = await harness.app.request(
        "/internal/hosts/enroll",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${enrollKey.key}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            hostId: host.id,
            hostName: host.name,
            hostType: "persistent",
          }),
        },
      );
      expect(staleEnrollResponse.status).toBe(401);

      const secondDelete = await harness.app.request(
        `${API}/hosts/${host.id}`,
        { method: "DELETE" },
      );
      expect(secondDelete.status).toBe(404);
    });
  });

  it("refuses to remove the primary host", async () => {
    await withTestHarness(async (harness) => {
      enableMultiMachine(harness.db);
      const primary = seedHost(harness.deps, { id: "host_primary" });
      seedPrimaryHost(harness.deps, primary.id);

      const response = await harness.app.request(`${API}/hosts/${primary.id}`, {
        method: "DELETE",
      });

      expect(response.status).toBe(400);
      expect(await readJson(response)).toMatchObject({
        code: "primary_host_removal_refused",
      });
      expect(getHost(harness.db, primary.id)?.destroyedAt).toBeNull();
    });
  });
});
