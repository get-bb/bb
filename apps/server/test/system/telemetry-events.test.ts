import { describe, expect, it, vi } from "vitest";
import { LAPSED_RESUME_SUGGESTION } from "@bb/server-contract";
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
  it("accepts anonymous lapse exposure and dismissal while rejecting identifying fields", async () => {
    await withTestHarness(async (harness) => {
      const capture = vi.fn<TelemetryService["capture"]>();
      harness.deps.telemetry = { ...harness.deps.telemetry, capture };
      const suggestionId = "872fd7b3-03e9-4d72-86ee-7907fcf07429";
      const shown = {
        name: "suggestion_shown",
        properties: {
          ...LAPSED_RESUME_SUGGESTION,
          suggestion_analytics_id: suggestionId,
        },
      };
      const dismissed = {
        name: "suggestion_dismissed",
        properties: {
          surface: LAPSED_RESUME_SUGGESTION.surface,
          kind: LAPSED_RESUME_SUGGESTION.kind,
          suggestion_analytics_id: suggestionId,
          dismiss: "not_now",
        },
      };
      for (const event of [shown, dismissed]) {
        capture.mockClear();
        expect((await post(harness, event)).status).toBe(200);
        expect(capture).toHaveBeenCalledExactlyOnceWith(event);
        for (const extra of [
          { threadId: "thr_private" },
          { title: "Private work" },
          { kind: "unapproved_kind" },
          { surface: "sidebar" },
          { suggestion_analytics_id: "account@example.com" },
        ]) {
          capture.mockClear();
          expect(
            (
              await post(harness, {
                ...event,
                properties: { ...event.properties, ...extra },
              })
            ).status,
          ).toBe(400);
          expect(capture).not.toHaveBeenCalled();
        }
      }
    });
  });

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
});
