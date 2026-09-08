import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import {
  getMachineLaunch,
  listPublicHosts,
  hosts,
  machineEnrollments,
  machineLaunches,
  setAppSettings,
} from "@bb/db";
import { defaultAppSettings } from "@bb/domain";
import { describe, expect, it, vi } from "vitest";
import { getMachineEnrollmentService } from "../../../src/services/machines/machine-services.js";
import { serverAccess } from "../../../src/services/machines/server-access.js";
import {
  withTestHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";

async function installPlugin(harness: TestAppHarness, id: string) {
  const root = join(harness.config.dataDir, `bb-plugin-${id}`);
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: `bb-plugin-${id}`,
      version: "0.1.0",
      type: "module",
      bb: {
        name: id,
        description: "Machine enrollment regression fixture",
        branding: { icon: "Zap" },
        server: "./server.js",
      },
    }),
  );
  await writeFile(
    join(root, "server.js"),
    `export default function(bb) {
    bb.experimental_machines.register({
      id: "${id}-machine", displayName: "Runtime machine",
      policy: { retire: { after: "never" }, idleSuspendMs: null, removeRetryMs: 10 },
      reconcileCleanup: async () => ({ status: "removed" }),
      create: async () => ({ status: "failed", failure: "terminal", message: "unused" }),
      remove: async () => ({ status: "removed" })
    });
  }`,
  );
  const installed = await harness.pluginService.installPath(root);
  expect(installed.status).toBe("running");
  const api = harness.pluginService.getApi(id);
  if (!api) throw new Error("Plugin API was not loaded");
  return api;
}

function launch(harness: TestAppHarness, key: string, providerId: string) {
  harness.db
    .insert(machineLaunches)
    .values({
      key,
      providerId,
      attempt: 1,
      phase: "creating",
      startedAt: Date.now(),
      transientFailures: 0,
      stepText: "checkpoint step",
      pendingLog: "checkpoint log",
      cancelPending: false,
      resource: { checkpoint: "preserve" },
    })
    .run();
}

describe("production machine enrollment wiring", () => {
  it("reserves the launch host through the loaded plugin and reuses production connection state", async () => {
    await withTestHarness(async (h) => {
      setAppSettings(h.db, {
        ...defaultAppSettings,
        defaultMachineAccess: "direct",
        machineServerUrl: "https://machine.example.test",
      });
      const api = await installPlugin(h, "enrollment-runtime");
      launch(h, "runtime-launch", "enrollment-runtime-machine");
      const enrollment = await api.experimental_machines.prepareEnrollment({
        key: "runtime-launch",
      });
      expect(getMachineLaunch(h.db, "runtime-launch")).toMatchObject({
        hostId: enrollment.hostId,
        resource: { checkpoint: "preserve" },
        stepText: "checkpoint step",
        pendingLog: "checkpoint log",
      });
      expect(getMachineEnrollmentService(h.deps)).toBe(
        getMachineEnrollmentService(h.deps),
      );
      expect(
        await api.experimental_machines.enrollments.prepare({
          key: "runtime-launch",
        }),
      ).toEqual(enrollment);
      if (enrollment.state !== "pending")
        throw new Error("Expected pending enrollment");
      const exec = vi.fn(async () => {
        expect(
          await h.deps.machineAuth.enrollHost({
            hostId: enrollment.hostId,
            token: enrollment.bootstrap.credential,
            allowPublicEnrollment: true,
          }),
        ).not.toBeNull();
        h.hub.registerDaemon("runtime-session", enrollment.hostId, {
          close() {},
          send() {},
        });
        return { exitCode: 0, stdout: "", stderr: "" };
      });
      await expect(
        api.experimental_machines.bootstrap({
          key: "runtime-launch",
          executor: { exec },
          daemon: { kind: "preinstalled" },
          report: { step() {}, log() {} },
          signal: new AbortController().signal,
        }),
      ).resolves.toEqual({ hostId: enrollment.hostId });
      expect(exec).toHaveBeenCalledOnce();
      expect(
        await api.experimental_machines.enrollments.prepare({
          key: "runtime-launch",
        }),
      ).toEqual({
        id: enrollment.id,
        hostId: enrollment.hostId,
        state: "enrolled",
      });
      await expect(
        api.experimental_machines.waitForConnection({
          enrollmentId: enrollment.id,
          timeoutMs: 100,
          signal: new AbortController().signal,
        }),
      ).resolves.toEqual({ hostId: enrollment.hostId });
      await h.pluginService.setEnabled("enrollment-runtime", false);
      expect(() =>
        api.experimental_machines.prepareEnrollment({ key: "after-disable" }),
      ).toThrow();
    });
  });

  it("rejects foreign launches, checkpoints before failed access, and releases with the original owner key", async () => {
    await withTestHarness(async (h) => {
      const api = await installPlugin(h, "enrollment-runtime");
      const other = await installPlugin(h, "enrollment-other");
      const release = vi.fn(async () => {});
      const acquire = vi.fn(async ({ hostId }: { hostId: string }) => ({
        id: "runtime-grant",
        serverUrl: "https://machine.example.test",
      }));
      api.experimental_serverAccess.register({
        id: "runtime-access",
        displayName: "Runtime access",
        availability: () => ({ status: "available" }),
        acquire,
        release,
      });
      launch(h, "failure-launch", "enrollment-runtime-machine");
      await expect(
        other.experimental_machines.prepareEnrollment({
          key: "failure-launch",
          access: { providerId: "runtime-access" },
        }),
      ).rejects.toThrow("different plugin");
      expect(h.db.select().from(machineEnrollments).all()).toEqual([]);
      acquire.mockRejectedValueOnce(
        Object.assign(new Error("Cloud device may need dashboard revocation"), {
          name: "experimental_ServerAccessRecoveryError",
        }),
      );
      await expect(
        api.experimental_machines.prepareEnrollment({
          key: "failure-launch",
          access: { providerId: "runtime-access" },
        }),
      ).rejects.toThrow();
      const reserved = getMachineLaunch(h.db, "failure-launch");
      expect(reserved?.hostId).toBeTruthy();
      expect(reserved?.resource).toEqual({ checkpoint: "preserve" });
      expect(
        listPublicHosts(h.db).find((host) => host.id === reserved?.hostId)
          ?.teardownMessage,
      ).toBe("Cloud device may need dashboard revocation");
      const enrollment = await api.experimental_machines.prepareEnrollment({
        key: "failure-launch",
        access: { providerId: "runtime-access" },
      });
      expect(enrollment.hostId).toBe(reserved?.hostId);
      expect(
        listPublicHosts(h.db).some((host) => host.id === reserved?.hostId),
      ).toBe(false);
      await serverAccess.release(h.deps, {
        hostId: enrollment.hostId,
        key: enrollment.hostId,
      });
      expect(release).toHaveBeenCalledWith({
        key: JSON.stringify(["enrollment-runtime", "failure-launch"]),
        grantId: "runtime-grant",
        hostId: enrollment.hostId,
      });
      expect(
        h.db
          .select({ providerId: hosts.serverAccessProviderId })
          .from(hosts)
          .where(eq(hosts.id, enrollment.hostId))
          .get()?.providerId,
      ).toBeNull();
      expect(
        await getMachineEnrollmentService(h.deps).cancelByKey(
          "enrollment-runtime",
          "failure-launch",
        ),
      ).toEqual({ hostId: enrollment.hostId });
      const standalone = await api.experimental_machines.prepareEnrollment({
        key: "standalone",
        access: { providerId: "runtime-access" },
      });
      expect(standalone.hostId).not.toBe(enrollment.hostId);
      expect(getMachineLaunch(h.db, "standalone")).toBeNull();
    });
  });
});
