import { describe, expect, it } from "vitest";
import { getExperiments } from "@bb/db";
import { defaultExperiments, experimentsSchema } from "@bb/domain";
import { systemConfigResponseSchema } from "@bb/server-contract";
import { readJson } from "../helpers/json.js";
import {
  type TestAppHarness,
  withTestHarness,
} from "../helpers/test-app.js";

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
        changelogPreview: false,
        serverMove: false,
      });
    });
  });

  it("persists a PUT and reflects it in /system/config", async () => {
    await withTestHarness(async (harness) => {
      const put = await harness.app.request("/api/v1/settings/experiments", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          changelogPreview: true,
          serverMove: true,
        }),
      });
      expect(put.status).toBe(200);
      expect(experimentsSchema.parse(await readJson(put))).toEqual({
        changelogPreview: true,
        serverMove: true,
      });
      expect(getExperiments(harness.db)).toEqual({
        changelogPreview: true,
        serverMove: true,
      });

      const config = await harness.app.request("/api/v1/system/config");
      expect(
        systemConfigResponseSchema.parse(await readJson(config)).experiments,
      ).toEqual({
        changelogPreview: true,
        serverMove: true,
      });
    });
  });

  it("changes only the experiments a PUT names", async () => {
    await withTestHarness(async (harness) => {
      await putExperiments(harness, { serverMove: true });
      const put = await putExperiments(harness, { changelogPreview: true });
      expect(put.status).toBe(200);
      expect(experimentsSchema.parse(await readJson(put))).toEqual({
        changelogPreview: true,
        serverMove: true,
      });
      expect(
        harness.db.$client
          .prepare<[], { key: string }>(
            "SELECT key FROM system_experiments ORDER BY key",
          )
          .all()
          .map((row) => row.key),
      ).toEqual(["changelogPreview", "serverMove"]);
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
