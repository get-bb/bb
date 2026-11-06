import { describe, expect, it } from "vitest";
import { setExperiments } from "@bb/db";
import type { SystemAppUpdateStatus } from "@bb/server-contract";
import type { AppUpdateServiceStatus } from "../../src/services/system/app-update.js";
import { readJson } from "../helpers/json.js";
import { withTestHarness } from "../helpers/test-app.js";

const API = "/api/v1/system/app-update";
const MACHINE_HEADERS = { "x-bb-gate-auth": "machine" };

describe("/api/v1/system/app-update", () => {
  it("reports in-app updates as unavailable when bb runs without the launcher shim", () =>
    withTestHarness({ isDevelopment: false }, async (harness) => {
      const response = await harness.app.request(API);

      expect(response.status).toBe(200);
      const body = (await readJson(response)) as SystemAppUpdateStatus;
      expect(body.support).toEqual({
        kind: "unsupported",
        reason: "unmanaged",
      });
      expect(body.activity).toEqual({ phase: "idle" });
      expect(body.runningThreadCount).toBe(0);
      expect(body.scheduled).toBeNull();
    }));

  it("refuses to apply an update the launcher cannot perform", () =>
    withTestHarness({ isDevelopment: false }, async (harness) => {
      const response = await harness.app.request(`${API}/apply`, {
        body: JSON.stringify({ confirmInterruptingThreads: true }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });

      expect(response.status).toBe(409);
      expect(await readJson(response)).toMatchObject({
        code: "app_update_unsupported",
      });
    }));

  it("rejects malformed apply requests", () =>
    withTestHarness(async (harness) => {
      const response = await harness.app.request(`${API}/apply`, {
        body: JSON.stringify({}),
        headers: { "content-type": "application/json" },
        method: "POST",
      });

      expect(response.status).toBe(400);
    }));

  it("refuses to schedule or cancel while the updateWhenIdle experiment is off", () =>
    withTestHarness({ isDevelopment: false }, async (harness) => {
      for (const path of ["schedule", "schedule/cancel"]) {
        const response = await harness.app.request(`${API}/${path}`, {
          method: "POST",
        });

        expect(response.status).toBe(403);
        expect(await readJson(response)).toMatchObject({
          code: "update_when_idle_experiment_disabled",
        });
      }
    }));

  it("saves the automatic update setting only while the updateWhenIdle experiment is on", () =>
    withTestHarness({ isDevelopment: false }, async (harness) => {
      const setAuto = (enabled: boolean) =>
        harness.app.request(`${API}/auto`, {
          body: JSON.stringify({ enabled }),
          headers: { "content-type": "application/json" },
          method: "POST",
        });

      const refused = await setAuto(true);
      expect(refused.status).toBe(403);
      expect(await readJson(refused)).toMatchObject({
        code: "update_when_idle_experiment_disabled",
      });

      setExperiments(harness.db, { updateWhenIdle: true });
      const turnedOn = await setAuto(true);
      expect(turnedOn.status).toBe(200);
      expect(
        ((await readJson(turnedOn)) as SystemAppUpdateStatus).autoUpdate,
      ).toBe(true);
      const status = (await readJson(
        await harness.app.request(API),
      )) as SystemAppUpdateStatus;
      expect(status.autoUpdate).toBe(true);
    }));

  it("refuses to schedule an update the launcher cannot perform", () =>
    withTestHarness({ isDevelopment: false }, async (harness) => {
      setExperiments(harness.db, { updateWhenIdle: true });
      const response = await harness.app.request(`${API}/schedule`, {
        method: "POST",
      });

      expect(response.status).toBe(409);
      expect(await readJson(response)).toMatchObject({
        code: "app_update_unsupported",
      });
    }));

  it("does not let machine credentials update or dismiss results", () =>
    withTestHarness(async (harness) => {
      const responses = await Promise.all([
        harness.app.request(`${API}/apply`, {
          body: JSON.stringify({ confirmInterruptingThreads: true }),
          headers: { ...MACHINE_HEADERS, "content-type": "application/json" },
          method: "POST",
        }),
        harness.app.request(`${API}/acknowledge`, {
          body: JSON.stringify({ id: "result-1" }),
          headers: { ...MACHINE_HEADERS, "content-type": "application/json" },
          method: "POST",
        }),
        harness.app.request(`${API}/schedule`, {
          headers: MACHINE_HEADERS,
          method: "POST",
        }),
        harness.app.request(`${API}/schedule/cancel`, {
          headers: MACHINE_HEADERS,
          method: "POST",
        }),
        harness.app.request(`${API}/auto`, {
          body: JSON.stringify({ enabled: true }),
          headers: { ...MACHINE_HEADERS, "content-type": "application/json" },
          method: "POST",
        }),
      ]);

      for (const response of responses) {
        expect(response.status).toBe(403);
      }
    }));

  it("does not let machine credentials force launcher checks", async () => {
    const forced: boolean[] = [];
    const status: AppUpdateServiceStatus = {
      activity: { phase: "idle" },
      available: null,
      blocked: null,
      current: { commit: null, version: "1.0.0" },
      lastResult: null,
      runningThreadCount: 0,
      support: { kind: "supported", mode: "source" },
    };
    await withTestHarness(
      {
        appUpdateService: {
          acknowledgeResult: async () => status,
          apply: async () => status,
          dispose: () => undefined,
          getStatus: async ({ forceRefresh }) => {
            forced.push(forceRefresh);
            return status;
          },
        },
      },
      async (harness) => {
        await harness.app.request(`${API}?force=true`, {
          headers: MACHINE_HEADERS,
        });
        await harness.app.request(`${API}?force=true`);
      },
    );

    expect(forced).toEqual([false, true]);
  });
});
