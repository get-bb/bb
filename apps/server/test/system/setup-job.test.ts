import { afterEach, describe, expect, it, vi } from "vitest";
import { appSettingsValues, getAppSettings, setAppSettings } from "@bb/db";
import * as creation from "../../src/services/system/setup-job-automation.js";
import { createSetupJobService } from "../../src/services/system/setup-job.js";
import { registerHostRpcResponder } from "../helpers/host-rpc.js";
import {
  seedHostSession,
  seedPrimaryHost,
  seedProjectWithSource,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const suggestionAnalyticsId = "26ad88d4-6506-4ba9-a0ed-ccac606c638c";

function seedOffer(harness: TestAppHarness) {
  const { host, session } = seedHostSession(harness.deps);
  seedPrimaryHost(harness.deps, host.id);
  const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
  registerHostRpcResponder(harness, {
    hostId: host.id,
    sessionId: session.id,
    handle: () => ({
      ok: true,
      result: {
        supported: true,
        health: {
          status: "ready",
          statusMessage: null,
          accountEmail: null,
          planLabel: null,
          installedVersion: null,
          minimumSupportedVersion: null,
          canInstall: false,
          canUpdate: false,
          loginCommand: null,
        },
      },
    }),
  });
  const offer = {
    arm: "b",
    suggestionAnalyticsId,
    title: "Each weeknight, fix what's failing on main",
    projectId: project.id,
    projectName: project.name,
    providerName: "Codex",
    timezone: "UTC",
    status: "offered",
    automationId: null,
  };
  harness.db
    .insert(appSettingsValues)
    .values({
      key: "setup_recurring_job",
      value: JSON.stringify({
        offer,
        shown: false,
        execution: {
          projectId: project.id,
          hostId: host.id,
          providerId: "codex",
          model: "test-model",
          reasoningLevel: "medium",
        },
      }),
      updatedAt: Date.now(),
    })
    .run();
  return offer;
}

afterEach(() => vi.restoreAllMocks());

describe("setup recurring job", () => {
  it("offers nothing without an imported project and rejects an invalid time zone", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request(
        "/api/v1/system/setup-job?timezone=UTC",
      );
      expect(await response.json()).toEqual({ offer: null });
      expect(
        (
          await harness.app.request(
            "/api/v1/system/setup-job?timezone=invalid-zone",
          )
        ).status,
      ).toBe(400);
    });
  });

  it("records one impression and permits exposure before setup completes", async () => {
    await withTestHarness(async (harness) => {
      seedOffer(harness);
      const capture = vi.fn();
      harness.deps.telemetry = { capture, setEnabled: vi.fn() };
      const service = createSetupJobService(
        harness.deps,
        harness.pluginService,
      );
      await service.read("UTC");
      expect(capture).not.toHaveBeenCalled();
      await Promise.all(
        Array.from({ length: 4 }, () => service.shown(suggestionAnalyticsId)),
      );
      expect(capture).toHaveBeenCalledExactlyOnceWith({
        name: "suggestion_shown",
        properties: {
          surface: "next_step",
          kind: "automation",
          trigger: "first_run",
          suggestion_analytics_id: suggestionAnalyticsId,
        },
      });
      const response = await harness.app.request(
        "/api/v1/system/holdouts/app_setup_recurring_job/exposure",
        { method: "POST" },
      );
      expect(await response.json()).toEqual({ exposed: true });
    });
  });

  it("dismisses without calling the automations plugin and preserves the decision after restart", async () => {
    await withTestHarness(async (harness) => {
      seedOffer(harness);
      const invoke = vi.spyOn(harness.pluginService, "invokeRpcHandler");
      const service = createSetupJobService(
        harness.deps,
        harness.pluginService,
      );
      const result = await service.decide({
        suggestionAnalyticsId,
        accepted: false,
      });
      expect(result.offer?.status).toBe("dismissed");
      expect(invoke).not.toHaveBeenCalled();
      const restarted = createSetupJobService(
        harness.deps,
        harness.pluginService,
      );
      expect(
        await restarted.decide({ suggestionAnalyticsId, accepted: true }),
      ).toEqual(result);
      expect(invoke).not.toHaveBeenCalled();
    });
  });

  it("creates once across concurrent accepts and sends no private suggestion text in telemetry", async () => {
    await withTestHarness(async (harness) => {
      seedOffer(harness);
      const create = vi
        .spyOn(creation, "createSetupJobAutomation")
        .mockResolvedValue("auto_created");
      const capture = vi.fn();
      harness.deps.telemetry = { capture, setEnabled: vi.fn() };
      const service = createSetupJobService(
        harness.deps,
        harness.pluginService,
      );
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          service.decide({ suggestionAnalyticsId, accepted: true }),
        ),
      );
      expect(
        results.every(
          (result) => result.offer?.automationId === "auto_created",
        ),
      ).toBe(true);
      expect(create).toHaveBeenCalledTimes(1);
      expect(capture).toHaveBeenCalledExactlyOnceWith({
        name: "suggestion_accepted",
        properties: {
          surface: "next_step",
          kind: "automation",
          suggestion_analytics_id: suggestionAnalyticsId,
        },
      });
    });
  });

  it("keeps a failed creation retryable and refuses new acceptance after setup closes", async () => {
    await withTestHarness(async (harness) => {
      seedOffer(harness);
      const create = vi
        .spyOn(creation, "createSetupJobAutomation")
        .mockRejectedValueOnce(new Error("Plugin unavailable"));
      const service = createSetupJobService(
        harness.deps,
        harness.pluginService,
      );
      await expect(
        service.decide({ suggestionAnalyticsId, accepted: true }),
      ).rejects.toThrow("Plugin unavailable");
      expect((await service.read("UTC")).offer?.status).toBe("offered");
      setAppSettings(harness.db, {
        ...getAppSettings(harness.db),
        onboardingCompletedAt: new Date().toISOString(),
      });
      await expect(
        service.decide({ suggestionAnalyticsId, accepted: true }),
      ).rejects.toThrow("Setup has already finished");
      expect(create).toHaveBeenCalledTimes(1);
    });
  });
});
