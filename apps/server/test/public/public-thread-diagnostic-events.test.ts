import { describe, expect, it } from "vitest";
import { setAppSettings } from "@bb/db";
import { defaultAppSettings, threadScope } from "@bb/domain";
import { threadTimelineResponseSchema } from "@bb/server-contract";
import { readJson } from "../helpers/json.js";
import { seedEvent, seedThreadFixture } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("diagnostic timeline visibility", () => {
  it.each([false, true])(
    "follows the setting, including cached responses, with development=%s",
    async (isDevelopment) => {
      await withTestHarness({ isDevelopment }, async (harness) => {
        const { thread } = seedThreadFixture(harness);
        const common = {
          threadId: thread.id,
          providerThreadId: "provider-session",
          scope: threadScope(),
        };
        seedEvent(harness.deps, {
          ...common,
          sequence: 1,
          type: "provider/unhandled",
          data: {
            providerId: "codex",
            rawType: "sdk/example",
            rawEvent: { jsonrpc: "2.0", method: "sdk/example" },
          },
        });
        seedEvent(harness.deps, {
          ...common,
          sequence: 2,
          type: "provider.env-resolved",
          data: {
            entries: [
              {
                name: "PLUGIN_TOKEN",
                source: { plugin: "auth" },
                value: { masked: true },
              },
            ],
          },
        });
        seedEvent(harness.deps, {
          ...common,
          sequence: 3,
          type: "provider/warning",
          data: {
            category: "config",
            summary: "A configuration needs attention",
          },
        });
        const readTitles = async () => {
          const response = await harness.app.request(
            `/api/v1/threads/${thread.id}/timeline`,
          );
          expect(response.status).toBe(200);
          const timeline = threadTimelineResponseSchema.parse(
            await readJson(response),
          );
          return timeline.rows.flatMap((row) =>
            row.kind === "system" ? [row.title] : [],
          );
        };
        expect(await readTitles()).toEqual(["Configuration warning"]);
        setAppSettings(harness.db, {
          ...defaultAppSettings,
          showDiagnosticEvents: true,
        });
        expect(await readTitles()).toEqual([
          "Unhandled Codex event",
          "Provider environment resolved",
          "Configuration warning",
        ]);
        setAppSettings(harness.db, defaultAppSettings);
        expect(await readTitles()).toEqual(["Configuration warning"]);
      });
    },
  );
});
