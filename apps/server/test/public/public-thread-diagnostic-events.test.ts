import { describe, expect, it } from "vitest";
import { setAppSettings, findTimelineWindowBudgetFloorSequence } from "@bb/db";
import { defaultAppSettings, threadScope } from "@bb/domain";
import { threadTimelineResponseSchema } from "@bb/server-contract";
import { internalAuthHeaders } from "../helpers/commands.js";
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
            value: { masked: true },
          },
        ],
      },
    });
    harness.db.$client
      .prepare(
        "UPDATE events SET data = ? WHERE thread_id = ? AND sequence = 2",
      )
      .run(
        JSON.stringify({
          entries: [
            {
              name: "LARGE",
              source: "shell",
              value: "x".repeat(5 * 1024 * 1024),
            },
          ],
        }),
        thread.id,
      );
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

it("serves masked diagnostics from a legacy event without rewriting storage", async () => {
  await withTestHarness(async (harness) => {
    const { thread } = seedThreadFixture(harness);
    const legacy = JSON.stringify({
      entries: [
        {
          name: "DEMO_AUTH_TOKEN",
          source: { plugin: "fixture" },
          value: "fictional-history-3815",
          reason: "Copied fictional-history-3815",
        },
      ],
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      providerThreadId: "fixture-provider",
      scope: threadScope(),
      sequence: 1,
      type: "provider.env-resolved",
      data: { entries: [] },
    });
    harness.db.$client
      .prepare("UPDATE events SET data = ? WHERE thread_id = ?")
      .run(legacy, thread.id);
    setAppSettings(harness.db, {
      ...defaultAppSettings,
      showDiagnosticEvents: true,
    });
    const response = await harness.app.request(
      `/api/v1/threads/${thread.id}/events`,
    );
    const timeline = await harness.app.request(
      `/api/v1/threads/${thread.id}/timeline`,
    );
    expect(response.status).toBe(200);
    expect(timeline.status).toBe(200);
    expect.soft(await readJson(response)).toMatchObject([
      {
        seq: 1,
        type: "provider.env-resolved",
        data: {
          entries: [
            {
              name: "DEMO_AUTH_TOKEN",
              source: { plugin: "fixture" },
              value: { masked: true },
            },
          ],
        },
      },
    ]);
    const timelineText = await timeline.text();
    expect(timelineText).toContain("DEMO_AUTH_TOKEN");
    expect.soft(timelineText).not.toContain("fictional-history-3815");
    expect(
      harness.db.$client
        .prepare("SELECT data FROM events WHERE thread_id = ?")
        .get(thread.id),
    ).toEqual({ data: legacy });
  });
});

it("accepts legacy daemon wire diagnostics and stores only masked provenance", async () => {
  await withTestHarness(async (harness) => {
    const { host, session, thread } = seedThreadFixture(harness);
    const response = await harness.app.request("/internal/session/events", {
      method: "POST",
      headers: internalAuthHeaders(harness, { hostId: host.id }),
      body: JSON.stringify({
        sessionId: session.id,
        eventGroups: [
          {
            threadId: thread.id,
            events: [
              {
                type: "provider.env-resolved",
                threadId: thread.id,
                providerThreadId: "fixture-provider",
                scope: threadScope(),
                entries: [
                  {
                    name: "DEMO_AUTH_TOKEN",
                    source: "shell",
                    value: "fictional-wire-3815",
                  },
                  {
                    name: "ALREADY_MASKED",
                    source: { plugin: "fixture" },
                    value: { masked: true },
                    reason: "fictional-wire-3815",
                  },
                ],
              },
            ],
          },
        ],
      }),
    });
    expect(response.status).toBe(200);
    const stored = harness.db.$client
      .prepare<[string], { data: string }>(
        "SELECT data FROM events WHERE thread_id = ? AND type = 'provider.env-resolved'",
      )
      .get(thread.id);
    expect(JSON.parse(stored?.data ?? "null")).toEqual({
      providerThreadId: "fixture-provider",
      entries: [
        { name: "DEMO_AUTH_TOKEN", source: "shell", value: { masked: true } },
        {
          name: "ALREADY_MASKED",
          source: { plugin: "fixture" },
          value: { masked: true },
        },
      ],
    });
  });
});
