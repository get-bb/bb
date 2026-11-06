import { describe, expect, it, vi } from "vitest";
import { createFeaturedPluginsExperiment } from "../../src/services/system/featured-plugins-experiment.js";
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

async function useFlags(harness: TestAppHarness) {
  const capture = vi.fn<TelemetryService["capture"]>();
  const telemetry: TelemetryService = {
    ...harness.deps.telemetry,
    capture,
    isEnabled: () => true,
    featureFlagIdentity: () => ({ apiKey: "phc_test", distinctId: "install" }),
  };
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          flags: {
            "setup-guide-redesign": {
              key: "setup-guide-redesign",
              enabled: true,
              variant: "new",
              metadata: { id: 1, version: 1 },
            },
            "onboarding-featured-plugins": {
              key: "onboarding-featured-plugins",
              enabled: true,
              variant: "new",
              metadata: {
                id: 2,
                version: 1,
                payload: JSON.stringify({
                  plugins: ["memory", "push-notifications"],
                  alreadyOn: ["push-notifications"],
                }),
              },
            },
          },
          errorsWhileComputingFlags: false,
        }),
        { status: 200 },
      ),
  );
  const experimentArgs = {
    dataDir: harness.config.dataDir,
    fetch,
    flagTimeoutMs: 1_000,
    logger: harness.deps.logger,
    telemetry,
  };
  harness.deps.telemetry = telemetry;
  harness.deps.setupGuideExperiment = await createSetupGuideExperiment({
    ...experimentArgs,
    override: null,
  });
  harness.deps.featuredPluginsExperiment =
    await createFeaturedPluginsExperiment(experimentArgs);
  return { capture };
}

describe("setup guide featured plugins route", () => {
  it("serves no list when telemetry is unavailable", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request(
        "/api/v1/system/setup-guide/featured-plugins",
      );

      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        entryIds: null,
        alreadyOnEntryIds: [],
      });
    });
  });

  it("serves the flag's list and already-on plugins", async () => {
    await withTestHarness(async (harness) => {
      await useFlags(harness);

      const response = await harness.app.request(
        "/api/v1/system/setup-guide/featured-plugins",
      );

      await expect(readJson(response)).resolves.toEqual({
        entryIds: ["memory", "push-notifications"],
        alreadyOnEntryIds: ["push-notifications"],
      });
    });
  });

  it("records its own exposure and tags setup-guide events with both variants", async () => {
    await withTestHarness(async (harness) => {
      const { capture } = await useFlags(harness);

      const exposure = await postEvent(harness, {
        name: "onboarding_featured_plugins_exposed",
        properties: { entry: "first_run" },
      });
      expect(exposure.status).toBe(200);
      expect(capture.mock.calls.map(([event]) => event)).toEqual([
        {
          name: "$feature_flag_called",
          properties: {
            $feature_flag: "onboarding-featured-plugins",
            $feature_flag_response: "new",
          },
        },
        {
          name: "onboarding_featured_plugins_exposed",
          properties: {
            entry: "first_run",
            featured_plugins_variant: "new",
            featured_plugins_source: "flag",
            $set: { featured_plugins_variant: "new" },
          },
        },
      ]);

      capture.mockClear();
      await postEvent(harness, {
        name: "onboarding_left",
        properties: { step: "plugins", entry: "first_run" },
      });
      await postEvent(harness, {
        name: "new_thread_submit",
        properties: { outcome: "accepted" },
      });
      expect(capture.mock.calls.map(([event]) => event)).toEqual([
        {
          name: "onboarding_left",
          properties: {
            step: "plugins",
            entry: "first_run",
            setup_guide_variant: "new",
            featured_plugins_variant: "new",
          },
        },
        { name: "new_thread_submit", properties: { outcome: "accepted" } },
      ]);
    });
  });

  it("rejects an exposure event with extra properties", async () => {
    await withTestHarness(async (harness) => {
      const response = await postEvent(harness, {
        name: "onboarding_featured_plugins_exposed",
        properties: { entry: "first_run", variant: "new" },
      });

      expect(response.status).toBe(400);
    });
  });
});
