import {
  getEnvironment,
  getHost,
  hosts,
  getSessionById,
  getStoredProviderModelCatalog,
  getThread,
  listStoredTurnCompletedKeys,
  replaceStoredProviderModelCatalog,
  updateHost,
} from "@bb/db";
import {
  createHostJoinCodeResponseSchema,
  type CreateHostJoinCodeResponse,
} from "@bb/server-contract";
import {
  HOST_DAEMON_PROTOCOL_VERSION,
  hostDaemonSessionOpenResponseSchema,
} from "@bb/host-daemon-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { setPluginMachineProviderBridge } from "../../src/services/plugins/plugin-machine-provider-registry.js";
import { setServerAccessBridge } from "../../src/services/plugins/plugin-server-access-registry.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHost,
  seedPrimaryHost,
  seedProjectWithSource,
  seedSession,
  seedThread,
  seedTurnStarted,
} from "../helpers/seed.js";
import { installMachineProvider } from "../helpers/machine-provider.js";
import { withTestHarness } from "../helpers/test-app.js";

const API = "/api/v1";

afterEach(() => {
  setPluginMachineProviderBridge(undefined);
  setServerAccessBridge(undefined);
});

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
  it("reconnects a machine by re-enrolling it, replacing access only when the installer runs", async () => {
    await withTestHarness(async (harness) => {
      const host = seedHost(harness.deps, { id: "host_reconnect" });
      harness.db
        .update(hosts)
        .set({
          serverAccessProviderId: "relay",
          serverAccessGrantId: host.id,
        })
        .where(eq(hosts.id, host.id))
        .run();
      let accessToken = "old-access";
      const release = vi.fn(async () => {
        accessToken = "new-access";
      });
      const provider = {
        id: "relay",
        displayName: "Relay",
        description: "Test relay",
        availability: () => ({ status: "available" as const }),
        acquire: async () => ({
          id: host.id,
          serverUrl: "https://relay.example.com",
          headers: { "x-access-token": accessToken },
        }),
        release,
      };
      setServerAccessBridge({
        list: () => [{ pluginId: "test", provider }],
        invoke: async (_id, run) => run(),
      });
      const session = seedSession(harness.deps, host.id);
      harness.hub.registerDaemon(session.id, host.id, {
        close: vi.fn(),
        send: vi.fn(),
      });
      const reconnect = () =>
        harness.app.request(`${API}/hosts/${host.id}/reconnect-commands`, {
          method: "POST",
        });

      const refused = await reconnect();
      expect(refused.status).toBe(409);
      expect(await readJson(refused)).toMatchObject({
        code: "machine_reconnect_not_needed",
      });
      harness.hub.unregisterDaemon(session.id);

      const stale = await reconnect();
      expect(stale.status).toBe(201);
      const response = await reconnect();
      expect(response.status).toBe(201);
      const prepared = (await readJson(response)) as {
        command: string;
        expiresAt: number;
        hostId: string;
      };
      expect(prepared).toMatchObject({ hostId: host.id });
      expect(prepared.command).toContain("https://relay.example.com/install.sh");
      expect(release).not.toHaveBeenCalled();
      const credentialOf = (command: string) =>
        /X-BB-Enrollment: ([^']+)/u.exec(command)?.[1] ?? "";
      const credential = credentialOf(prepared.command);
      expect(credential).toMatch(/^bbde_/u);

      const superseded = await harness.app.request("/install.sh", {
        headers: {
          "X-BB-Enrollment": credentialOf(
            ((await readJson(stale)) as { command: string }).command,
          ),
        },
      });
      expect(superseded.status).toBe(403);
      expect(release).not.toHaveBeenCalled();

      const installer = await harness.app.request("/install.sh", {
        headers: { "X-BB-Enrollment": credential },
      });
      expect(installer.status).toBe(200);
      const script = await installer.text();
      expect(script).toContain("--bootstrap-env BB_ENROLLMENT");
      expect(script).toContain('"reconnect":true');
      expect(script).toContain(`"dataDir":"/tmp/bb-host-data/${host.id}"`);
      expect(script).toContain("new-access");
      expect(script).not.toContain("old-access");
      expect(release).toHaveBeenCalledOnce();

      const enrolled = await harness.app.request("/internal/hosts/enroll", {
        method: "POST",
        headers: {
          authorization: `Bearer ${credential}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ hostId: host.id, hostName: "renamed-by-os" }),
      });
      expect(enrolled.status).toBe(201);
      expect(await readJson(enrolled)).toMatchObject({ hostId: host.id });
      expect(getHost(harness.db, host.id)).toMatchObject({
        name: host.name,
        destroyedAt: null,
      });
      const reused = await harness.app.request("/install.sh", {
        headers: { "X-BB-Enrollment": credential },
      });
      expect(reused.status).toBe(403);
    });
  });

  it("refuses to reconnect the server's own machine or a machine that is not active", async () => {
    await withTestHarness(async (harness) => {
      const primary = seedHost(harness.deps, { id: "host_primary" });
      seedPrimaryHost(harness.deps, primary.id);
      const suspended = seedHost(harness.deps, { id: "host_suspended" });
      harness.db
        .update(hosts)
        .set({ phase: "suspended", suspendedAt: Date.now() })
        .where(eq(hosts.id, suspended.id))
        .run();
      for (const hostId of [primary.id, suspended.id]) {
        const response = await harness.app.request(
          `${API}/hosts/${hostId}/reconnect-commands`,
          { method: "POST" },
        );
        expect(response.status).toBe(409);
        expect(await readJson(response)).toMatchObject({
          code: "machine_reconnect_unavailable",
        });
      }
    });
  });

  it("enrolls a host from a public join code", async () => {
    await withTestHarness(async (harness) => {
      const issued = await createJoinCode(harness.app);
      const response = await harness.app.request("/internal/hosts/enroll", {
        method: "POST",
        headers: {
          authorization: `Bearer ${issued.joinCode}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          hostId: issued.hostId,
          hostName: "Modal abc1",
        }),
      });

      expect(response.status).toBe(201);
      expect(getHost(harness.db, issued.hostId)).toMatchObject({
        name: "Modal abc1",
      });
      const hostsResponse = await harness.app.request("/api/v1/hosts");
      expect(hostsResponse.status).toBe(200);
      expect(await readJson(hostsResponse)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: issued.hostId }),
        ]),
      );
    });
  });

  it("preserves a renamed host across a daemon reconnect", async () => {
    await withTestHarness(async (harness) => {
      const issued = await createJoinCode(harness.app);
      expect(issued.joinCode).toMatch(/^bbde_/u);
      expect(issued.expiresAt).toBeGreaterThan(Date.now());
      expect(issued.expiresAt).toBeLessThanOrEqual(Date.now() + 15 * 60 * 1000);
      expect(getHost(harness.db, issued.hostId)).toBeNull();

      const enrollResponse = await harness.app.request(
        "/internal/hosts/enroll",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${issued.joinCode}`,
            "content-type": "application/json",
            "x-bb-gate-auth": "machine",
            "x-bb-gate-machine-id": "machine-cloud-1",
          },
          body: JSON.stringify({
            hostId: issued.hostId,
            hostName: "Build Machine",
          }),
        },
      );

      expect(enrollResponse.status).toBe(201);
      const enrolled = (await readJson(enrollResponse)) as { hostKey: string };
      expect(getHost(harness.db, issued.hostId)).toMatchObject({
        connectMachineId: "machine-cloud-1",
        name: "Build Machine",
      });

      const renameResponse = await harness.app.request(
        `${API}/hosts/${issued.hostId}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "My Build Box" }),
        },
      );
      expect(renameResponse.status).toBe(200);
      expect(await readJson(renameResponse)).toMatchObject({
        id: issued.hostId,
        name: "My Build Box",
      });

      const sessionResponse = await harness.app.request(
        "/internal/session/open",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${enrolled.hostKey}`,
            "content-type": "application/json",
            "x-bb-gate-auth": "machine",
            "x-bb-gate-machine-id": "machine-cloud-2",
          },
          body: JSON.stringify({
            activeThreads: [],
            dataDir: "/tmp/remote-bb",
            hasMachineCredential: true,
            hostId: issued.hostId,
            hostName: "Build Machine",
            instanceId: "instance-cloud-2",
            loadedEnvironments: [],
            localApiPort: 38_888,
            platform: "linux",
            protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
          }),
        },
      );
      expect(sessionResponse.status).toBe(201);
      const openedSession = hostDaemonSessionOpenResponseSchema.parse(
        await readJson(sessionResponse),
      );
      expect(getHost(harness.db, issued.hostId)).toMatchObject({
        connectMachineId: "machine-cloud-2",
        name: "My Build Box",
      });
      expect(
        getSessionById(harness.db, { sessionId: openedSession.sessionId }),
      ).toMatchObject({ hostName: "Build Machine" });

      const publicHostResponse = await harness.app.request(
        `${API}/hosts/${issued.hostId}`,
      );
      expect(publicHostResponse.status).toBe(200);
      expect(await readJson(publicHostResponse)).toMatchObject({
        id: issued.hostId,
        name: "My Build Box",
      });
    });
  });

  it("rejects a forged connect machine id at enrollment", async () => {
    await withTestHarness(async (harness) => {
      const issued = await createJoinCode(harness.app);
      const response = await harness.app.request("/internal/hosts/enroll", {
        method: "POST",
        headers: {
          authorization: `Bearer ${issued.joinCode}`,
          "content-type": "application/json",
          "x-bb-gate-auth": "machine",
          "x-bb-gate-machine-id": "machine-authenticated",
        },
        body: JSON.stringify({
          connectMachineId: "machine-forged",
          hostId: issued.hostId,
          hostName: "Forged Machine",
        }),
      });
      expect(response.status).toBe(400);
      expect(await readJson(response)).toMatchObject({
        code: "invalid_request",
      });
      expect(getHost(harness.db, issued.hostId)).toBeNull();
    });
  });

  it("rejects machine-gated host-management mutations", async () => {
    await withTestHarness(async (harness) => {
      const host = seedHost(harness.deps, { id: "host_machine_forbidden" });
      const requests = [
        harness.app.request(`${API}/hosts/join-codes`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-bb-gate-auth": "machine",
          },
          body: JSON.stringify({}),
        }),
        harness.app.request(`${API}/hosts/${host.id}`, {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-bb-gate-auth": "machine",
          },
          body: JSON.stringify({ name: "forbidden" }),
        }),
        harness.app.request(`${API}/hosts/${host.id}`, {
          method: "DELETE",
          headers: { "x-bb-gate-auth": "machine" },
        }),
        harness.app.request(`${API}/hosts/${host.id}/retry-update`, {
          method: "POST",
          headers: { "x-bb-gate-auth": "machine" },
        }),
        harness.app.request(`${API}/hosts/${host.id}/reconnect-commands`, {
          method: "POST",
          headers: { "x-bb-gate-auth": "machine" },
        }),
        harness.app.request(`${API}/hosts/${host.id}/suspend`, {
          method: "POST",
          headers: { "x-bb-gate-auth": "machine" },
        }),
        harness.app.request(`${API}/hosts/${host.id}/resume`, {
          method: "POST",
          headers: { "x-bb-gate-auth": "machine" },
        }),
        harness.app.request(`${API}/hosts/${host.id}/retry-cleanup`, {
          method: "POST",
          headers: { "x-bb-gate-auth": "machine" },
        }),
        harness.app.request(`${API}/hosts/${host.id}/permission-ceiling`, {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-bb-gate-auth": "machine",
          },
          body: JSON.stringify({ maxPermissionMode: "full" }),
        }),
      ];
      for (const response of await Promise.all(requests)) {
        expect(response.status).toBe(403);
        expect(await readJson(response)).toMatchObject({
          code: "machine_host_management_forbidden",
        });
      }
      expect(getHost(harness.db, host.id)).toMatchObject({
        destroyedAt: null,
        maxPermissionMode: "full",
        name: host.name,
      });
    });
  });

  it("stores a permission ceiling for a session-gated request", async () => {
    await withTestHarness(async (harness) => {
      const host = seedHost(harness.deps, { id: "host_ceiling" });
      expect(getHost(harness.db, host.id)?.maxPermissionMode).toBe("full");

      const response = await harness.app.request(
        `${API}/hosts/${host.id}/permission-ceiling`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-bb-gate-auth": "session",
          },
          body: JSON.stringify({ maxPermissionMode: "accept-edits" }),
        },
      );

      expect(response.status).toBe(200);
      expect(await readJson(response)).toMatchObject({
        id: host.id,
        maxPermissionMode: "accept-edits",
      });
      expect(getHost(harness.db, host.id)?.maxPermissionMode).toBe(
        "accept-edits",
      );
    });
  });

  it("allows session-gated join-code minting", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request(`${API}/hosts/join-codes`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-bb-gate-auth": "session",
        },
        body: JSON.stringify({}),
      });
      expect(response.status).toBe(201);
    });
  });

  it("renames a host, broadcasts it, and rejects unknown or destroyed hosts", async () => {
    await withTestHarness(async (harness) => {
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

  it("queues a retry only for an older daemon awaiting an update", async () => {
    await withTestHarness(async (harness) => {
      const host = seedHost(harness.deps, { id: "host_retry_update" });

      const notNeeded = await harness.app.request(
        `${API}/hosts/${host.id}/retry-update`,
        { method: "POST" },
      );
      expect(notNeeded.status).toBe(409);

      updateHost(harness.db, harness.hub, host.id, {
        lastRejectedProtocolVersion: HOST_DAEMON_PROTOCOL_VERSION - 1,
      });
      const response = await harness.app.request(
        `${API}/hosts/${host.id}/retry-update`,
        { method: "POST" },
      );
      expect(response.status).toBe(200);
      expect(await readJson(response)).toEqual({ ok: true });
      expect(harness.hub.takeHostProtocolUpdateRetry(host.id)).toBe(true);
      expect(harness.hub.takeHostProtocolUpdateRetry(host.id)).toBe(false);

      updateHost(harness.db, harness.hub, host.id, {
        lastRejectedProtocolVersion: HOST_DAEMON_PROTOCOL_VERSION + 1,
      });
      const newerDaemon = await harness.app.request(
        `${API}/hosts/${host.id}/retry-update`,
        { method: "POST" },
      );
      expect(newerDaemon.status).toBe(409);
      expect(await readJson(newerDaemon)).toMatchObject({
        code: "host_cannot_self_update",
      });
    });
  });

  it("revokes host credentials, closes its live session, tombstones it, and preserves environments", async () => {
    await withTestHarness(async (harness) => {
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
      const activeThread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        status: "active",
      });
      const hostKey = await harness.deps.machineAuth.issueDaemonHostKey({
        hostId: host.id,
      });
      const enrollKey = await harness.deps.machineAuth.issueHostEnrollKey({
        enrollSource: "loopback",
        hostId: host.id,
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
      expect(getThread(harness.db, activeThread.id)?.status).toBe("idle");
      const environmentRead = await harness.app.request(
        `${API}/environments/${environment.id}`,
      );
      expect(await readJson(environmentRead)).toMatchObject({
        hostLifecycle: "removed",
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

  it.each([
    { type: "ephemeral", status: "idle" },
    { type: "ephemeral", status: "active" },
    { type: "ephemeral", status: "stopping" },
    { type: "persistent", status: "idle" },
    { type: "persistent", status: "active" },
    { type: "persistent", status: "stopping" },
  ] as const)(
    "removes a $type machine retaining its $status thread",
    async ({ type, status }) => {
      await withTestHarness(async (harness) => {
        const remove = vi.fn(async () => ({ status: "removed" as const }));
        installMachineProvider({ ephemeral: type === "ephemeral", remove });
        const primary = seedHost(harness.deps, { id: "host_primary" });
        seedPrimaryHost(harness.deps, primary.id);
        const host = seedHost(harness.deps, { id: "host_sandbox" });
        updateHost(harness.db, harness.hub, host.id, {
          machineProviderId: "test-machine",
          phase: "active",
          resource: { allocation: "sandbox" },
          type,
        });
        const { project } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
        });
        const environment = seedEnvironment(harness.deps, {
          hostId: host.id,
          projectId: project.id,
        });
        const thread = seedThread(harness.deps, {
          environmentId: environment.id,
          projectId: project.id,
          status,
          title: "Hidden workflow worker",
          visibility: "hidden",
        });

        if (status !== "idle") {
          seedTurnStarted(harness.deps, {
            environmentId: environment.id,
            threadId: thread.id,
            turnId: "turn_removal",
          });
        }

        const removed = await harness.app.request(`${API}/hosts/${host.id}`, {
          method: "DELETE",
        });

        expect(removed.status).toBe(200);
        expect(await readJson(removed)).toEqual({ ok: true });
        expect(remove).toHaveBeenCalledOnce();
        expect(getHost(harness.db, host.id)?.phase).toBe("destroyed");
        expect(getEnvironment(harness.db, environment.id)?.status).toBe(
          "destroyed",
        );
        const environmentRead = await harness.app.request(
          `${API}/environments/${environment.id}`,
        );
        expect(await readJson(environmentRead)).toMatchObject({
          hostLifecycle: "removed",
        });
        expect(getThread(harness.db, thread.id)).toMatchObject({
          archivedAt: null,
          status: "idle",
        });
        if (status !== "idle") {
          expect(
            listStoredTurnCompletedKeys(harness.db, {
              keys: [{ threadId: thread.id, turnId: "turn_removal" }],
            }),
          ).toEqual([{ threadId: thread.id, turnId: "turn_removal" }]);
        }
      });
    },
  );

  it("deletes a removed host's stored provider model catalogs", async () => {
    await withTestHarness(async (harness) => {
      const primary = seedHost(harness.deps, { id: "host_primary" });
      seedPrimaryHost(harness.deps, primary.id);
      const host = seedHost(harness.deps, { id: "host_remove_catalogs" });
      const key = { hostId: host.id, providerId: "codex", scopeKey: "" };
      replaceStoredProviderModelCatalog(harness.db, {
        row: {
          ...key,
          fingerprint: "fingerprint",
          modelsJson: "[]",
          selectedOnlyModelsJson: "[]",
          fetchedAt: 1,
        },
        pruneWorkspaceRowsFetchedBefore: null,
      });

      const response = await harness.app.request(`${API}/hosts/${host.id}`, {
        method: "DELETE",
      });

      expect(response.status).toBe(200);
      expect(getStoredProviderModelCatalog(harness.db, key)).toBeNull();
    });
  });

  it("announces a removed host to plugins", async () => {
    await withTestHarness(async (harness) => {
      const primary = seedHost(harness.deps, { id: "host_primary" });
      seedPrimaryHost(harness.deps, primary.id);
      const host = seedHost(harness.deps, { id: "host_remove_announced" });
      const announced = vi.spyOn(
        harness.pluginService.events,
        "emitHostDeleted",
      );

      const response = await harness.app.request(`${API}/hosts/${host.id}`, {
        method: "DELETE",
      });

      expect(response.status).toBe(200);
      expect(announced).toHaveBeenCalledOnce();
      expect(announced.mock.calls[0]?.[0]).toMatchObject({
        id: host.id,
        destroyedAt: expect.any(Number),
      });
    });
  });

  it("refuses to remove the primary host", async () => {
    await withTestHarness(async (harness) => {
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

  it("asks the connect plugin to revoke the removed host's cloud machine", async () => {
    await withTestHarness(async (harness) => {
      const primary = seedHost(harness.deps, { id: "host_primary" });
      seedPrimaryHost(harness.deps, primary.id);
      const host = seedHost(harness.deps, {
        connectMachineId: "machine-cloud-remove",
        id: "host_cloud_remove",
      });
      const connectPlugin = await harness.pluginService.install(
        "builtin:connect",
        { kind: "root" },
      );
      expect(connectPlugin).toMatchObject({
        source: "builtin:connect",
        status: "running",
      });
      const revokeHandler = vi.fn(async () => ({ ok: true }));
      const revokeRecord = {
        publication: null,
        inputSchema: z.object({ machineId: z.string() }),
        outputSchema: z.object({ ok: z.literal(true) }),
        handler: revokeHandler,
      };
      vi.spyOn(harness.pluginService, "getRpcHandler").mockReturnValue({
        outcome: "found",
        value: revokeRecord,
      });
      const invoke = vi
        .spyOn(harness.pluginService, "invokeRpcHandler")
        .mockResolvedValue({ ok: true, result: { ok: true } });

      const response = await harness.app.request(`${API}/hosts/${host.id}`, {
        method: "DELETE",
      });
      expect(response.status).toBe(200);
      expect(invoke).toHaveBeenCalledWith(
        connectPlugin.id,
        "revokeMachine",
        revokeRecord,
        { machineId: "machine-cloud-remove" },
        { kind: "client" },
      );
    });
  }, 30_000);
});
