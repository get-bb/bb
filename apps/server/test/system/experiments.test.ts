import { describe, expect, it } from "vitest";
import { getExperiments } from "@bb/db";
import { defaultExperiments, experimentsSchema } from "@bb/domain";
import { systemConfigResponseSchema } from "@bb/server-contract";
import { readJson } from "../helpers/json.js";
import { type TestAppHarness, withTestHarness } from "../helpers/test-app.js";

function putExperiments(harness: TestAppHarness, body: object) {
  return harness.app.request("/api/v1/settings/experiments", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("experiments settings", () => {
  it("serves the shipped experiment defaults in /system/config", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request("/api/v1/system/config");
      expect(response.status).toBe(200);
      const body = systemConfigResponseSchema.parse(await readJson(response));
      expect(body.experiments).toEqual({
        serverMove: false,
        performanceDiagnostics: false,
      });
    });
  });

  it.each([false, true])(
    "reports startup permission %s independently of the experiment",
    async (available) => {
      await withTestHarness(async (harness) => {
        harness.deps.config.performanceDiagnosticsAvailable = available;
        await putExperiments(harness, { performanceDiagnostics: true });
        const response = await harness.app.request("/api/v1/system/config");
        const body = systemConfigResponseSchema.parse(await readJson(response));
        expect(body.performanceDiagnosticsAvailable).toBe(available);
        expect(body.experiments.performanceDiagnostics).toBe(true);
      });
    },
  );

  it("persists a PUT and reflects it in /system/config", async () => {
    await withTestHarness(async (harness) => {
      const put = await harness.app.request("/api/v1/settings/experiments", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          serverMove: true,
          performanceDiagnostics: true,
        }),
      });
      expect(put.status).toBe(200);
      expect(experimentsSchema.parse(await readJson(put))).toEqual({
        serverMove: true,
        performanceDiagnostics: true,
      });
      expect(getExperiments(harness.db)).toEqual({
        serverMove: true,
        performanceDiagnostics: true,
      });

      const config = await harness.app.request("/api/v1/system/config");
      expect(
        systemConfigResponseSchema.parse(await readJson(config)).experiments,
      ).toEqual({
        serverMove: true,
        performanceDiagnostics: true,
      });
    });
  });

  it("changes only the experiments a PUT names", async () => {
    await withTestHarness(async (harness) => {
      await putExperiments(harness, { serverMove: true });
      const put = await putExperiments(harness, {
        performanceDiagnostics: true,
      });
      expect(put.status).toBe(200);
      expect(experimentsSchema.parse(await readJson(put))).toEqual({
        serverMove: true,
        performanceDiagnostics: true,
      });
      expect(
        harness.db.$client
          .prepare<[], { key: string }>(
            "SELECT key FROM system_experiments ORDER BY key",
          )
          .all()
          .map((row) => row.key),
      ).toEqual(["performanceDiagnostics", "serverMove"]);
    });
  });

  it.each([
    ["an unknown experiment", { futureExperiment: true }],
    ["a non-boolean value", { serverMove: "yes" }],
  ])("rejects %s", async (_label, body) => {
    await withTestHarness(async (harness) => {
      const response = await putExperiments(harness, body);
      expect(response.status).toBe(400);
      expect(getExperiments(harness.db)).toEqual(defaultExperiments);
    });
  });
});
