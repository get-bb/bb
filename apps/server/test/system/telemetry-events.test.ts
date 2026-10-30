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
        {
          name: "plugin_creation_started",
          properties: { pluginName: "bb-plugin-secret" },
        },
        {
          name: "plugin_link_shared",
          properties: {
            entry_id: "docs",
            marketplace: "bb-official",
            share_method: "email",
          },
        },
        {
          name: "plugin_link_shared",
          properties: {
            entry_id: "docs",
            marketplace: "bb-official",
            share_method: "cli",
            plugin_id: "simple-notes",
          },
        },
      ]) {
        expect((await post(harness, event)).status).toBe(400);
      }
      expect(capture).not.toHaveBeenCalled();
    });
  });

  it.each([
    {
      label: "an official entry by built-in name",
      sent: { entry_id: "docs", marketplace: "bb-official" },
      recorded: {
        plugin_id: "simple-notes",
        entry_id: "simple-notes",
        marketplace: "bb-official",
      },
    },
    {
      label: "an unlisted official entry",
      sent: { entry_id: "provider-codex", marketplace: "bb-official" },
      recorded: { plugin_id: null, entry_id: null, marketplace: null },
    },
    {
      label: "a typed-in entry no catalog lists",
      sent: { entry_id: "my-secret-plugin", marketplace: "acme-internal" },
      recorded: { plugin_id: null, entry_id: null, marketplace: null },
    },
  ])(
    "records plugin_link_shared for $label with checked identifiers",
    async ({ sent, recorded }) => {
      await withTestHarness(async (harness) => {
        const capture = vi.fn<TelemetryService["capture"]>();
        harness.deps.telemetry = { ...harness.deps.telemetry, capture };

        const response = await post(harness, {
          name: "plugin_link_shared",
          properties: { ...sent, share_method: "copy_link" },
        });

        expect(response.status).toBe(200);
        expect(capture).toHaveBeenCalledExactlyOnceWith({
          name: "plugin_link_shared",
          properties: { ...recorded, share_method: "copy_link" },
        });
      });
    },
  );
});
