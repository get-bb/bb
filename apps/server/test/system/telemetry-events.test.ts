import { defaultAppSettings } from "@bb/domain";
import { describe, expect, it, vi } from "vitest";
import type { TelemetryService } from "../../src/services/system/telemetry.js";
import { readJson } from "../helpers/json.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

function post(harness: TestAppHarness, body: unknown) {
  return harness.app.request("/api/v1/system/telemetry/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("client telemetry events", () => {
  it("forwards an accepted onboarding event to telemetry unchanged", async () => {
    await withTestHarness(async (harness) => {
      const capture = vi.fn<TelemetryService["capture"]>();
      harness.deps.telemetry = { ...harness.deps.telemetry, capture };
      const events = [
        {
          name: "onboarding_step_skipped",
          properties: { step: "projects", entry: "first_run" },
        },
        {
          name: "onboarding_agent_state",
          properties: {
            entry: "first_run",
            agent_installed: true,
            agent_ready: false,
          },
        },
        {
          name: "onboarding_agent_state",
          properties: {
            entry: "replay",
            agent_installed: null,
            agent_ready: null,
          },
        },
        {
          name: "onboarding_sign_in",
          properties: { entry: "first_run", outcome: "failed" },
        },
        {
          name: "new_thread_submit",
          properties: { outcome: "failed" },
        },
      ];
      for (const event of events) {
        capture.mockClear();
        const response = await post(harness, event);
        expect(response.status).toBe(200);
        await expect(readJson(response)).resolves.toEqual({ ok: true });
        expect(capture).toHaveBeenCalledExactlyOnceWith(event);
      }
    });
  });

  it("rejects unknown events and identifying extra properties", async () => {
    await withTestHarness(async (harness) => {
      const capture = vi.fn<TelemetryService["capture"]>();
      harness.deps.telemetry = { ...harness.deps.telemetry, capture };

      const unknown = await post(harness, {
        name: "thread_created",
        properties: { is_child_thread: false, provider: "codex" },
      });
      const extra = await post(harness, {
        name: "onboarding_step_reached",
        properties: { step: "agent", entry: "first_run", threadId: "thr_123" },
      });

      expect(unknown.status).toBe(400);
      expect(extra.status).toBe(400);
      for (const event of [
        {
          name: "onboarding_agent_state",
          properties: {
            entry: "first_run",
            agent_installed: "account@example.com",
            agent_ready: false,
          },
        },
        {
          name: "onboarding_sign_in",
          properties: { entry: "first_run", outcome: "account@example.com" },
        },
        {
          name: "new_thread_submit",
          properties: { outcome: "failed", message: "private prompt" },
        },
      ]) {
        expect((await post(harness, event)).status).toBe(400);
      }
      expect(capture).not.toHaveBeenCalled();
    });
  });

  it("accepts automation and split view events and rejects values outside their enums or pane range", async () => {
    await withTestHarness(async (harness) => {
      const capture = vi.fn<TelemetryService["capture"]>();
      harness.deps.telemetry = { ...harness.deps.telemetry, capture };
      const automation = {
        name: "automation_created",
        properties: { trigger: "schedule", mode: "script", origin: "agent" },
      };
      const split = { name: "split_view_opened", properties: { panes: 2 } };

      const accepted = [
        await post(harness, automation),
        await post(harness, split),
      ];
      const rejected = [
        await post(harness, {
          name: "automation_created",
          properties: { ...automation.properties, cron: "0 9 * * *" },
        }),
        await post(harness, {
          name: "automation_created",
          properties: { ...automation.properties, trigger: "interval" },
        }),
        await post(harness, {
          name: "split_view_opened",
          properties: { panes: 1 },
        }),
        await post(harness, {
          name: "split_view_opened",
          properties: { panes: 9 },
        }),
      ];

      expect(accepted.map((response) => response.status)).toEqual([200, 200]);
      expect(rejected.map((response) => response.status)).toEqual([
        400, 400, 400, 400,
      ]);
      expect(capture.mock.calls).toEqual([[automation], [split]]);
    });
  });
  it("counts explicit core actions once, without exporting their inputs or background reads", async () => {
    await withTestHarness(async (harness) => {
      const capture = vi.fn<TelemetryService["capture"]>();
      harness.deps.telemetry = { ...harness.deps.telemetry, capture };
      const response = await harness.app.request("/api/v1/settings/general", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "x-bb-app-surface": "web",
        },
        body: JSON.stringify({
          ...defaultAppSettings,
          showKeyboardHints: false,
        }),
      });
      expect(response.status).toBe(200);
      expect(capture).toHaveBeenCalledExactlyOnceWith({
        name: "feature_used",
        properties: {
          feature: "settings",
          feature_scope: "core",
          interaction: "invoked",
          trigger: "person",
        },
      });
      capture.mockClear();
      await harness.app.request("/api/v1/system/config");
      const rejected = await harness.app.request("/api/v1/settings/general", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(rejected.status).toBe(400);
      expect(capture).not.toHaveBeenCalled();
    });
  });

  it("accepts fixed feature values but rejects identities and caller-supplied plugin provenance", async () => {
    await withTestHarness(async (harness) => {
      const capture = vi.fn<TelemetryService["capture"]>();
      harness.deps.telemetry = { ...harness.deps.telemetry, capture };
      const event = {
        name: "feature_used",
        properties: {
          feature: "split_view",
          feature_scope: "core",
          interaction: "opened",
          trigger: "unknown",
        },
      };
      expect((await post(harness, event)).status).toBe(200);
      for (const properties of [
        { ...event.properties, feature: "my-private-command" },
        { ...event.properties, threadId: "private-thread" },
        { ...event.properties, plugin_source: "builtin" },
        { ...event.properties, feature_scope: "plugin" },
      ])
        expect((await post(harness, { ...event, properties })).status).toBe(
          400,
        );
      expect(capture).toHaveBeenCalledExactlyOnceWith(event);
    });
  });
});
