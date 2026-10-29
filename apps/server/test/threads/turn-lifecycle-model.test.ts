import {
  getActiveStoredTurnId,
  getLatestSessionForHost,
  getThread,
  listEvents,
  pendingInteractions,
  queuedThreadMessages,
} from "@bb/db";
import { turnScope, type ThreadEvent } from "@bb/domain";
import {
  groupHostDaemonEvents,
  type HostDaemonInteractiveRequestKey,
} from "@bb/host-daemon-contract";
import { retryTurnRequestSchema } from "@bb/server-contract";
import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/errors.js";
import {
  handleDaemonSocketClosed,
  handleHostSessionOpened,
} from "../../src/internal/session-owner-side-effects.js";
import { returnUnsettledSubmittedInputs } from "../../src/services/threads/input-ledger.js";
import { runQueuedMessageDispatch } from "../../src/services/threads/queued-message-dispatch.js";
import {
  stopRunsWhoseTurnNeverStarted,
  TURN_START_DEADLINE_MS,
} from "../../src/services/threads/thread-lifecycle.js";
import { acceptThreadSendRequest } from "../../src/services/threads/thread-send-request.js";
import { retryFailedTurn } from "../../src/services/threads/turn-retry.js";
import { onDaemonSocketOpen } from "../../src/ws/daemon-protocol.js";
import {
  forgetQueuedCommand,
  internalAuthHeaders,
  listPendingQueuedCommands,
  registerTestHostRpcCapture,
  reportQueuedCommandError,
  reportQueuedCommandSuccess,
  type QueuedCommand,
} from "../helpers/commands.js";
import {
  createAllowOnceResolution,
  createCommandApprovalPayload,
} from "../helpers/pending-interactions.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedSession,
  seedThread,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import {
  createTestAppHarness,
  withTestHarness,
  type TestAppHarness,
} from "../helpers/test-app.js";

const SEEDS = [
  ...Array.from({ length: 100 }, (_, index) => index + 1),
  128,
  130,
  156,
  273,
  761,
];
const STEPS = 40;

type Operation =
  | "send"
  | "answer-submit"
  | "reject-submit"
  | "start-turn"
  | "complete-turn"
  | "complete-turn-with-fallback-start"
  | "fail-turn"
  | "user-stop"
  | "answer-stop"
  | "time-out-stop"
  | "ask"
  | "answer-question"
  | "deliver-answer"
  | "reconnect"
  | "reconnect-new-instance"
  | "reconnect-before-close"
  | "restart-server"
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
  "complete-turn-with-fallback-start",
  "fail-turn",
  "user-stop",
  "answer-stop",
  "time-out-stop",
  "ask",
  "answer-question",
  "deliver-answer",
  "reconnect",
  "reconnect-new-instance",
  "reconnect-before-close",
  "restart-server",
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
  abandonedTurnId: string | null;
  deliveredInteractionIds: Set<string>;
  instance: number;
  pendingStartRequestId: string | null;
  questions: Map<string, string>;
  questionCount: number;
  turnId: string | null;
  turns: number;
}

interface Fixture {
  harness: TestAppHarness;
  hostId: string;
  providerId: string;
  providerThreadId: string;
  sessionId: string;
  threadId: string;
}

async function settle(): Promise<void> {
  for (let round = 0; round < 12; round += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
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
    hostId: host.id,
    providerId: thread.providerId,
    providerThreadId,
    sessionId: session.id,
    threadId: thread.id,
  };
}

async function postEvents(
  fixture: Fixture,
  events: ThreadEvent[],
): Promise<void> {
  if (events.length === 0) return;
  const response = await fixture.harness.app.request(
    "/internal/session/events",
    {
      method: "POST",
      headers: internalAuthHeaders(fixture.harness, {
        hostId: fixture.hostId,
      }),
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

function turnStarted(fixture: Fixture, turnId: string): ThreadEvent {
  return {
    type: "turn/started",
    threadId: fixture.threadId,
    providerThreadId: fixture.providerThreadId,
    scope: turnScope(turnId),
  };
}

function turnCompleted(
  fixture: Fixture,
  turnId: string,
  status: "completed" | "failed" | "interrupted",
): ThreadEvent {
  return {
    type: "turn/completed",
    threadId: fixture.threadId,
    providerThreadId: fixture.providerThreadId,
    scope: turnScope(turnId),
    status,
  };
}

type LaneCommandType = "interactive.resolve" | "thread.stop" | "turn.submit";

function pendingCommands(
  fixture: Fixture,
  type: LaneCommandType,
): QueuedCommand[] {
  return listPendingQueuedCommands(fixture.harness).filter(
    ({ command }) =>
      command.type === type &&
      "threadId" in command &&
      command.threadId === fixture.threadId,
  );
}

function nextLaneCommand(
  fixture: Fixture,
  type: LaneCommandType,
): QueuedCommand | undefined {
  const next = listPendingQueuedCommands(fixture.harness).find(
    ({ command }) =>
      (command.type === "interactive.resolve" ||
        command.type === "thread.stop" ||
        command.type === "turn.submit") &&
      command.threadId === fixture.threadId,
  );
  return next?.command.type === type ? next : undefined;
}

function runSubmitOnDaemon(
  fixture: Fixture,
  provider: Provider,
  queued: QueuedCommand,
): { events: ThreadEvent[]; refusal: string | null } {
  const { command } = queued;
  if (command.type !== "turn.submit") throw new Error("Expected turn.submit");
  const busy =
    provider.turnId !== null || provider.pendingStartRequestId !== null;
  if (command.target.mode === "start" || provider.turnId === null) {
    if (busy) return { events: [], refusal: "competing_turn" };
    provider.pendingStartRequestId = command.requestId;
    return { events: [], refusal: null };
  }
  if (
    command.target.expectedTurnId !== null &&
    command.target.expectedTurnId !== provider.turnId
  ) {
    return { events: [], refusal: "stale_turn" };
  }
  return {
    events: [inputAccepted(fixture, command.requestId, provider.turnId)],
    refusal: null,
  };
}

async function answerSubmit(
  fixture: Fixture,
  provider: Provider,
  queued: QueuedCommand,
): Promise<void> {
  const outcome = runSubmitOnDaemon(fixture, provider, queued);
  if (outcome.refusal !== null) {
    await reportQueuedCommandError(fixture.harness, queued, {
      errorCode: outcome.refusal,
      errorMessage: "refused by the fake daemon",
    });
    return;
  }
  await postEvents(fixture, outcome.events);
  await reportQueuedCommandSuccess(fixture.harness, queued, {
    trace: { spans: [] },
  });
}

async function startTurn(fixture: Fixture, provider: Provider): Promise<void> {
  const requestId = provider.pendingStartRequestId;
  if (requestId === null || provider.turnId !== null) return;
  provider.turns += 1;
  const turnId = `turn-${provider.turns}`;
  provider.pendingStartRequestId = null;
  provider.turnId = turnId;
  await postEvents(fixture, [
    turnStarted(fixture, turnId),
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
  if (status !== "interrupted" && provider.questions.size > 0) return;
  provider.turnId = null;
  provider.questions.clear();
  await postEvents(fixture, [turnCompleted(fixture, turnId, status)]);
}

async function completeTurnWithFallbackStart(
  fixture: Fixture,
  provider: Provider,
): Promise<void> {
  const turnId = provider.turnId;
  const steer = nextLaneCommand(fixture, "turn.submit");
  if (
    turnId === null ||
    steer === undefined ||
    steer.command.type !== "turn.submit" ||
    steer.command.target.mode === "start" ||
    provider.questions.size > 0
  ) {
    return;
  }
  provider.turns += 1;
  const nextTurnId = `turn-${provider.turns}`;
  provider.turnId = nextTurnId;
  await postEvents(fixture, [
    turnCompleted(fixture, turnId, "completed"),
    turnStarted(fixture, nextTurnId),
    inputAccepted(fixture, steer.command.requestId, nextTurnId),
  ]);
  await reportQueuedCommandSuccess(fixture.harness, steer, {
    trace: { spans: [] },
  });
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

function ask(fixture: Fixture, provider: Provider): void {
  if (provider.turnId === null) return;
  provider.questionCount += 1;
  const providerRequestId = `question-${provider.questionCount}`;
  const outcome =
    fixture.harness.deps.pendingInteractions.registerPendingInteraction({
      interaction: {
        threadId: fixture.threadId,
        turnId: provider.turnId,
        providerId: fixture.providerId,
        providerThreadId: fixture.providerThreadId,
        providerRequestId,
        payload: createCommandApprovalPayload(),
      },
    });
  if (outcome.outcome !== "rejected") {
    provider.questions.set(providerRequestId, outcome.interaction.id);
  }
}

function serverInteractions(fixture: Fixture) {
  return fixture.harness.db
    .select()
    .from(pendingInteractions)
    .where(
      and(
        eq(pendingInteractions.threadId, fixture.threadId),
        eq(pendingInteractions.originKind, "provider"),
      ),
    )
    .all();
}

function answerQuestion(fixture: Fixture, pick: <T>(items: readonly T[]) => T) {
  const open = serverInteractions(fixture).filter(
    (interaction) => interaction.status === "pending",
  );
  if (open.length === 0) return;
  try {
    fixture.harness.deps.pendingInteractions.resolvePendingInteraction({
      threadId: fixture.threadId,
      interactionId: pick(open).id,
      resolution: createAllowOnceResolution(),
    });
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
  }
}

function deliverAnswerOnDaemon(
  provider: Provider,
  queued: QueuedCommand,
): boolean {
  const { command } = queued;
  if (command.type !== "interactive.resolve") return false;
  if (!provider.questions.has(command.providerRequestId)) return false;
  provider.questions.delete(command.providerRequestId);
  provider.deliveredInteractionIds.add(command.interactionId);
  return true;
}

async function deliverAnswer(
  fixture: Fixture,
  provider: Provider,
  queued: QueuedCommand,
): Promise<void> {
  if (deliverAnswerOnDaemon(provider, queued)) {
    await reportQueuedCommandSuccess(fixture.harness, queued, {});
    return;
  }
  await reportQueuedCommandError(fixture.harness, queued, {
    errorCode: "stale_interactive_request",
    errorMessage: "no longer awaiting a provider response",
  });
}

async function runPendingCommandsOnDaemon(
  fixture: Fixture,
  provider: Provider,
  args: { received: () => boolean },
): Promise<void> {
  for (const queued of listPendingQueuedCommands(fixture.harness)) {
    if (!("threadId" in queued.command)) continue;
    if (queued.command.threadId !== fixture.threadId) continue;
    forgetQueuedCommand(queued);
    if (!args.received()) continue;
    if (queued.command.type === "turn.submit") {
      await postEvents(
        fixture,
        runSubmitOnDaemon(fixture, provider, queued).events,
      );
    } else if (queued.command.type === "thread.stop") {
      provider.pendingStartRequestId = null;
      await completeTurn(fixture, provider, "interrupted");
    } else {
      deliverAnswerOnDaemon(provider, queued);
    }
  }
}

function openThreadWork(fixture: Fixture, provider: Provider) {
  const interactiveRequests: HostDaemonInteractiveRequestKey[] = [
    ...provider.questions.keys(),
  ].map((providerRequestId) => ({
    threadId: fixture.threadId,
    providerId: fixture.providerId,
    providerThreadId: fixture.providerThreadId,
    providerRequestId,
  }));
  return interactiveRequests.length === 0
    ? []
    : [
        {
          threadId: fixture.threadId,
          backgroundItemIds: [],
          interactiveRequests,
        },
      ];
}

async function dropConnection(fixture: Fixture): Promise<void> {
  handleDaemonSocketClosed(fixture.harness.deps, {
    sessionId: fixture.sessionId,
  });
  await settle();
}

async function reopenSession(
  fixture: Fixture,
  provider: Provider,
): Promise<void> {
  const { deps } = fixture.harness;
  const previous = getLatestSessionForHost(deps.db, { hostId: fixture.hostId });
  const opened = seedSession(deps, fixture.hostId, {
    instanceId: `instance-${provider.instance}`,
  });
  fixture.sessionId = opened.id;
  const socket = registerTestHostRpcCapture(deps, {
    hostId: fixture.hostId,
    sessionId: opened.id,
  });
  const send = socket.send.bind(socket);
  socket.send = (data: string) => {
    const message = JSON.parse(data) as {
      requests?: HostDaemonInteractiveRequestKey[];
      type?: string;
    };
    if (message.type === "interactive-requests.end") {
      for (const request of message.requests ?? []) {
        provider.questions.delete(request.providerRequestId);
      }
    }
    send(data);
  };
  onDaemonSocketOpen(deps, {
    hostId: fixture.hostId,
    sessionId: opened.id,
    socket,
  });
  const { endedInteractiveRequests } = await handleHostSessionOpened(deps, {
    activeThreads:
      provider.turnId !== null || provider.pendingStartRequestId !== null
        ? [{ threadId: fixture.threadId }]
        : [],
    openThreadWork: openThreadWork(fixture, provider),
    undeliveredEventThreadIds: [],
    hostId: fixture.hostId,
    openedSession: opened,
    previousSession: previous,
  });
  for (const ended of endedInteractiveRequests) {
    provider.questions.delete(ended.providerRequestId);
  }
}

function checkProviderWaitsOnlyOnOpenQuestions(
  fixture: Fixture,
  provider: Provider,
  context: string,
): void {
  const statusById = new Map(
    serverInteractions(fixture).map((interaction) => [
      interaction.id,
      interaction.status,
    ]),
  );
  for (const interactionId of provider.questions.values()) {
    expect(
      statusById.get(interactionId),
      `${context}: provider still waits on a closed question`,
    ).toMatch(/^(pending|resolving)$/u);
  }
}

function checkQuestionsAfterReconnect(
  fixture: Fixture,
  provider: Provider,
  context: string,
): void {
  const byId = new Map(
    serverInteractions(fixture).map((interaction) => [
      interaction.id,
      interaction,
    ]),
  );
  const waiting = new Set(provider.questions.values());
  for (const interaction of byId.values()) {
    if (interaction.status !== "pending") continue;
    expect(
      waiting.has(interaction.id),
      `${context}: question ${interaction.id} is pending but the provider no longer asks it`,
    ).toBe(true);
  }
}

function checkDeliveredAnswers(
  fixture: Fixture,
  provider: Provider,
  context: string,
): void {
  const byId = new Map(
    serverInteractions(fixture).map((interaction) => [
      interaction.id,
      interaction.status,
    ]),
  );
  for (const interactionId of provider.deliveredInteractionIds) {
    expect(
      byId.get(interactionId),
      `${context}: delivered answer ${interactionId} was discarded`,
    ).toMatch(/^(resolving|resolved)$/u);
  }
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
  provider: Provider,
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

  if (
    thread.status === "active" &&
    provider.turnId !== null &&
    provider.turnId !== provider.abandonedTurnId &&
    pendingCommands(fixture, "thread.stop").length === 0
  ) {
    expect(
      getActiveStoredTurnId(db, fixture.threadId),
      `${context}: the server's open turn is not the provider's running turn`,
    ).toBe(provider.turnId);
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
  const hasTurn =
    getActiveStoredTurnId(fixture.harness.db, fixture.threadId) !== null;
  expect(
    hasTurn || now - thread.updatedAt < TURN_START_DEADLINE_MS,
    `${context}: active thread has no turn and is past the start deadline`,
  ).toBe(true);
}

async function quiesce(fixture: Fixture, provider: Provider): Promise<void> {
  for (let round = 0; round < 60; round += 1) {
    const stop = nextLaneCommand(fixture, "thread.stop");
    const submit = nextLaneCommand(fixture, "turn.submit");
    const resolve = nextLaneCommand(fixture, "interactive.resolve");
    const question = serverInteractions(fixture).find(
      (interaction) => interaction.status === "pending",
    );
    if (stop) {
      await answerStop(fixture, provider, stop);
    } else if (resolve) {
      await deliverAnswer(fixture, provider, resolve);
    } else if (submit) {
      await answerSubmit(fixture, provider, submit);
    } else if (question) {
      answerQuestion(fixture, (items) => items[0]!);
    } else if (
      provider.pendingStartRequestId !== null &&
      provider.turnId === null
    ) {
      await startTurn(fixture, provider);
    } else if (provider.turnId !== null && provider.questions.size === 0) {
      await completeTurn(fixture, provider, "completed");
    } else {
      vi.setSystemTime(Date.now() + TURN_START_DEADLINE_MS);
      await runSweeps(fixture, Date.now());
    }
    await settle();
  }
}

async function runWalk(seed: number): Promise<void> {
  await withTestHarness(async (initialHarness) => {
    const random = createRandom(seed);
    const pick = <T>(items: readonly T[]): T =>
      items[Math.floor(random() * items.length)]!;
    const fixture = seedFixture(initialHarness, seed);
    const restartedHarnesses: TestAppHarness[] = [];
    const provider: Provider = {
      abandonedTurnId: null,
      deliveredInteractionIds: new Set(),
      instance: 1,
      pendingStartRequestId: null,
      questions: new Map(),
      questionCount: 0,
      turnId: null,
      turns: 0,
    };
    const inputs: string[] = [];
    const trace: string[] = [];
    await reopenSession(fixture, provider);
    try {
      for (let step = 0; step < STEPS; step += 1) {
        vi.setSystemTime(Date.now() + 1);
        const operation = pick(OPERATIONS);
        trace.push(operation);
        const context = `seed ${seed} step ${step} [${trace.join(" ")}]`;
        switch (operation) {
          case "send": {
            const text = `<input-${seed}-${step}>`;
            try {
              await acceptThreadSendRequest(fixture.harness.deps, {
                thread: getThread(fixture.harness.db, fixture.threadId)!,
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
            const submit = nextLaneCommand(fixture, "turn.submit");
            if (submit) await answerSubmit(fixture, provider, submit);
            break;
          }
          case "reject-submit": {
            const submit = nextLaneCommand(fixture, "turn.submit");
            if (submit) {
              await reportQueuedCommandError(fixture.harness, submit, {
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
          case "complete-turn-with-fallback-start":
            await completeTurnWithFallbackStart(fixture, provider);
            break;
          case "fail-turn":
            await completeTurn(fixture, provider, "failed");
            break;
          case "answer-stop": {
            const stop = nextLaneCommand(fixture, "thread.stop");
            if (stop) await answerStop(fixture, provider, stop);
            break;
          }
          case "user-stop": {
            void Promise.resolve(
              fixture.harness.app.request(
                `/api/v1/threads/${fixture.threadId}/stop`,
                { method: "POST" },
              ),
            ).catch(() => undefined);
            break;
          }
          case "time-out-stop": {
            const stop = nextLaneCommand(fixture, "thread.stop");
            if (stop) {
              provider.abandonedTurnId = provider.turnId;
              await reportQueuedCommandError(fixture.harness, stop, {
                errorCode: "command_timeout",
                errorMessage: "the fake daemon's stop timed out",
              });
            }
            break;
          }
          case "ask":
            ask(fixture, provider);
            break;
          case "answer-question":
            answerQuestion(fixture, pick);
            break;
          case "deliver-answer": {
            const resolve = nextLaneCommand(fixture, "interactive.resolve");
            if (resolve) await deliverAnswer(fixture, provider, resolve);
            break;
          }
          case "reconnect":
            await runPendingCommandsOnDaemon(fixture, provider, {
              received: () => random() < 0.5,
            });
            await dropConnection(fixture);
            await reopenSession(fixture, provider);
            await settle();
            checkQuestionsAfterReconnect(fixture, provider, context);
            break;
          case "reconnect-new-instance":
            await runPendingCommandsOnDaemon(fixture, provider, {
              received: () => false,
            });
            await dropConnection(fixture);
            provider.instance += 1;
            provider.turnId = null;
            provider.pendingStartRequestId = null;
            provider.questions.clear();
            await reopenSession(fixture, provider);
            await settle();
            checkQuestionsAfterReconnect(fixture, provider, context);
            break;
          case "reconnect-before-close": {
            await runPendingCommandsOnDaemon(fixture, provider, {
              received: () => random() < 0.5,
            });
            const previousSessionId = fixture.sessionId;
            await reopenSession(fixture, provider);
            handleDaemonSocketClosed(fixture.harness.deps, {
              sessionId: previousSessionId,
            });
            await settle();
            checkQuestionsAfterReconnect(fixture, provider, context);
            break;
          }
          case "restart-server": {
            await runPendingCommandsOnDaemon(fixture, provider, {
              received: () => true,
            });
            const restarted = await createTestAppHarness({
              db: fixture.harness.db,
              seedFirstPartyProviders: false,
            });
            restartedHarnesses.push(restarted);
            fixture.harness = restarted;
            await reopenSession(fixture, provider);
            await settle();
            checkQuestionsAfterReconnect(fixture, provider, context);
            break;
          }
          case "tick": {
            vi.setSystemTime(
              Date.now() + Math.floor(random() * TURN_START_DEADLINE_MS * 1.5),
            );
            const now = Date.now();
            await runSweeps(fixture, now);
            await settle();
            checkTurnBound(fixture, now, context);
            break;
          }
          case "retry": {
            const thread = getThread(fixture.harness.db, fixture.threadId)!;
            if (thread.status === "error") {
              await retryFailedTurn(fixture.harness.deps, {
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
        checkInvariants(fixture, provider, inputs, context);
        checkDeliveredAnswers(fixture, provider, context);
        checkProviderWaitsOnlyOnOpenQuestions(fixture, provider, context);
      }

      await quiesce(fixture, provider);
      const context = `seed ${seed} quiescent [${trace.join(" ")}]`;
      checkInvariants(fixture, provider, inputs, context);
      checkDeliveredAnswers(fixture, provider, context);
      const thread = getThread(fixture.harness.db, fixture.threadId)!;
      expect(["idle", "error"], `${context}: thread still running`).toContain(
        thread.status,
      );
      const failedTurnRequestId =
        thread.status === "error"
          ? (readRequests(fixture).at(-1)?.requestId ?? null)
          : null;
      expect(
        fixture.harness.db
          .select()
          .from(queuedThreadMessages)
          .where(eq(queuedThreadMessages.state, "submitted"))
          .all()
          .filter((row) => row.submittedRequestId !== failedTurnRequestId),
        `${context}: inputs left submitted outside a retryable failed turn`,
      ).toEqual([]);
      expect(pendingCommands(fixture, "turn.submit")).toEqual([]);
    } finally {
      for (const restarted of restartedHarnesses) await restarted.cleanup();
    }
  });
}

describe("turn lifecycle model", () => {
  it.each(SEEDS)(
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
