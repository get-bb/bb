import { listQueuedThreadMessages } from "@bb/db";
import {
  retryTurnResponseSchema,
  sendMessageResponseSchema,
} from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createAgentRuntime } from "../../../../packages/agent-runtime/src/index.js";
import { getThread, getThreadEvents, stopThread } from "../../helpers/api.js";
import {
  waitForEventType,
  waitForThreadStatus,
} from "../../helpers/assertions.js";
import { withHarness, type IntegrationHarness } from "../../helpers/harness.js";
import {
  recordScriptedEchoRequests,
  type ScriptedEchoRecordedRequest,
} from "../../helpers/scripted-echo.js";
import {
  createProjectFixture,
  createReadyThread,
  TURN_TIMEOUT_MS,
} from "../smoke/shared.js";

const ORIGINAL = "[stopped-unaccepted] original request";
const PARKED = ["parked second", "parked third"] as const;
type ThreadEvent = Awaited<ReturnType<typeof getThreadEvents>>[number];
type TurnRequestEvent = Extract<ThreadEvent, { type: "client/turn/requested" }>;
const providerInputSchema = z.object({
  input: z.array(
    z.object({ type: z.string(), text: z.string().optional() }).passthrough(),
  ),
});

function inputText(input: readonly { type: string; text?: string }[]): string {
  return input
    .map((item) => (item.type === "text" ? (item.text ?? "") : ""))
    .join("");
}

function providerInputs(
  requests: readonly ScriptedEchoRecordedRequest[],
  threadId: string,
): string[] {
  return requests.flatMap((request) => {
    if (request.params?.threadId !== threadId) return [];
    const parsed = providerInputSchema.safeParse(request.params);
    return parsed.success ? [inputText(parsed.data.input)] : [];
  });
}

async function waitUntil(
  check: () => boolean | Promise<boolean>,
): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (!(await check())) {
    if (Date.now() >= deadline)
      throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function send(
  harness: IntegrationHarness,
  threadId: string,
  text: string,
) {
  const response = await harness.api.threads[":id"].send.$post({
    param: { id: threadId },
    json: { input: [{ type: "text", text, mentions: [] }], mode: "auto" },
  });
  expect(response.status).toBe(200);
  return sendMessageResponseSchema.parse(await response.json());
}

describe.sequential("stopped unaccepted user request recovery", () => {
  it("retries once, then drains parked messages once in order", async () => {
    const record = await recordScriptedEchoRequests();
    try {
      await withHarness(
        {
          createRuntime: (options) =>
            createAgentRuntime({
              ...options,
              turnStartWatchdog: { thresholdMs: 150, intervalMs: 25 },
            }),
        },
        async (harness) => {
          const project = await createProjectFixture(
            harness,
            "Stopped Unaccepted Recovery",
          );
          const { environment, thread } = await createReadyThread(harness, {
            projectId: project.id,
            workspace: { type: "unmanaged", path: harness.repoDir },
          });
          const baselineRequestCount = (await record.read()).filter(
            (request) => request.params?.threadId === thread.id,
          ).length;

          expect(await send(harness, thread.id, ORIGINAL)).toEqual({
            ok: true,
            delivery: "sent",
          });
          await waitForThreadStatus(
            harness.api,
            thread.id,
            "active",
            TURN_TIMEOUT_MS,
          );
          const runtime = harness.daemonApp.runtimeManager.get(
            environment.id,
          )?.runtime;
          await waitUntil(() =>
            Boolean(runtime?.getLiveThreadIds().includes(thread.id)),
          );
          expect(runtime?.getActiveTurnId(thread.id)).toBeNull();

          const parkedIds: string[] = [];
          for (const text of PARKED) {
            const result = await send(harness, thread.id, text);
            expect(result.delivery).toBe("queued");
            if (result.delivery === "queued") {
              expect(result.queuedMessage.waitingOn).toEqual({
                kind: "turn-starting",
              });
              parkedIds.push(result.queuedMessage.id);
            }
          }
          expect(
            listQueuedThreadMessages(harness.db, thread.id).map(
              (row) => row.id,
            ),
          ).toEqual(parkedIds);

          const watchdog = await waitForEventType(
            harness.api,
            thread.id,
            "system/error",
            TURN_TIMEOUT_MS,
          );
          expect(watchdog.data).toMatchObject({
            code: "provider_turn_start_timeout",
          });
          expect((await getThread(harness.api, thread.id)).status).toBe(
            "active",
          );
          const beforeStop = await getThreadEvents(harness.api, thread.id);
          const original = beforeStop.find(
            (event) =>
              event.type === "client/turn/requested" &&
              inputText(event.data.input) === ORIGINAL,
          );
          if (original?.type !== "client/turn/requested") {
            throw new Error("Missing original request");
          }
          expect(
            beforeStop
              .filter((event) => event.seq > original.seq)
              .map((event) => event.type),
          ).not.toEqual(
            expect.arrayContaining([
              "turn/input/accepted",
              "turn/started",
              "client/turn/rejected",
              "turn/completed",
            ]),
          );

          await stopThread(harness.api, thread.id);
          await waitForThreadStatus(
            harness.api,
            thread.id,
            "idle",
            TURN_TIMEOUT_MS,
          );
          expect(runtime?.getLiveThreadIds()).not.toContain(thread.id);
          expect(
            listQueuedThreadMessages(harness.db, thread.id).map(
              (row) => row.id,
            ),
          ).toEqual(parkedIds);
          const beforeRetry = (await record.read())
            .filter((request) => request.params?.threadId === thread.id)
            .slice(baselineRequestCount);
          expect(providerInputs(beforeRetry, thread.id)).toEqual([ORIGINAL]);
          expect(
            beforeRetry.find((request) => request.method === "thread/stop")
              ?.params?.intent,
          ).toBe("release");

          const response = await harness.api.threads[":id"].retry.$post({
            param: { id: thread.id },
            json: {
              turnRequestId: original.data.requestId,
              sendAt: null,
              reason: "Retry stopped request",
            },
          });
          expect(response.status).toBe(200);
          expect(
            retryTurnResponseSchema.parse(await response.json()),
          ).toMatchObject({
            ok: true,
            delivery: "sent",
            turnRequestId: original.data.requestId,
            attempt: 2,
          });
          await waitForThreadStatus(
            harness.api,
            thread.id,
            "idle",
            TURN_TIMEOUT_MS,
          );
          expect(listQueuedThreadMessages(harness.db, thread.id)).toEqual([]);

          let recoveryRequests: TurnRequestEvent[] = [];
          await waitUntil(async () => {
            recoveryRequests = (await getThreadEvents(harness.api, thread.id))
              .slice(beforeStop.length)
              .filter((event) => event.type === "client/turn/requested");
            return recoveryRequests.length === 3;
          });
          expect(
            recoveryRequests.map((event) => inputText(event.data.input)),
          ).toEqual([ORIGINAL, ...PARKED]);
          expect(recoveryRequests[0]?.data).toMatchObject({
            retryOfRequestId: original.data.requestId,
            retryAttempt: 2,
          });
          await waitUntil(async () => {
            const requests = (await record.read())
              .filter((request) => request.params?.threadId === thread.id)
              .slice(baselineRequestCount + beforeRetry.length);
            return providerInputs(requests, thread.id).length === 3;
          });
          const afterRetry = (await record.read())
            .filter((request) => request.params?.threadId === thread.id)
            .slice(baselineRequestCount);
          expect(
            providerInputs(afterRetry.slice(beforeRetry.length), thread.id),
          ).toEqual([ORIGINAL, ...PARKED]);
          expect(
            afterRetry.filter((request) => request.method === "thread/stop"),
          ).toHaveLength(1);
        },
      );
    } finally {
      await record.dispose();
    }
  });
});
