import {
  getActiveStoredTurnId,
  getThread,
  getUnstartedLatestStartTurnRequest,
  listEvents,
  queuedThreadMessages,
} from "@bb/db";
import { turnScope, type ThreadEvent } from "@bb/domain";
import { groupHostDaemonEvents } from "@bb/host-daemon-contract";
import { retryTurnRequestSchema } from "@bb/server-contract";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/errors.js";
import {
  returnUnsettledSubmittedInputs,
  SUBMITTED_INPUT_SETTLE_MS,
} from "../../src/services/threads/input-ledger.js";
import { runQueuedMessageDispatch } from "../../src/services/threads/queued-message-dispatch.js";
import {
  stopRunsWhoseTurnNeverStarted,
  TURN_START_DEADLINE_MS,
} from "../../src/services/threads/thread-lifecycle.js";
import { acceptThreadSendRequest } from "../../src/services/threads/thread-send-request.js";
import { retryFailedTurn } from "../../src/services/threads/turn-retry.js";
import {
  internalAuthHeaders,
  listPendingQueuedCommands,
  reportQueuedCommandError,
  reportQueuedCommandSuccess,
  type QueuedCommand,
} from "../helpers/commands.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const SEEDS = 100;
const STEPS = 36;

type Operation =
  | "send"
  | "answer-submit"
  | "reject-submit"
  | "start-turn"
  | "complete-turn"
  | "fail-turn"
  | "answer-stop"
  | "tick"
  | "retry";

const OPERATIONS: readonly Operation[] = [
  "send",
  "send",
  "answer-submit",
  "answer-submit",
  "reject-submit",
  "start-turn",
  "complete-turn",
  "fail-turn",
  "answer-stop",
  "tick",
  "retry",
];

function createRandom(seed: number): () => number {
  let state = seed * 2654435761;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Provider {
  pendingStartAt: number;
  pendingStartRequestId: string | null;
  turnId: string | null;
  turns: number;
}

interface Fixture {
  harness: TestAppHarness;
  providerThreadId: string;
  sessionId: string;
  threadId: string;
}

async function settle(): Promise<void> {
  for (let round = 0; round < 8; round += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

function seedFixture(harness: TestAppHarness, seed: number): Fixture {
  const { host, session } = seedHostSession(harness.deps, {
    id: `host-model-${seed}`,
  });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: `/tmp/model-${seed}`,
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: `/tmp/model-${seed}`,
    status: "ready",
  });
  const thread = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    status: "idle",
  });
  const providerThreadId = `provider-model-${seed}`;
  seedThreadRuntimeState(harness.deps, {
    environmentId: environment.id,
    providerThreadId,
    threadId: thread.id,
  });
  return {
    harness,
    providerThreadId,
    sessionId: session.id,
    threadId: thread.id,
  };
}

async function postEvents(
  fixture: Fixture,
  events: ThreadEvent[],
): Promise<void> {
  const response = await fixture.harness.app.request(
    "/internal/session/events",
    {
      method: "POST",
      headers: internalAuthHeaders(fixture.harness),
      body: JSON.stringify({
        sessionId: fixture.sessionId,
        eventGroups: groupHostDaemonEvents(
          events.map((event) => ({ threadId: fixture.threadId, event })),
        ),
      }),
    },
  );
  expect(response.status, await response.clone().text()).toBe(200);
}

function inputAccepted(
  fixture: Fixture,
  requestId: string,
  turnId: string,
): ThreadEvent {
  return {
    type: "turn/input/accepted",
    threadId: fixture.threadId,
    providerThreadId: fixture.providerThreadId,
    scope: turnScope(turnId),
    clientRequestId: requestId,
  };
}

function pendingCommands(
  fixture: Fixture,
  type: "thread.stop" | "turn.submit",
): QueuedCommand[] {
  return listPendingQueuedCommands(fixture.harness).filter(
    ({ command }) =>
      command.type === type &&
      "threadId" in command &&
      command.threadId === fixture.threadId,
  );
}

async function answerSubmit(
  fixture: Fixture,
  provider: Provider,
  queued: QueuedCommand,
): Promise<void> {
  const { command } = queued;
  if (command.type !== "turn.submit") throw new Error("Expected turn.submit");
  const busy =
    provider.turnId !== null || provider.pendingStartRequestId !== null;
  if (command.target.mode === "start" || provider.turnId === null) {
    if (busy) {
      await reportQueuedCommandError(fixture.harness, queued, {
        errorCode: "competing_turn",
        errorMessage: "Refusing to start a competing turn",
      });
      return;
    }
    provider.pendingStartRequestId = command.requestId;
    provider.pendingStartAt = Date.now();
    await reportQueuedCommandSuccess(fixture.harness, queued, {
      trace: { spans: [] },
    });
    return;
  }
  if (
    command.target.expectedTurnId !== null &&
    command.target.expectedTurnId !== provider.turnId
  ) {
    await reportQueuedCommandError(fixture.harness, queued, {
      errorCode: "stale_turn",
      errorMessage: "Expected a different active turn",
    });
    return;
  }
  await postEvents(fixture, [
    inputAccepted(fixture, command.requestId, provider.turnId),
  ]);
  await reportQueuedCommandSuccess(fixture.harness, queued, {
    trace: { spans: [] },
  });
}

async function startTurn(fixture: Fixture, provider: Provider): Promise<void> {
  const requestId = provider.pendingStartRequestId;
  if (requestId === null) return;
  provider.turns += 1;
  const turnId = `turn-${provider.turns}`;
  provider.pendingStartRequestId = null;
  provider.turnId = turnId;
  await postEvents(fixture, [
    {
      type: "turn/started",
      threadId: fixture.threadId,
      providerThreadId: fixture.providerThreadId,
      scope: turnScope(turnId),
    },
    inputAccepted(fixture, requestId, turnId),
  ]);
}

async function completeTurn(
  fixture: Fixture,
  provider: Provider,
  status: "completed" | "failed" | "interrupted",
): Promise<void> {
  const turnId = provider.turnId;
  if (turnId === null) return;
  provider.turnId = null;
  await postEvents(fixture, [
    {
      type: "turn/completed",
      threadId: fixture.threadId,
      providerThreadId: fixture.providerThreadId,
      scope: turnScope(turnId),
      status,
    },
  ]);
}

async function answerStop(
  fixture: Fixture,
  provider: Provider,
  queued: QueuedCommand,
): Promise<void> {
  provider.pendingStartRequestId = null;
  await completeTurn(fixture, provider, "interrupted");
  await reportQueuedCommandSuccess(fixture.harness, queued, {
    providerCheckpointId: null,
  });
}

async function runSweeps(fixture: Fixture, now: number): Promise<void> {
  returnUnsettledSubmittedInputs(fixture.harness.deps, now);
  stopRunsWhoseTurnNeverStarted(fixture.harness.deps, now);
  await runQueuedMessageDispatch(fixture.harness.deps, {
    kind: "idle-recovery",
    now,
  });
}

interface StoredRequest {
  requestId: string;
  text: string;
}

function readRequests(fixture: Fixture): StoredRequest[] {
  return listEvents(fixture.harness.db, { threadId: fixture.threadId })
    .filter((event) => event.type === "client/turn/requested")
    .map((event) => {
      const data = JSON.parse(event.data) as { requestId: string };
      return { requestId: data.requestId, text: event.data };
    });
}

function readAcceptedRequestIds(fixture: Fixture): string[] {
  return listEvents(fixture.harness.db, { threadId: fixture.threadId })
    .filter((event) => event.type === "turn/input/accepted")
    .map(
      (event) =>
        (JSON.parse(event.data) as { clientRequestId: string }).clientRequestId,
    );
}

function checkInvariants(
  fixture: Fixture,
  inputs: readonly string[],
  context: string,
): void {
  const { db } = fixture.harness;
  const thread = getThread(db, fixture.threadId)!;
  const requests = readRequests(fixture);
  const accepted = new Set(readAcceptedRequestIds(fixture));
  const rows = db
    .select()
    .from(queuedThreadMessages)
    .where(eq(queuedThreadMessages.threadId, fixture.threadId))
    .all();
  const failedTurn =
    thread.status === "error" ? (requests.at(-1) ?? null) : null;

  for (const input of inputs) {
    const acceptedCount = requests.filter(
      (request) =>
        accepted.has(request.requestId) && request.text.includes(input),
    ).length;
    const queued = rows.some((row) => row.content.includes(input));
    const ownedByFailedTurn =
      failedTurn !== null &&
      !accepted.has(failedTurn.requestId) &&
      failedTurn.text.includes(input);
    const detail = (): string =>
      JSON.stringify({
        rows: rows
          .filter((row) => row.content.includes(input))
          .map((row) => [row.state, row.submittedRequestId, row.payloadKind]),
        requests: requests
          .filter((request) => request.text.includes(input))
          .map((request) => {
            const data = JSON.parse(request.text) as {
              retryAttempt?: number;
              retryOfRequestId?: string;
              target: { kind: string };
            };
            return [
              request.requestId,
              accepted.has(request.requestId),
              data.target.kind,
              data.retryOfRequestId ?? null,
              data.retryAttempt ?? null,
            ];
          }),
        events: listEvents(db, { threadId: fixture.threadId }).map(
          (event) => `${event.type}:${event.turnId ?? ""}`,
        ),
        status: thread.status,
      });
    expect(
      acceptedCount,
      `${context}: ${input} accepted twice ${detail()}`,
    ).toBeLessThan(2);
    expect(
      acceptedCount > 0 && queued,
      `${context}: ${input} accepted and still queued ${detail()}`,
    ).toBe(false);
    expect(
      acceptedCount > 0 || queued || ownedByFailedTurn,
      `${context}: ${input} was lost ${detail()}`,
    ).toBe(true);
  }

  if (thread.status === "idle" || thread.status === "error") {
    expect(
      getActiveStoredTurnId(db, fixture.threadId),
      `${context}: ${thread.status} thread has an open turn`,
    ).toBeNull();
  }
}

function checkTurnBound(fixture: Fixture, now: number, context: string): void {
  const thread = getThread(fixture.harness.db, fixture.threadId)!;
  if (thread.status !== "active") return;
  const unstarted = getUnstartedLatestStartTurnRequest(
    fixture.harness.db,
    fixture.threadId,
  );
  const hasTurn =
    getActiveStoredTurnId(fixture.harness.db, fixture.threadId) !== null;
  expect(
    hasTurn ||
      (unstarted !== null &&
        now - unstarted.createdAt < TURN_START_DEADLINE_MS),
    `${context}: active thread has no turn and is past the start deadline`,
  ).toBe(true);
}

function advanceClock(provider: Provider, ms: number): void {
  vi.setSystemTime(Date.now() + ms);
  if (
    provider.pendingStartRequestId !== null &&
    Date.now() - provider.pendingStartAt >= SUBMITTED_INPUT_SETTLE_MS
  ) {
    provider.pendingStartRequestId = null;
  }
}

async function quiesce(fixture: Fixture, provider: Provider): Promise<void> {
  for (let round = 0; round < 40; round += 1) {
    const stops = pendingCommands(fixture, "thread.stop");
    const submits = pendingCommands(fixture, "turn.submit");
    if (stops[0]) {
      await answerStop(fixture, provider, stops[0]);
    } else if (submits[0]) {
      await answerSubmit(fixture, provider, submits[0]);
    } else if (provider.pendingStartRequestId !== null) {
      await startTurn(fixture, provider);
    } else if (provider.turnId !== null) {
      await completeTurn(fixture, provider, "completed");
    } else {
      advanceClock(provider, TURN_START_DEADLINE_MS);
      await runSweeps(fixture, Date.now());
    }
    await settle();
  }
}

async function runWalk(seed: number): Promise<void> {
  await withTestHarness(async (harness) => {
    const random = createRandom(seed);
    const pick = <T>(items: readonly T[]): T =>
      items[Math.floor(random() * items.length)]!;
    const fixture = seedFixture(harness, seed);
    const provider: Provider = {
      pendingStartAt: 0,
      pendingStartRequestId: null,
      turnId: null,
      turns: 0,
    };
    const inputs: string[] = [];
    const trace: string[] = [];

    for (let step = 0; step < STEPS; step += 1) {
      const operation = pick(OPERATIONS);
      trace.push(operation);
      const context = `seed ${seed} step ${step} [${trace.join(" ")}]`;
      switch (operation) {
        case "send": {
          const text = `<input-${seed}-${step}>`;
          try {
            await acceptThreadSendRequest(harness.deps, {
              thread: getThread(harness.db, fixture.threadId)!,
              payload: {
                input: textInput(text),
                mode: pick(["auto", "steer-if-active", "queue-if-active"]),
              },
            });
            inputs.push(text);
          } catch (error) {
            if (!(error instanceof ApiError) || error.status !== 409) {
              throw error;
            }
          }
          break;
        }
        case "answer-submit": {
          const submit = pendingCommands(fixture, "turn.submit")[0];
          if (submit) await answerSubmit(fixture, provider, submit);
          break;
        }
        case "reject-submit": {
          const submit = pendingCommands(fixture, "turn.submit")[0];
          if (submit) {
            await reportQueuedCommandError(harness, submit, {
              errorCode: pick(["provider_error", "host_unavailable"]),
              errorMessage: "refused by the fake daemon",
            });
          }
          break;
        }
        case "start-turn":
          await startTurn(fixture, provider);
          break;
        case "complete-turn":
          await completeTurn(fixture, provider, "completed");
          break;
        case "fail-turn":
          await completeTurn(fixture, provider, "failed");
          break;
        case "answer-stop": {
          const stop = pendingCommands(fixture, "thread.stop")[0];
          if (stop) await answerStop(fixture, provider, stop);
          break;
        }
        case "tick": {
          advanceClock(
            provider,
            Math.floor(random() * TURN_START_DEADLINE_MS * 1.5),
          );
          const now = Date.now();
          await runSweeps(fixture, now);
          await settle();
          checkTurnBound(fixture, now, context);
          break;
        }
        case "retry": {
          const thread = getThread(harness.db, fixture.threadId)!;
          if (thread.status === "error") {
            await retryFailedTurn(harness.deps, {
              thread,
              request: retryTurnRequestSchema.parse({}),
            }).catch((error: unknown) => {
              if (!(error instanceof ApiError)) throw error;
            });
          }
          break;
        }
      }
      await settle();
      checkInvariants(fixture, inputs, context);
    }

    await quiesce(fixture, provider);
    const context = `seed ${seed} quiescent [${trace.join(" ")}]`;
    checkInvariants(fixture, inputs, context);
    const thread = getThread(harness.db, fixture.threadId)!;
    expect(["idle", "error"], `${context}: thread still running`).toContain(
      thread.status,
    );
    const failedTurnRequestId =
      thread.status === "error"
        ? (readRequests(fixture).at(-1)?.requestId ?? null)
        : null;
    expect(
      harness.db
        .select()
        .from(queuedThreadMessages)
        .where(eq(queuedThreadMessages.state, "submitted"))
        .all()
        .filter((row) => row.submittedRequestId !== failedTurnRequestId),
      `${context}: inputs left submitted outside a retryable failed turn`,
    ).toEqual([]);
    expect(pendingCommands(fixture, "turn.submit")).toEqual([]);
  });
}

describe("turn lifecycle model", () => {
  it.each(Array.from({ length: SEEDS }, (_, index) => index + 1))(
    "keeps every input and settles every run (seed %i)",
    async (seed) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        await runWalk(seed);
      } finally {
        vi.useRealTimers();
      }
    },
    60_000,
  );
});
