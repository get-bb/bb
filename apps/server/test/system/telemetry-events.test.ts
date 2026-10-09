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
      const event = {
        name: "onboarding_step_skipped",
        properties: { step: "projects", entry: "first_run" },
      };

      const response = await post(harness, event);

      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({ ok: true });
      expect(capture).toHaveBeenCalledExactlyOnceWith(event);
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
        name: "notification_prompt_shown",
        properties: { surface: "thread", threadId: "thr_123" },
      });

      expect(unknown.status).toBe(400);
      expect(extra.status).toBe(400);
      expect(capture).not.toHaveBeenCalled();
    });
  });

  it("accepts anonymous tip events and rejects tip ids, positions, or properties outside the allow-list", async () => {
    await withTestHarness(async (harness) => {
      const capture = vi.fn<TelemetryService["capture"]>();
      harness.deps.telemetry = { ...harness.deps.telemetry, capture };
      const shown = {
        name: "tip_shown",
        properties: { tip_id: "child-threads", position: 1, action: "prompt" },
      };
      const used = {
        name: "tip_used",
        properties: {
          tip_id: "account-pool",
          position: 3,
          action: "open-plugin",
        },
      };

      const accepted = [await post(harness, shown), await post(harness, used)];
      const rejected = [
        await post(harness, {
          name: "tip_shown",
          properties: { tip_id: "my-tip", position: 1, action: "prompt" },
        }),
        await post(harness, {
          name: "tip_used",
          properties: {
            tip_id: "child-threads",
            position: 4,
            action: "prompt",
          },
        }),
        await post(harness, {
          name: "tip_used",
          properties: { tip_id: "child-threads", position: 1, action: "share" },
        }),
        await post(harness, {
          name: "tip_shown",
          properties: {
            tip_id: "child-threads",
            position: 1,
            action: "prompt",
            projectId: "proj_123",
          },
        }),
      ];

      expect(accepted.map((response) => response.status)).toEqual([200, 200]);
      expect(rejected.map((response) => response.status)).toEqual([
        400, 400, 400, 400,
      ]);
      expect(capture.mock.calls).toEqual([[shown], [used]]);
    });
  });
});
