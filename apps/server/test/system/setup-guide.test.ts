import { describe, expect, it, vi } from "vitest";
import { systemSetupGuideResponseSchema } from "@bb/server-contract";
import type { TelemetryService } from "../../src/services/system/telemetry.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

function postEvent(harness: TestAppHarness, body: unknown) {
  return harness.app.request("/api/v1/system/telemetry/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function captureTelemetry(harness: TestAppHarness) {
  const capture = vi.fn<TelemetryService["capture"]>();
  harness.deps.telemetry = {
    ...harness.deps.telemetry,
    capture,
    isEnabled: () => true,
  };
  return capture;
}

describe("setup guide route", () => {
  it("tells older apps to show the setup guide every install now gets", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request("/api/v1/system/setup-guide");

      expect(response.status).toBe(200);
      expect(
        systemSetupGuideResponseSchema.parse(await response.json()),
      ).toEqual({ variant: "new" });
    });
  });
});

describe("setup guide telemetry", () => {
  it("sends setup guide events as reported, with no experiment properties", async () => {
    await withTestHarness(async (harness) => {
      const capture = captureTelemetry(harness);

      const exposure = await postEvent(harness, {
        name: "onboarding_exposed",
        properties: { entry: "first_run" },
      });
      await postEvent(harness, {
        name: "recommendation",
        properties: {
          resource_type: "plugin",
          resource_id: "memory",
          recommendation_id: "V1StGXR8_Z5jdHi6B-myT",
          action: "shown",
          surface: "onboarding",
          entry: "first_run",
        },
      });

      expect(exposure.status).toBe(200);
      expect(capture.mock.calls.map(([event]) => event)).toEqual([
        { name: "onboarding_exposed", properties: { entry: "first_run" } },
        {
          name: "recommendation",
          properties: {
            resource_type: "plugin",
            resource_id: "memory",
            recommendation_id: "V1StGXR8_Z5jdHi6B-myT",
            action: "shown",
            surface: "onboarding",
            entry: "first_run",
          },
        },
      ]);
    });
  });

  it("rejects an exposure event with extra properties", async () => {
    await withTestHarness(async (harness) => {
      const response = await postEvent(harness, {
        name: "onboarding_exposed",
        properties: { entry: "first_run", variant: "new" },
      });

      expect(response.status).toBe(400);
    });
  });
});
