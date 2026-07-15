import { describe, expect, it } from "vitest";
import { setAppSettings } from "@bb/db";
import { defaultAppSettings, threadScope } from "@bb/domain";
import { threadTimelineResponseSchema } from "@bb/server-contract";
import { readJson } from "../helpers/json.js";
import { seedEvent, seedThreadFixture } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

function hasUnhandledEventRow(
  timeline: ReturnType<typeof threadTimelineResponseSchema.parse>,
): boolean {
  return timeline.rows.some(
    (row) =>
      row.kind === "system" &&
      row.systemKind === "operation" &&
      row.operationKind === "provider-unhandled",
  );
}

describe("provider/unhandled timeline visibility", () => {
  it("is hidden in production by default and shown after the setting is enabled", async () => {
    await withTestHarness({ isDevelopment: false }, async (harness) => {
      const { thread } = seedThreadFixture(harness, {
        thread: { providerId: "claude-code" },
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        providerThreadId: "claude-session-1",
        sequence: 1,
        type: "provider/unhandled",
        scope: threadScope(),
        data: {
          providerId: "claude-code",
          rawType: "sdk/example",
          rawEvent: {
            jsonrpc: "2.0",
            method: "sdk/message",
            params: { type: "example" },
          },
        },
      });

      const readTimeline = async () => {
        const response = await harness.app.request(
          `/api/v1/threads/${thread.id}/timeline`,
        );
        expect(response.status).toBe(200);
        return threadTimelineResponseSchema.parse(await readJson(response));
      };

      expect(hasUnhandledEventRow(await readTimeline())).toBe(false);

      setAppSettings(harness.db, {
        ...defaultAppSettings,
        showUnhandledProviderEvents: true,
      });

      expect(hasUnhandledEventRow(await readTimeline())).toBe(true);
    });
  });

  it("continues to show unhandled events in development builds", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness);
      seedEvent(harness.deps, {
        threadId: thread.id,
        providerThreadId: "codex-session-1",
        sequence: 1,
        type: "provider/unhandled",
        scope: threadScope(),
        data: {
          providerId: "codex",
          rawType: "sdk/example",
          rawEvent: { jsonrpc: "2.0", method: "sdk/example" },
        },
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/timeline`,
      );
      expect(response.status).toBe(200);
      const timeline = threadTimelineResponseSchema.parse(
        await readJson(response),
      );
      expect(hasUnhandledEventRow(timeline)).toBe(true);
    });
  });
});
