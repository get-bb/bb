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
});

describe("Playgrounds telemetry", () => {
  it("forwards only the approved fixed categories", async () => {
    await withTestHarness(async (harness) => {
      const capture = vi.fn<TelemetryService["capture"]>();
      harness.deps.telemetry = { ...harness.deps.telemetry, capture };
      for (const kind of ["anatomy", "html", "native"]) {
        const event = { name: "playground_published", properties: { kind } };
        expect((await post(harness, event)).status).toBe(200);
        expect(capture).toHaveBeenLastCalledWith(event);
      }
      for (const format of ["mp4", "gif"]) {
        for (const size of ["square", "landscape", "portrait"]) {
          for (const duration_bucket of [
            "under_15s",
            "15_30s",
            "30_60s",
            "over_60s",
          ]) {
            const event = {
              name: "playground_clip_exported",
              properties: { kind: "anatomy", format, size, duration_bucket },
            };
            capture.mockClear();
            expect((await post(harness, event)).status).toBe(200);
            expect(capture).toHaveBeenCalledExactlyOnceWith(event);
          }
        }
      }
    });
  });

  it("rejects content, identifiers, provider names and unapproved values", async () => {
    await withTestHarness(async (harness) => {
      const capture = vi.fn<TelemetryService["capture"]>();
      harness.deps.telemetry = { ...harness.deps.telemetry, capture };
      const published = {
        name: "playground_published",
        properties: { kind: "html" },
      };
      const clip = {
        name: "playground_clip_exported",
        properties: {
          kind: "anatomy",
          format: "mp4",
          size: "square",
          duration_bucket: "15_30s",
        },
      };
      for (const event of [published, clip]) {
        for (const key of [
          "prompt",
          "title",
          "html",
          "state",
          "path",
          "threadId",
          "playgroundId",
          "provider",
          "seconds",
        ]) {
          expect(
            (
              await post(harness, {
                ...event,
                properties: { ...event.properties, [key]: "private" },
              })
            ).status,
          ).toBe(400);
          expect(
            (await post(harness, { ...event, [key]: "private" })).status,
          ).toBe(400);
        }
        expect(
          (
            await post(harness, {
              ...event,
              properties: { ...event.properties, kind: "private" },
            })
          ).status,
        ).toBe(400);
      }
      for (const field of ["format", "size", "duration_bucket"] as const) {
        expect(
          (
            await post(harness, {
              ...clip,
              properties: { ...clip.properties, [field]: "private" },
            })
          ).status,
        ).toBe(400);
        const properties: Record<string, string> = { ...clip.properties };
        delete properties[field];
        expect((await post(harness, { ...clip, properties })).status).toBe(400);
      }
      expect(capture).not.toHaveBeenCalled();
    });
  });
});
