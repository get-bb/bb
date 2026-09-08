import { expect, it, vi } from "vitest";
import { defaultAppSettings } from "@bb/domain";
import {
  getHost,
  getMachineLaunch,
  machineEnrollments,
  setAppSettings,
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
      for (const key of ["manual-cancel", "manual-connect"]) {
        await submitMachine(h.deps, {
          key,
          machineProviderId: "manual",
          projectId: null,
          inputs: null,
        });
        await vi.waitFor(() =>
          expect(getMachineLaunch(h.db, key)?.stepText).toContain(
            "bb machine enroll --bootstrap-env",
          ),
        );
        const enrollment = await api.experimental_machines.prepareEnrollment({
          key,
        });
        if (enrollment.state !== "pending")
          throw new Error("Expected pending enrollment");
        expect(getMachineLaunch(h.db, key)?.stepText).toContain(
          enrollment.bootstrap.credential,
        );
        if (key === "manual-cancel") {
          await cancelMachineLaunch(h.deps, key);
          expect(getMachineLaunch(h.db, key)).toMatchObject({
            phase: "cancelled",
            cancelPending: false,
          });
          expect(getHost(h.db, enrollment.hostId)?.destroyedAt).not.toBeNull();
        } else {
          const enrolled = await h.deps.machineAuth.enrollHost({
            hostId: enrollment.hostId,
            token: enrollment.bootstrap.credential,
            allowPublicEnrollment: true,
          });
          expect(enrolled).not.toBeNull();
          h.hub.registerDaemon("manual-session", enrollment.hostId, {
            close() {},
            send() {},
          });
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
      expect(release).toHaveBeenCalledTimes(2);
    } finally {
      release.mockRestore();
    }
  });
});
