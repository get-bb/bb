import { describe, expect, it } from "vitest";
import type { SystemAppUpdateStatus } from "@bb/server-contract";
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
      ]);

      for (const response of responses) {
        expect(response.status).toBe(403);
      }
    }));

  it("does not let machine credentials force launcher checks", async () => {
    const forced: boolean[] = [];
    const status: SystemAppUpdateStatus = {
      activity: { phase: "idle" },
      available: null,
      blocked: null,
      current: { commit: null, version: "1.0.0" },
      lastResult: null,
      probation: false,
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
