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
          name: "onboarding_agent_state",
          properties: {
            entry: "first_run",
            agent_installed: true,
            agent_ready: false,
            agent_statuses: {
              "claude-code": "unauthenticated",
              codex: "not_installed",
              pi: "unknown",
              "acp-cursor": "expired",
              "acp-grok": "unsupported_version",
              "acp-hermes-agent": "ready",
            },
          },
        },
        {
          name: "onboarding_sign_in",
          properties: {
            entry: "first_run",
            outcome: "failed",
            resource_id: "codex",
            failure_reason: "command_failed",
          },
        },
        {
          name: "onboarding_sign_in",
          properties: {
            entry: "replay",
            outcome: "started",
            resource_id: "claude-code",
          },
        },
        {
          name: "new_thread_submit",
          properties: { outcome: "failed" },
        },
        {
          name: "new_thread_submit",
          properties: { outcome: "failed", failure_reason: "host_unavailable" },
        },
        {
          name: "onboarding_left",
          properties: { step: "plugins", entry: "replay" },
        },
        {
          name: "onboarding_error",
          properties: { step: "projects", entry: "first_run", kind: "render" },
        },
        {
          name: "onboarding_error",
          properties: {
            step: "agent",
            entry: "replay",
            kind: "unhandled_rejection",
          },
        },
        {
          name: "onboarding_operation",
          properties: {
            entry: "first_run",
            step: "agent",
            operation: "install",
            outcome: "failed",
            resource_id: "claude-code",
          },
        },
        {
          name: "new_thread_blocker",
          properties: { reason: "sign_in" },
        },
        {
          name: "onboarding_operation",
          properties: {
            entry: "first_run",
            step: "devices",
            operation: "remote_access",
            outcome: "succeeded",
          },
        },
        {
          name: "recommendation",
          properties: {
            resource_type: "plugin",
            resource_id: "bb--prompt-library",
            recommendation_id: "V1StGXR8_Z5jdHi6B-myT",
            action: "selected",
            surface: "onboarding",
            entry: "first_run",
          },
        },
        {
          name: "recommendation",
          properties: {
            resource_type: "plugin",
            resource_id: "bb--prompt-library",
            recommendation_id: "V1StGXR8_Z5jdHi6B-myT",
            action: "deselected",
            surface: "onboarding",
            entry: "first_run",
          },
        },
        {
          name: "onboarding_operation",
          properties: {
            entry: "replay",
            step: "projects",
            operation: "import",
            outcome: "failed",
            item_count: 3,
            succeeded_count: 1,
            failure_reason: "host_unavailable",
          },
        },
        {
          name: "onboarding_operation",
          properties: {
            entry: "first_run",
            step: "projects",
            operation: "scan",
            outcome: "succeeded",
            item_count: 0,
            timed_out: true,
            unreadable_count: 2,
          },
        },
        {
          name: "onboarding_operation",
          properties: {
            entry: "first_run",
            step: "projects",
            operation: "scan",
            outcome: "failed",
            failure_reason: "no_host",
          },
        },
        {
          name: "onboarding_operation",
          properties: {
            entry: "first_run",
            step: "agent",
            operation: "load",
            outcome: "failed",
            failure_reason: "timed_out",
          },
        },
        {
          name: "onboarding_operation",
          properties: {
            entry: "first_run",
            step: "plugins",
            operation: "install",
            outcome: "failed",
            resource_id: "workflows",
            failure_reason: "command_failed",
          },
        },
        {
          name: "onboarding_operation",
          properties: {
            entry: "first_run",
            step: "plugins",
            operation: "enable",
            outcome: "failed",
            resource_id: "workflows",
            failure_reason: "permission",
          },
        },
        {
          name: "onboarding_operation",
          properties: {
            entry: "replay",
            step: "plugins",
            operation: "disable",
            outcome: "failed",
            resource_id: "workflows",
            failure_reason: "not_found",
          },
        },
        {
          name: "onboarding_operation",
          properties: {
            entry: "first_run",
            step: "devices",
            operation: "remote_access",
            outcome: "failed",
            failure_stage: "pairing",
          },
        },
        {
          name: "onboarding_operation",
          properties: {
            entry: "first_run",
            step: "devices",
            operation: "add_machine",
            outcome: "failed",
            failure_reason: "unsupported",
          },
        },
        {
          name: "onboarding_operation",
          properties: {
            entry: "first_run",
            step: "agent",
            operation: "finish",
            outcome: "failed",
            failure_reason: "other",
          },
        },
        { name: "plugin_creation_started", properties: {} },
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

  it("reports a custom agent id as other", async () => {
    await withTestHarness(async (harness) => {
      const capture = vi.fn<TelemetryService["capture"]>();
      harness.deps.telemetry = { ...harness.deps.telemetry, capture };
      const properties = {
        entry: "first_run",
        step: "agent",
        operation: "install",
        outcome: "started",
      } as const;

      const response = await post(harness, {
        name: "onboarding_operation",
        properties: { ...properties, resource_id: "my-company-agent" },
      });

      expect(response.status).toBe(200);
      expect(capture).toHaveBeenCalledExactlyOnceWith({
        name: "onboarding_operation",
        properties: { ...properties, resource_id: "other" },
      });
    });
  });

  it("drops custom agents from the agent step's per-agent statuses", async () => {
    await withTestHarness(async (harness) => {
      const capture = vi.fn<TelemetryService["capture"]>();
      harness.deps.telemetry = { ...harness.deps.telemetry, capture };
      const properties = {
        entry: "first_run",
        agent_installed: true,
        agent_ready: true,
      } as const;

      const response = await post(harness, {
        name: "onboarding_agent_state",
        properties: {
          ...properties,
          agent_statuses: {
            codex: "unauthenticated",
            "acp-my-private-agent": "ready",
            "Jane's Agent": "ready",
          },
        },
      });

      expect(response.status).toBe(200);
      expect(capture).toHaveBeenCalledExactlyOnceWith({
        name: "onboarding_agent_state",
        properties: {
          ...properties,
          agent_statuses: { codex: "unauthenticated" },
        },
      });
    });
  });

  it("reports a custom agent's sign-in as other", async () => {
    await withTestHarness(async (harness) => {
      const capture = vi.fn<TelemetryService["capture"]>();
      harness.deps.telemetry = { ...harness.deps.telemetry, capture };
      const properties = {
        entry: "first_run",
        outcome: "failed",
        failure_reason: "host_unavailable",
      } as const;

      const response = await post(harness, {
        name: "onboarding_sign_in",
        properties: { ...properties, resource_id: "acp-my-private-agent" },
      });

      expect(response.status).toBe(200);
      expect(capture).toHaveBeenCalledExactlyOnceWith({
        name: "onboarding_sign_in",
        properties: { ...properties, resource_id: "other" },
      });
    });
  });

  it("forwards accepted release notes events to telemetry unchanged", async () => {
    await withTestHarness(async (harness) => {
      const capture = vi.fn<TelemetryService["capture"]>();
      harness.deps.telemetry = { ...harness.deps.telemetry, capture };
      const events = [
        {
          name: "release_notes_opened",
          properties: { release_version: "0.47.0", view: "inline" },
        },
        {
          name: "release_notes_opened",
          properties: { release_version: "0.47.0.1", view: "web" },
        },
        {
          name: "release_notes_opened",
          properties: { release_version: "1.2", view: "inline" },
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

  it("rejects release notes events with free-text versions or extra properties", async () => {
    await withTestHarness(async (harness) => {
      const capture = vi.fn<TelemetryService["capture"]>();
      harness.deps.telemetry = { ...harness.deps.telemetry, capture };
      const opened = (properties: Record<string, unknown>) => ({
        name: "release_notes_opened",
        properties: { view: "inline", ...properties },
      });
      for (const event of [
        opened({ release_version: "0.47.0; drop" }),
        opened({ release_version: "v0.47.0" }),
        opened({ release_version: "0.47.0-beta.1" }),
        opened({ release_version: `0.${"1".repeat(40)}` }),
        opened({ release_version: "0.47.0", threadId: "thr_123" }),
        opened({ release_version: "0.47.0", view: "panel" }),
        opened({
          release_version: "0.47.0",
          url: "https://example.com/notes",
        }),
        {
          name: "release_notes_opened",
          properties: {
            release_version: "0.47.0",
            entry_point: "updates_link",
          },
        },
        {
          name: "release_notes_preview_shown",
          properties: { release_version: "0.47.0", update_available: true },
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
          name: "onboarding_operation",
          properties: {
            entry: "first_run",
            step: "projects",
            operation: "scan",
            outcome: "failed",
            failure_reason: "EACCES: permission denied, opendir '/Users/a'",
          },
        },
        {
          name: "onboarding_operation",
          properties: {
            entry: "first_run",
            step: "projects",
            operation: "scan",
            outcome: "succeeded",
            unreadable_count: -1,
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
          name: "onboarding_sign_in",
          properties: { entry: "first_run", outcome: "started" },
        },
        {
          name: "onboarding_sign_in",
          properties: {
            entry: "first_run",
            outcome: "failed",
            resource_id: "codex",
            failure_reason: "spawn /usr/local/bin/codex ENOENT",
          },
        },
        {
          name: "onboarding_operation",
          properties: {
            entry: "first_run",
            step: "devices",
            operation: "remote_access",
            outcome: "failed",
            failure_stage: "That code is invalid or has expired.",
          },
        },
        {
          name: "onboarding_operation",
          properties: {
            entry: "first_run",
            step: "plugins",
            operation: "Install Workflows",
            outcome: "failed",
          },
        },
        {
          name: "new_thread_submit",
          properties: { outcome: "failed", message: "private prompt" },
        },
        {
          name: "new_thread_submit",
          properties: {
            outcome: "failed",
            failure_reason: "HTTP 502: Host /Users/me is not connected",
          },
        },
        {
          name: "new_thread_submit",
          properties: { outcome: "accepted", failure_reason: "other" },
        },
        {
          name: "onboarding_left",
          properties: {
            step: "Devices: pairing code 123456",
            entry: "first_run",
          },
        },
        {
          name: "onboarding_left",
          properties: {
            step: "devices",
            entry: "first_run",
            url: "https://example.com/private",
          },
        },
        {
          name: "onboarding_error",
          properties: {
            step: "agent",
            entry: "first_run",
            kind: "uncaught",
            message: "Cannot read properties of undefined",
          },
        },
        {
          name: "onboarding_error",
          properties: {
            step: "agent",
            entry: "first_run",
            kind: "TypeError: x is undefined",
          },
        },
        {
          name: "onboarding_error",
          properties: { step: "agent", entry: "first_run" },
        },
        {
          name: "new_thread_blocker",
          properties: { reason: "sign_in", message: "Not signed in." },
        },
        {
          name: "recommendation",
          properties: {
            resource_type: "plugin",
            resource_id: "workflows",
            recommendation_id: "user@example.com",
            action: "shown",
            surface: "onboarding",
            entry: "first_run",
          },
        },
        {
          name: "onboarding_operation",
          properties: {
            entry: "first_run",
            step: "projects",
            operation: "scan",
            outcome: "succeeded",
            resource_id: "/Users/me/private-repo",
          },
        },
        {
          name: "onboarding_operation",
          properties: {
            entry: "first_run",
            step: "agent",
            operation: "install",
            outcome: "failed",
            error: "exit 1",
          },
        },
        {
          name: "plugin_creation_started",
          properties: { pluginName: "bb-plugin-secret" },
        },
        {
          name: "onboarding_agent_state",
          properties: {
            entry: "first_run",
            agent_installed: true,
            agent_ready: true,
            agent_status_codex: "ready",
          },
        },
        {
          name: "onboarding_agent_state",
          properties: {
            entry: "first_run",
            agent_installed: true,
            agent_ready: true,
            agent_statuses: { "claude-code": "person@example.com" },
          },
        },
        {
          name: "onboarding_agent_state",
          properties: {
            entry: "first_run",
            agent_installed: true,
            agent_ready: true,
            agent_statuses: Object.fromEntries(
              Array.from({ length: 65 }, (_, index) => [
                `agent-${index}`,
                "ready",
              ]),
            ),
          },
        },
      ]) {
        expect((await post(harness, event)).status).toBe(400);
      }
      expect(capture).not.toHaveBeenCalled();
    });
  });
});
