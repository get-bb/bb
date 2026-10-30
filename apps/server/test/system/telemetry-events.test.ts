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
  it("accepts bounded journey observations and rejects private context", async () => {
    await withTestHarness(async (harness) => {
      const capture = vi.fn<TelemetryService["capture"]>();
      harness.deps.telemetry = { ...harness.deps.telemetry, capture };
      const events = [
        {
          name: "onboarding_agent_diagnostic",
          properties: {
            source: "first_run",
            state: "unknown",
            trigger: "step_visible",
            any_agent_ready: null,
            action_available: null,
          },
        },
        {
          name: "onboarding_project_state",
          properties: {
            source: "first_run",
            action: "scan_result",
            result: "empty",
            selection: "none",
          },
        },
        {
          name: "new_thread_blocker",
          properties: {
            state: "shown",
            reason: "sign_in",
            source: "unknown",
          },
        },
        {
          name: "onboarding_work_surface",
          properties: {
            surface: "first_task",
            action: "displayed",
            entry: "skipped_guide",
          },
        },
      ];
      for (const event of events) {
        capture.mockClear();
        expect((await post(harness, event)).status).toBe(200);
        expect(capture).toHaveBeenCalledExactlyOnceWith(event);
        capture.mockClear();
        expect(
          (
            await post(harness, {
              ...event,
              properties: { ...event.properties, prompt: "private content" },
            })
          ).status,
        ).toBe(400);
        expect(capture).not.toHaveBeenCalled();
      }
      for (const properties of [
        {
          source: "first_run",
          action: "folder_opened",
          result: "selected",
          selection: "some",
        },
        {
          source: "first_run",
          action: "scan_result",
          result: "cancelled",
          selection: "none",
        },
      ]) {
        expect(
          (
            await post(harness, {
              name: "onboarding_project_state",
              properties,
            })
          ).status,
        ).toBe(400);
      }
      expect(capture).not.toHaveBeenCalled();
    });
  });

  it("forwards an accepted onboarding event to telemetry unchanged", async () => {
    await withTestHarness(async (harness) => {
      const capture = vi.fn<TelemetryService["capture"]>();
      harness.deps.telemetry = { ...harness.deps.telemetry, capture };
      const events = [
        {
          name: "onboarding_operation",
          properties: {
            entry: "first_run",
            operation: "project_import",
            outcome: "partial",
            error_category: "request",
            selected_count: 3,
            succeeded_count: 2,
          },
        },
        {
          name: "onboarding_operation",
          properties: {
            entry: "replay",
            operation: "agent_install",
            outcome: "unknown",
            error_category: "request",
          },
        },
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
          name: "onboarding_operation",
          properties: {
            entry: "first_run",
            operation: "project_import",
            outcome: "succeeded",
            error_category: null,
            selected_count: 3,
            succeeded_count: 2,
          },
        },
        {
          name: "onboarding_operation",
          properties: {
            entry: "first_run",
            operation: "agent_install",
            outcome: "failed",
            error_category: "request",
            command: "private command",
          },
        },
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
