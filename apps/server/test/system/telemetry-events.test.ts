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

  it("forwards accepted release widget events to telemetry unchanged", async () => {
    await withTestHarness(async (harness) => {
      const capture = vi.fn<TelemetryService["capture"]>();
      harness.deps.telemetry = { ...harness.deps.telemetry, capture };
      const events = [
        {
          name: "release_widget_shown",
          properties: { release_version: "0.47.0" },
        },
        {
          name: "release_widget_action",
          properties: { release_version: "0.47.0", action: "open_notes" },
        },
        {
          name: "release_widget_action",
          properties: { release_version: "1.2", action: "dismiss" },
        },
        {
          name: "release_notes_opened",
          properties: { release_version: "0.47.0", entry_point: "widget" },
        },
        {
          name: "release_notes_opened",
          properties: {
            release_version: "0.47.0.1",
            entry_point: "updates_link",
          },
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

  it("rejects release widget events with free-text versions or extra properties", async () => {
    await withTestHarness(async (harness) => {
      const capture = vi.fn<TelemetryService["capture"]>();
      harness.deps.telemetry = { ...harness.deps.telemetry, capture };
      for (const event of [
        {
          name: "release_widget_shown",
          properties: { release_version: "0.47.0; drop" },
        },
        {
          name: "release_widget_shown",
          properties: { release_version: "v0.47.0" },
        },
        {
          name: "release_widget_shown",
          properties: { release_version: "0.47.0-beta.1" },
        },
        {
          name: "release_widget_shown",
          properties: { release_version: `0.${"1".repeat(40)}` },
        },
        {
          name: "release_widget_shown",
          properties: { release_version: "0.47.0", threadId: "thr_123" },
        },
        {
          name: "release_widget_action",
          properties: { release_version: "0.47.0", action: "open" },
        },
        {
          name: "release_widget_action",
          properties: { release_version: "0.47.0", action: "snooze" },
        },
        {
          name: "release_widget_action",
          properties: {
            release_version: "0.47.0",
            action: "open_notes",
            notes: "Release highlights text",
          },
        },
        {
          name: "release_notes_opened",
          properties: {
            release_version: "0.47.0",
            entry_point: "settings_search",
          },
        },
        {
          name: "release_notes_opened",
          properties: {
            release_version: "0.47.0",
            entry_point: "sidebar",
          },
        },
        {
          name: "release_notes_opened",
          properties: {
            release_version: "0.47.0",
            entry_point: "updates_link",
            destination: "external_browser",
          },
        },
        {
          name: "release_notes_opened",
          properties: {
            release_version: "0.47.0",
            entry_point: "widget",
            url: "https://example.com/notes",
          },
        },
      ]) {
        expect((await post(harness, event)).status).toBe(400);
      }
      expect(capture).not.toHaveBeenCalled();
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
});
