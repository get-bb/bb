import { nextStepDeliveryAt } from "../../src/services/threads/next-step.js";
import { randomUUID } from "node:crypto";
import { nextSteps } from "@bb/db";
import { nextStepSchema, turnScope, type NextStep } from "@bb/domain";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { TelemetryService } from "../../src/services/system/telemetry.js";
import { readJson } from "../helpers/json.js";
import {
  seedEvent,
  seedThreadFixture,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

function seedCompletedTurn(harness: TestAppHarness) {
  const fixture = seedThreadFixture(harness);
  const turnId = `turn-${randomUUID()}`;
  const evidenceId = `message-${randomUUID()}`;
  seedThreadRuntimeState(harness.deps, {
    threadId: fixture.thread.id,
    environmentId: fixture.environment.id,
    providerThreadId: "provider-thread",
  });
  const context = {
    threadId: fixture.thread.id,
    environmentId: fixture.environment.id,
    providerThreadId: "provider-thread",
    scope: turnScope(turnId),
  };
  seedEvent(harness.deps, {
    ...context,
    sequence: 3,
    type: "turn/started",
    data: {},
  });
  seedEvent(harness.deps, {
    ...context,
    sequence: 4,
    type: "item/completed",
    data: {
      item: {
        type: "agentMessage",
        id: evidenceId,
        text: "Private repository evidence for a follow-up task",
      },
    },
  });
  seedEvent(harness.deps, {
    ...context,
    sequence: 5,
    type: "turn/completed",
    data: { status: "completed" },
  });
  return { ...fixture, turnId, evidenceId };
}

function captureTelemetry(harness: TestAppHarness) {
  const capture = vi.fn<TelemetryService["capture"]>();
  harness.deps.telemetry = { ...harness.deps.telemetry, capture };
  return capture;
}

function postAction(
  harness: TestAppHarness,
  threadId: string,
  action: "shown" | "accept" | "dismiss" | "undo",
  surface: string,
  body?: unknown,
) {
  return harness.app.request(
    `/api/v1/threads/${threadId}/next-step/${action}`,
    {
      method: "POST",
      headers: {
        "x-bb-app-surface": surface,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );
}

async function proposeTask(harness: TestAppHarness) {
  const fixture = seedCompletedTurn(harness);
  const response = await harness.app.request(
    `/api/v1/threads/${fixture.thread.id}/next-step/propose`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        turnId: fixture.turnId,
        input: {
          title: "Fix private repository follow-up",
          why: "Private context motivates this follow-up",
          evidence: [{ source: "conversation", ref: fixture.evidenceId }],
          action: {
            kind: "task",
            task: { prompt: "Private follow-up instructions", parallel: true },
          },
        },
      }),
    },
  );
  expect(response.status).toBe(200);
  return nextStepSchema.parse(await readJson(response));
}

function seedOfferedAutomation(harness: TestAppHarness): NextStep {
  const fixture = seedCompletedTurn(harness);
  const suggestion: NextStep = {
    id: `nst_${randomUUID()}`,
    analyticsId: randomUUID(),
    threadId: fixture.thread.id,
    turnId: fixture.turnId,
    title: "Private morning result",
    why: "Private CI details",
    evidence: [{ source: "conversation", ref: fixture.evidenceId }],
    action: {
      kind: "automation",
      automation: {
        prompt: "Read private CI failures",
        schedule: { runAt: Date.now() + 86_400_000, timezone: "UTC" },
      },
    },
    status: "proposed",
    createdAt: Date.now() - 31 * 60_000,
    shownAt: null,
    result: null,
  };
  harness.db
    .insert(nextSteps)
    .values({
      threadId: suggestion.threadId,
      turnId: suggestion.turnId,
      kind: "automation",
      status: suggestion.status,
      suggestion,
      completedAt: suggestion.createdAt,
    })
    .run();
  return suggestion;
}

describe("Next step route analytics", () => {
  it("normalizes an agent-proposed time to the next weekday morning", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedCompletedTurn(harness);
      const proposedAt = Date.now();
      const clock = vi.spyOn(Date, "now").mockReturnValue(proposedAt);
      try {
        const response = await harness.app.request(
          `/api/v1/threads/${fixture.thread.id}/next-step/propose`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              turnId: fixture.turnId,
              input: {
                title: "Prepare the CI summary",
                why: "The completed checks need triage",
                evidence: [{ source: "conversation", ref: fixture.evidenceId }],
                action: {
                  kind: "automation",
                  automation: {
                    prompt: "Summarize the failing checks",
                    schedule: { runAt: 1, timezone: "America/New_York" },
                  },
                },
              },
            }),
          },
        );
        expect(response.status).toBe(200);
        expect(
          nextStepSchema.parse(await readJson(response)).action,
        ).toMatchObject({
          automation: {
            schedule: {
              runAt: nextStepDeliveryAt(proposedAt, "America/New_York"),
              timezone: "America/New_York",
            },
          },
        });
      } finally {
        clock.mockRestore();
      }
    });
  });

  it("ignores mobile and API impressions, then records one anonymous impression across web and desktop", async () => {
    await withTestHarness(async (harness) => {
      const capture = captureTelemetry(harness);
      const suggestion = await proposeTask(harness);
      expect(capture).not.toHaveBeenCalled();
      for (const surface of ["mobile", "api", "unknown"]) {
        const response = await postAction(
          harness,
          suggestion.threadId,
          "shown",
          surface,
        );
        expect(response.status).toBe(200);
        expect(
          nextStepSchema.parse(await readJson(response)).shownAt,
        ).toBeNull();
      }
      expect(capture).not.toHaveBeenCalled();
      for (const surface of ["web", "desktop", "web"]) {
        const response = await postAction(
          harness,
          suggestion.threadId,
          "shown",
          surface,
          {
            kind: "plugin",
            suggestion_analytics_id: "client-controlled-id",
            title: "Never include this title",
          },
        );
        expect(response.status).toBe(200);
      }
      expect(capture).toHaveBeenCalledExactlyOnceWith({
        name: "suggestion_shown",
        properties: {
          surface: "next_step",
          kind: "task",
          trigger: "agent",
          suggestion_analytics_id: suggestion.analyticsId,
        },
      });
    });
  });

  it("records a mobile dismissal at the server once, without suggestion content or domain IDs", async () => {
    await withTestHarness(async (harness) => {
      const capture = captureTelemetry(harness);
      const suggestion = await proposeTask(harness);
      await postAction(harness, suggestion.threadId, "shown", "mobile");
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await postAction(
          harness,
          suggestion.threadId,
          "dismiss",
          "mobile",
        );
        expect(response.status).toBe(200);
        expect(nextStepSchema.parse(await readJson(response)).status).toBe(
          "dismissed",
        );
      }
      expect(capture).toHaveBeenCalledExactlyOnceWith({
        name: "suggestion_dismissed",
        properties: {
          surface: "next_step",
          kind: "task",
          suggestion_analytics_id: suggestion.analyticsId,
          dismiss: "this_thread",
        },
      });
    });
  });

  it("keeps an unavailable automation offer retryable and creates once after the handler becomes available", async () => {
    await withTestHarness(async (harness) => {
      const suggestion = seedOfferedAutomation(harness);
      const lookup = vi
        .spyOn(harness.pluginService, "getRpcHandler")
        .mockReturnValue({ outcome: "not-found" });
      const invoke = vi
        .spyOn(harness.pluginService, "invokeRpcHandler")
        .mockResolvedValue({
          ok: true,
          result: { id: "restored-automation" },
          tags: [],
          keyTags: {},
          invalidated: [],
        });
      try {
        const unavailable = await postAction(
          harness,
          suggestion.threadId,
          "accept",
          "web",
        );
        expect(unavailable.status).toBe(409);
        expect(await readJson(unavailable)).toMatchObject({
          code: "next_step_automations_unavailable",
        });
        expect(invoke).not.toHaveBeenCalled();
        const stillOffered = await harness.app.request(
          `/api/v1/threads/${suggestion.threadId}/next-step`,
        );
        expect(nextStepSchema.parse(await readJson(stillOffered)).status).toBe(
          "proposed",
        );
        lookup.mockReturnValue({
          outcome: "found",
          value: {
            publication: null,
            declarations: {},
            inputSchema: z.object({}).passthrough(),
            outputSchema: z.object({ id: z.string() }),
            handler: async () => ({ id: "restored-automation" }),
          },
        });
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const accepted = await postAction(
            harness,
            suggestion.threadId,
            "accept",
            "web",
          );
          expect(accepted.status).toBe(200);
          expect(nextStepSchema.parse(await readJson(accepted))).toMatchObject({
            status: "accepted",
            result: { kind: "automation", automationId: "restored-automation" },
          });
        }
        expect(invoke.mock.calls.map((call) => call[1])).toEqual([
          "automations_create",
          "automations_run",
        ]);
      } finally {
        lookup.mockRestore();
        invoke.mockRestore();
      }
    });
  });

  it("creates one automation and records one mobile acceptance across racing and repeated clicks", async () => {
    await withTestHarness(async (harness) => {
      const capture = captureTelemetry(harness);
      const suggestion = seedOfferedAutomation(harness);
      let releaseCreate: () => void = () => {};
      const held = new Promise<void>((resolve) => {
        releaseCreate = resolve;
      });
      const record = {
        publication: null,
        declarations: {},
        inputSchema: z.object({}).passthrough(),
        outputSchema: z.object({ id: z.string() }),
        handler: async () => ({ id: "automation-private-id" }),
      };
      const lookup = vi
        .spyOn(harness.pluginService, "getRpcHandler")
        .mockReturnValue({
          outcome: "found",
          value: record,
        });
      const invoke = vi
        .spyOn(harness.pluginService, "invokeRpcHandler")
        .mockImplementation(async (_pluginId, method) => {
          if (method === "automations_run") {
            const stored = harness.db.select().from(nextSteps).get();
            expect(stored?.suggestion).toMatchObject({
              status: "accepting",
              result: {
                kind: "automation",
                automationId: "automation-private-id",
              },
            });
          }
          await held;
          return {
            ok: true,
            result: { id: "automation-private-id" },
            tags: [],
            keyTags: {},
            invalidated: [],
          };
        });
      try {
        const first = postAction(
          harness,
          suggestion.threadId,
          "accept",
          "mobile",
        );
        await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
        const competing = await postAction(
          harness,
          suggestion.threadId,
          "accept",
          "web",
        );
        expect(competing.status).toBe(409);
        expect(capture).not.toHaveBeenCalled();
        releaseCreate();
        expect((await first).status).toBe(200);
        const repeated = await postAction(
          harness,
          suggestion.threadId,
          "accept",
          "mobile",
        );
        expect(repeated.status).toBe(200);
        expect(
          nextStepSchema.parse(await readJson(repeated.clone())).result,
        ).toEqual({
          kind: "automation",
          automationId: "automation-private-id",
        });
        expect(invoke).toHaveBeenCalledTimes(2);
        expect(invoke.mock.calls[0]?.[0]).toBe("automations");
        expect(invoke.mock.calls[0]?.[1]).toBe("automations_create");
        const execution = z
          .object({
            execution: z.object({
              day2ResultDelivery: z.object({
                acceptedAt: z.number(),
                deliverAt: z.number(),
              }),
            }),
          })
          .parse(invoke.mock.calls[0]?.[3]).execution;
        const { acceptedAt, deliverAt } = execution.day2ResultDelivery;
        expect(deliverAt).toBe(nextStepDeliveryAt(acceptedAt, "UTC"));
        expect(invoke.mock.calls[0]?.[3]).toMatchObject({
          enabled: false,
          trigger: { triggerType: "once", runAt: deliverAt },
          execution: { resultNotificationKind: "day2_result" },
        });
        expect(invoke.mock.calls[1]?.[1]).toBe("automations_run");
        expect(invoke.mock.calls[1]?.[3]).toEqual({
          projectId: expect.any(String),
          automationId: "automation-private-id",
          idempotencyKey: suggestion.id,
        });
        expect(
          nextStepSchema.parse(await readJson(repeated)).action,
        ).toMatchObject({
          automation: { schedule: { runAt: deliverAt } },
        });
        expect(capture).toHaveBeenCalledExactlyOnceWith({
          name: "suggestion_accepted",
          properties: {
            surface: "next_step",
            kind: "automation",
            suggestion_analytics_id: suggestion.analyticsId,
          },
        });
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const undone = await postAction(
            harness,
            suggestion.threadId,
            "undo",
            "web",
          );
          expect(undone.status).toBe(200);
          expect(nextStepSchema.parse(await readJson(undone)).status).toBe(
            "undone",
          );
        }
        expect(invoke.mock.calls.map((call) => [call[0], call[1]])).toEqual([
          ["automations", "automations_create"],
          ["automations", "automations_run"],
          ["push-notifications", "experimental_cancelDay2Result"],
          ["automations", "automations_delete"],
        ]);
        expect(invoke.mock.calls[2]?.[3]).toEqual({
          automationId: "automation-private-id",
        });
      } finally {
        releaseCreate();
        lookup.mockRestore();
        invoke.mockRestore();
      }
    });
  });

  it("refuses forged suggestion events at the generic telemetry boundary", async () => {
    await withTestHarness(async (harness) => {
      const capture = captureTelemetry(harness);
      for (const name of [
        "suggestion_shown",
        "suggestion_accepted",
        "suggestion_dismissed",
      ]) {
        const response = await harness.app.request(
          "/api/v1/system/telemetry/events",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              name,
              properties: {
                surface: "next_step",
                kind: "task",
                suggestion_analytics_id: randomUUID(),
                title: "Private title",
                threadId: "private-thread-id",
              },
            }),
          },
        );
        expect(response.status).toBe(400);
      }
      expect(capture).not.toHaveBeenCalled();
    });
  });
});
