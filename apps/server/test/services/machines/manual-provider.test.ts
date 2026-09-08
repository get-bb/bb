import { buildHostDaemonWebSocketProtocols } from "@bb/host-daemon-contract";
import {
  onDaemonSocketMessage,
  validateDaemonWebSocket,
} from "../../../src/ws/daemon-protocol.js";
import { expect, it, vi } from "vitest";
import { defaultAppSettings } from "@bb/domain";
import {
  getHost,
  getMachineLaunch,
  machineEnrollments,
  setAppSettings,
  hosts,
  openSession,
  getSessionById,
} from "@bb/db";
import { withTestHarness } from "../../helpers/test-app.js";
import {
  submitMachine,
  cancelMachineLaunch,
  requestMachineRemoval,
  sweepProviderMachine,
} from "../../../src/services/machines/provider-orchestration.js";
import { serverAccess } from "../../../src/services/machines/server-access.js";

it("creates, cancels, and removes manual machines through the production lifecycle", async () => {
  await withTestHarness(async (h) => {
    setAppSettings(h.db, {
      ...defaultAppSettings,
      defaultMachineAccess: "direct",
      machineServerUrl: "https://machine.example.test",
    });
    const installed = await h.pluginService.install("builtin:machine-manual", {
      kind: "root",
    });
    expect(installed.status).toBe("running");
    const api = h.pluginService.getApi("machine-manual");
    if (!api) throw new Error("Manual provider did not load");
    const release = vi.spyOn(serverAccess, "release");
    try {
      for (const key of [
        "manual-cancel",
        "manual-cancel-connected",
        "manual-connect",
      ]) {
        await submitMachine(h.deps, {
          key,
          machineProviderId: "manual",
          projectId: null,
          inputs: null,
        });
        await vi.waitFor(() =>
          expect(getMachineLaunch(h.db, key)?.stepText).not.toContain(
            "Run the enrollment command shown in the picker",
          ),
        );
        const enrollment = await api.experimental_machines.prepareEnrollment({
          key,
        });
        if (enrollment.state !== "pending")
          throw new Error("Expected pending enrollment");
        expect(getMachineLaunch(h.db, key)?.stepText).not.toContain(
          enrollment.bootstrap.credential,
        );
        const commandUrl = `/api/v1/hosts/launches/${key}/enrollment-command`;
        const commandResponse = await h.app.request(commandUrl);
        expect(commandResponse.headers.get("cache-control")).toBe("no-store");
        expect((await commandResponse.json()).command).toContain(
          enrollment.bootstrap.credential,
        );
        const denied = await h.app.request(commandUrl, {
          headers: {
            "x-bb-gate-auth": "machine",
            "x-bb-gate-machine-id": "other-machine",
          },
        });
        expect(denied.status).toBe(403);
        let daemonKey: string | null = null;
        const close = vi.fn();
        const sent: string[] = [];
        const socket = {
          close,
          send(value: string) {
            sent.push(value);
          },
        };
        let sessionId: string | null = null;
        if (key !== "manual-cancel") {
          const enrolled = await h.deps.machineAuth.enrollHost({
            hostId: enrollment.hostId,
            token: enrollment.bootstrap.credential,
            allowPublicEnrollment: true,
          });
          if (!enrolled) throw new Error("Enrollment failed");
          daemonKey = enrolled.hostKey;
          expect(await (await h.app.request(commandUrl)).json()).toEqual({
            command: null,
          });
          const session = openSession(h.db, {
            hostId: enrollment.hostId,
            instanceId: key,
            hostName: "Manual",
            dataDir: "/tmp/manual-test",
            protocolVersion: 1,
            heartbeatIntervalMs: 5000,
            leaseTimeoutMs: 30000,
          });
          sessionId = session.id;
          h.hub.registerDaemon(session.id, enrollment.hostId, socket);
          expect(
            await validateDaemonWebSocket(h.deps, {
              sessionId,
              authorizationHeader: `Bearer ${daemonKey}`,
              protocolHeader: buildHostDaemonWebSocketProtocols().join(","),
            }),
          ).toMatchObject({ hostId: enrollment.hostId });
          onDaemonSocketMessage(h.deps, {
            hostId: enrollment.hostId,
            sessionId,
            socket,
            raw: JSON.stringify({ type: "heartbeat" }),
          });
          expect(sent).toContain(JSON.stringify({ type: "heartbeat-ack" }));
          sent.length = 0;
        }
        if (key.startsWith("manual-cancel")) {
          await cancelMachineLaunch(h.deps, key);
          expect(getMachineLaunch(h.db, key)).toMatchObject({
            phase: "cancelled",
            cancelPending: false,
          });
          expect(getHost(h.db, enrollment.hostId)?.destroyedAt).not.toBeNull();
        } else {
          await vi.waitFor(() =>
            expect(getMachineLaunch(h.db, key)?.phase).toBe("ready"),
          );
          expect(getHost(h.db, enrollment.hostId)).toMatchObject({
            machineProviderId: "manual",
            resource: { version: 1, hostId: enrollment.hostId },
            retireAt: null,
          });
          expect(requestMachineRemoval(h.deps, enrollment.hostId)).toBe(true);
          await sweepProviderMachine(h.deps, enrollment.hostId);
          expect(getHost(h.db, enrollment.hostId)).toMatchObject({
            phase: "destroyed",
            resource: null,
            serverAccessGrantId: null,
          });
        }
        expect(await (await h.app.request(commandUrl)).json()).toEqual({
          command: null,
        });
        expect(JSON.stringify(getMachineLaunch(h.db, key))).not.toContain(
          enrollment.bootstrap.credential,
        );
        if (sessionId !== null) {
          onDaemonSocketMessage(h.deps, {
            hostId: enrollment.hostId,
            sessionId,
            socket,
            raw: JSON.stringify({ type: "heartbeat" }),
          });
          expect(getSessionById(h.db, { sessionId })).toMatchObject({
            status: "closed",
            closeReason: "expired",
          });
          expect(close).toHaveBeenCalledWith(1000, "expired");
          await expect(
            validateDaemonWebSocket(h.deps, {
              sessionId,
              authorizationHeader: `Bearer ${daemonKey}`,
              protocolHeader: buildHostDaemonWebSocketProtocols().join(","),
            }),
          ).rejects.toMatchObject({ status: 401 });
          expect(sent).not.toContain(JSON.stringify({ type: "heartbeat-ack" }));
          expect(h.hub.hasDaemonForHost(enrollment.hostId)).toBe(false);
        }
        if (daemonKey !== null)
          expect(
            await h.deps.machineAuth.verifyDaemonHostKey(daemonKey),
          ).toBeNull();
        expect(
          h.db
            .select()
            .from(machineEnrollments)
            .all()
            .find((row) => row.hostId === enrollment.hostId),
        ).toMatchObject({ state: "cancelled", encryptedBootstrap: null });
        expect(
          await h.deps.machineAuth.enrollHost({
            hostId: enrollment.hostId,
            token: enrollment.bootstrap.credential,
            allowPublicEnrollment: true,
          }),
        ).toBeNull();
      }
      expect(release).toHaveBeenCalledTimes(3);
    } finally {
      release.mockRestore();
    }
  });
});

it("releases legacy Connect access when removing a backfilled manual host", async () => {
  await withTestHarness(async (h) => {
    await h.pluginService.install("builtin:machine-manual", { kind: "root" });
    const api = h.pluginService.getApi("machine-manual");
    if (!api) throw new Error("Manual provider did not load");
    const release = vi.fn(async () => {});
    api.experimental_serverAccess.register({
      id: "connect",
      displayName: "Legacy access",
      availability: () => ({ status: "available" }),
      acquire: async () => {
        throw new Error("Must not acquire during removal");
      },
      release,
    });
    h.db
      .insert(hosts)
      .values({
        id: "legacy-manual",
        name: "Legacy",
        connectMachineId: "legacy-cloud-machine",
        machineProviderId: "manual",
        resource: { version: 1, hostId: "legacy-manual" },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .run();
    expect(requestMachineRemoval(h.deps, "legacy-manual")).toBe(true);
    await sweepProviderMachine(h.deps, "legacy-manual");
    expect(release).toHaveBeenCalledWith({
      key: "legacy-manual",
      grantId: "legacy-manual",
      hostId: "legacy-manual",
    });
    expect(getHost(h.db, "legacy-manual")?.phase).toBe("destroyed");
  });
});
