import { describe, expect, it } from "vitest";
import { setAppSettings, findTimelineWindowBudgetFloorSequence } from "@bb/db";
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

it("excludes hidden diagnostics from rows and budgets while advancing the history snapshot", async () => {
  await withTestHarness(async (harness) => {
    const { thread } = seedThreadFixture(harness);
    const common = {
      threadId: thread.id,
      providerThreadId: "provider-session",
      scope: threadScope(),
    };
    const readTimeline = async () => {
      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/timeline`,
      );
      expect(response.status).toBe(200);
      return threadTimelineResponseSchema.parse(await readJson(response));
    };
    seedEvent(harness.deps, {
      ...common,
      sequence: 1,
      type: "provider/warning",
      data: { category: "config", summary: "Keep this visible" },
    });
    const before = await readTimeline();
    seedEvent(harness.deps, {
      ...common,
      sequence: 2,
      type: "provider.env-resolved",
      data: {
        entries: [
          {
            name: "LARGE",
            source: "shell",
            value: "x".repeat(5 * 1024 * 1024),
          },
        ],
      },
    });
    seedEvent(harness.deps, {
      ...common,
      sequence: 3,
      type: "provider/unhandled",
      data: {
        providerId: "codex",
        rawType: "noise",
        rawEvent: { jsonrpc: "2.0", method: "noise" },
      },
    });
    const after = await readTimeline();
    expect(after.rows).toEqual(before.rows);
    expect(after.maxSeq).toBe(3);
    expect(after.timelinePage.historySnapshot).not.toBe(
      before.timelinePage.historySnapshot,
    );
    expect(
      findTimelineWindowBudgetFloorSequence(harness.db, {
        threadId: thread.id,
        sequenceStart: 0,
        excludedTypes: [],
        eventBudget: 1,
        excludeDiagnosticEvents: true,
      }),
    ).toBeUndefined();
    for (const [sequence, subtype] of [
      [4, "model_fallback"],
      [5, "model_refusal_fallback"],
    ] as const) {
      seedEvent(harness.deps, {
        ...common,
        sequence,
        type: "provider/unhandled",
        data: {
          providerId: sequence === 4 ? "claude-code" : "custom-provider",
          rawType: "sdk/message",
          rawEvent: {
            jsonrpc: "2.0",
            method: "sdk/message",
            params: {
              message: {
                subtype,
                original_model: "original",
                fallback_model: "fallback",
              },
            },
          },
        },
      });
    }
    const visible = await readTimeline();
    expect(visible.maxSeq).toBe(5);
    expect(
      visible.rows.flatMap((row) => (row.kind === "system" ? [row.title] : [])),
    ).toEqual([
      "Configuration warning",
      "Model fallback: original → fallback",
      "Model fallback: original → fallback",
    ]);
  });
});
