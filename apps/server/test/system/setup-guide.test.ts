import { describe, expect, it, vi } from "vitest";
import { createSetupGuideExperiment } from "../../src/services/system/setup-guide-experiment.js";
import type { TelemetryService } from "../../src/services/system/telemetry.js";
import { readJson } from "../helpers/json.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

function postEvent(harness: TestAppHarness, body: unknown) {
  return harness.app.request("/api/v1/system/telemetry/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function useFlagVariant(harness: TestAppHarness) {
  const capture = vi.fn<TelemetryService["capture"]>();
  const telemetry: TelemetryService = {
    ...harness.deps.telemetry,
    capture,
    isEnabled: () => true,
    featureFlagIdentity: () => ({ apiKey: "phc_test", distinctId: "install" }),
  };
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
    new Response(
      JSON.stringify({
        flags: {
          "setup-guide-redesign": {
            key: "setup-guide-redesign",
            enabled: true,
            variant: "new",
            metadata: {
              id: 1,
              version: 1,
              payload: JSON.stringify({ plugins: ["memory", "tasks"] }),
            },
          },
        },
        errorsWhileComputingFlags: false,
      }),
      { status: 200 },
    ),
  );
  harness.deps.telemetry = telemetry;
  harness.deps.setupGuideExperiment = await createSetupGuideExperiment({
    dataDir: harness.config.dataDir,
    fetch,
    flagTimeoutMs: 1_000,
    logger: harness.deps.logger,
    override: null,
    telemetry,
  });
  return { capture, fetch };
}

describe("setup guide route", () => {
  it("serves the control guide when telemetry is unavailable", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request("/api/v1/system/setup-guide");

      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        variant: "control",
        featuredPluginEntryIds: null,
      });
    });
  });

  it("serves the flag variant without exposing its source", async () => {
    await withTestHarness(async (harness) => {
      const { fetch } = await useFlagVariant(harness);

      const response = await harness.app.request("/api/v1/system/setup-guide");

      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        variant: "new",
        featuredPluginEntryIds: ["memory", "tasks"],
      });
      await harness.app.request("/api/v1/system/setup-guide");
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });

  it("records exposure with the flag call and tags setup-guide events", async () => {
    await withTestHarness(async (harness) => {
      const { capture } = await useFlagVariant(harness);

      const exposure = await postEvent(harness, {
        name: "onboarding_exposed",
        properties: { entry: "first_run" },
      });
      expect(exposure.status).toBe(200);
      expect(capture.mock.calls.map(([event]) => event)).toEqual([
        {
          name: "$feature_flag_called",
          properties: {
            $feature_flag: "setup-guide-redesign",
            $feature_flag_response: "new",
          },
        },
        {
          name: "onboarding_exposed",
          properties: {
            entry: "first_run",
            setup_guide_variant: "new",
            setup_guide_source: "flag",
            $set: { setup_guide_variant: "new" },
          },
        },
      ]);

      capture.mockClear();
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
      await postEvent(harness, {
        name: "new_thread_submit",
        properties: { outcome: "accepted" },
      });
      expect(capture.mock.calls.map(([event]) => event)).toEqual([
        {
          name: "recommendation",
          properties: {
            resource_type: "plugin",
            resource_id: "memory",
            recommendation_id: "V1StGXR8_Z5jdHi6B-myT",
            action: "shown",
            surface: "onboarding",
            entry: "first_run",
            setup_guide_variant: "new",
          },
        },
        { name: "new_thread_submit", properties: { outcome: "accepted" } },
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
