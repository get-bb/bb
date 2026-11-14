import { isDeepStrictEqual } from "node:util";
import { eq, gt, min } from "drizzle-orm";
import { expect, vi } from "vitest";
import {
  buildLoadedTimelineState,
  mergeLoadedTimelineWithLatest,
  prependOlderTimelineRows,
  recoverLoadedTimelineAfterStaleCursor,
  resolveLoadedTimelineSurfaceKey,
  type LoadedTimelineState,
} from "@bb/client-core";
import {
  advanceThreadPruning,
  createConnection,
  deleteExpiredRetainedEventOutputs,
  deleteThreadEventSuffixInTransaction,
  deriveStoredEventItemFields,
  getAppSettings,
  getLatestThreadSequence,
  getThread,
  insertEvents,
  retainedEventOutputs,
  threads,
  updateThread,
  type DbConnection,
} from "@bb/db";
import {
  encodeClientTurnRequestIdNumber,
  parseStoredThreadEvent,
  threadScope,
  turnScope,
  type ThreadEventScope,
  type ThreadEventType,
  type ThreadStatus,
  type ThreadTimelineSubscriptionTarget,
} from "@bb/domain";
import {
  applyThreadTimelineDelta,
  isThreadTimelineDelta,
  threadTimelineReadResponseSchema,
  threadTimelineResponseSchema,
  threadTimelineSignalSchema,
  type ThreadTimelineReadResponse,
  type ThreadTimelineResponse,
  type TimelineRow,
} from "@bb/server-contract";
import {
  resolveThreadCompletedTurnDisplay,
  resolveThreadProviderDisplayName,
} from "../../../src/services/threads/thread-timeline-windows.js";
import { resolveThreadHeadStateOptions } from "../../../src/services/threads/thread-head-state.js";
import { buildThreadTimelineWithProfile } from "../../../src/services/threads/timeline.js";
import {
  DEFAULT_MAX_INLINE_OUTPUT_CHARS,
  shortenTimelineResponseOutputs,
} from "../../../src/services/threads/timeline-output-shortening.js";
import { z } from "zod";
import { validatePluginProviderDeclaration } from "@get-bb/plugin-sdk/internal/host-policy";
import { buildPluginProviderRegistration } from "../../../src/services/providers/plugin-provider-registration.js";
import { readJson } from "../../helpers/json.js";
import { createMockHubSocket } from "../../helpers/mock-hub-socket.js";
import { seedThreadFixture } from "../../helpers/seed.js";
import type { TestAppHarness } from "../../helpers/test-app.js";

type EventInput = Parameters<typeof insertEvents>[2][number];

export type Rng = () => number;

export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function pick<T>(rng: Rng, values: readonly T[]): T {
  const value = values[Math.floor(rng() * values.length)];
  if (value === undefined) throw new Error("pick from an empty list");
  return value;
}

function chance(rng: Rng, probability: number): boolean {
  return rng() < probability;
}

function sometimes(rng: Rng, probability: number): boolean {
  return probability > 0 && rng() < probability;
}

const PROVIDER_THREAD_ID = "provider-1";
const START_TIME = Date.UTC(2026, 10, 1);
const LARGE_OUTPUT_CHARS = 40_000;

const execution = {
  model: "gpt-5",
  serviceTier: "default",
  reasoningLevel: "medium",
  permissionMode: "full",
  source: "client/turn/requested",
} as const;

interface OpenTurn {
  abandonedDelegations: number;
  delegations: OpenDelegation[];
  pendingSteerAcceptances: string[];
  turnId: string;
}

interface OpenDelegation {
  background: boolean;
  childTurnId: string;
  id: string;
  ownerTurnId: string;
  startSequence: number;
}

interface OpenBackgroundTask {
  id: string;
  ownerTurnId: string;
  progress: number;
  startSequence: number;
}

interface UserRequest {
  editable: boolean;
  sequence: number;
}

type HiddenInput = "agent-only" | "empty" | "mixed";

export interface EventLogShape {
  abandonedDelegationChance: number;
  abandonedTurnChance: number;
  backgroundTasksAcrossConcurrentTurns: boolean;
  backgroundTaskWeight: number;
  commandWeight: number;
  compactionWeight: number;
  concurrentTurnWeight: number;
  deferredSteerAcceptanceChance: number;
  delegationWeight: number;
  extensionStateWeight: number;
  hiddenRequestWeight: number;
  largeOutputChance: number;
  lateBackgroundWork: boolean;
  messageWeight: number;
  pendingWorkWhileIdle: boolean;
  requestFreeRunsInsideTurns: boolean;
  requestFreeRunWeight: number;
  steerWeight: number;
  turnCompleteWeight: number;
}

export const MIXED_EVENT_LOG: EventLogShape = {
  abandonedDelegationChance: 0,
  abandonedTurnChance: 0,
  backgroundTasksAcrossConcurrentTurns: true,
  backgroundTaskWeight: 2,
  commandWeight: 4,
  compactionWeight: 0.5,
  concurrentTurnWeight: 0,
  deferredSteerAcceptanceChance: 0.3,
  delegationWeight: 2,
  extensionStateWeight: 0,
  hiddenRequestWeight: 0,
  largeOutputChance: 0.04,
  lateBackgroundWork: true,
  messageWeight: 4,
  pendingWorkWhileIdle: false,
  requestFreeRunsInsideTurns: true,
  requestFreeRunWeight: 0,
  steerWeight: 1.5,
  turnCompleteWeight: 2,
};

export const INTERLEAVED_EVENT_LOG: EventLogShape = {
  ...MIXED_EVENT_LOG,
  abandonedDelegationChance: 0.3,
  abandonedTurnChance: 0.3,
  concurrentTurnWeight: 1.5,
  hiddenRequestWeight: 1.5,
  requestFreeRunWeight: 1.5,
};

export const EXTENSION_STATE_EVENT_LOG: EventLogShape = {
  ...MIXED_EVENT_LOG,
  extensionStateWeight: 1.5,
};

export const GUARD_PROVIDER_PLUGIN_ID = "timeline-guard";
const GUARD_PROVIDER_ID = "timeline-guard";
const GUARD_PROVIDER_STATE_KINDS = ["goal", "plan"] as const;

export interface GuardProvider {
  readonly providerId: string;
  declareStateKinds(kinds: readonly string[]): void;
}

export function registerGuardProvider(harness: TestAppHarness): GuardProvider {
  let registration: { dispose(): void } | null = null;
  const declareStateKinds = (kinds: readonly string[]) => {
    registration?.dispose();
    registration = harness.deps.providerRegistry.register({
      ...buildPluginProviderRegistration({
        iconHash: null,
        available: true,
        pluginId: GUARD_PROVIDER_PLUGIN_ID,
        declaration: validatePluginProviderDeclaration({
          id: GUARD_PROVIDER_ID,
          displayName: "Timeline guard",
          maintenance: { health: false, usage: false, installation: false },
          capabilities: {
            supportsServiceTier: false,
            supportsNativeUserQuestion: false,
            fork: "none",
            supportsManualCompaction: false,
            supportsThreadArchive: false,
            supportsThreadRename: false,
            permissionModes: ["full"],
            reasoningLevels: ["medium"],
          },
          composerActions: [],
          extensionKinds: Object.fromEntries(
            kinds.map((kind) => [
              kind,
              { state: z.object({ status: z.string() }) },
            ]),
          ),
        }),
        readSettings: () => ({}),
      }),
      pluginId: GUARD_PROVIDER_PLUGIN_ID,
      iconNames: new Set<string>(),
    });
  };
  declareStateKinds([]);
  return { providerId: GUARD_PROVIDER_ID, declareStateKinds };
}

export function pickStateKinds(rng: Rng): string[] {
  return GUARD_PROVIDER_STATE_KINDS.filter(() => chance(rng, 0.5));
}

export interface StepOptions {
  keepTurnOpen?: boolean;
}

const BULK_INSERT_CHUNK = 2_000;

export interface ThreadLog {
  readonly threadId: string;
  eventCount(): number;
  step(options?: StepOptions): number;
  bulk(steps: number, options?: StepOptions): void;
  finishOpenWork(): void;
  editLatestMessage(): boolean;
  prune(): number;
  rename(): void;
  advanceClockPastRetention(): boolean;
  sweepExpiredOutputs(): number;
}

export interface CreateThreadLogArgs {
  harness: TestAppHarness;
  providerId: string;
  rng: Rng;
  shape: EventLogShape;
}

export function createThreadLog(args: CreateThreadLogArgs): ThreadLog {
  const { harness, rng, shape } = args;
  const { environment, thread } = seedThreadFixture(harness, {
    thread: { providerId: args.providerId },
  });
  const db = harness.db;
  let sequence = 0;
  let now = START_TIME;
  let turnCount = 0;
  let itemCount = 0;
  let renameCount = 0;
  let editCount = 0;
  let eventCount = 0;
  let openTurns: OpenTurn[] = [];
  let backgroundTasks: OpenBackgroundTask[] = [];
  let backgroundDelegations: OpenDelegation[] = [];
  let completedTurns: { completedAt: number; turnId: string }[] = [];
  const turnStartSequences = new Map<string, number>();
  const delegationFinishes = new Map<
    OpenDelegation,
    { abandoned: boolean; finishedAt: number | null }
  >();
  let requests: UserRequest[] = [];
  let bulkInputs: EventInput[] | null = null;
  vi.setSystemTime(now);

  function nextId(kind: string): string {
    itemCount += 1;
    return `${kind}-${itemCount}`;
  }

  function event(
    type: ThreadEventType,
    scope: ThreadEventScope,
    data: Record<string, unknown>,
    providerThreadId: string | null = PROVIDER_THREAD_ID,
  ): EventInput {
    sequence += 1;
    now += 1_000;
    const parsed = parseStoredThreadEvent({
      type,
      data,
      threadId: thread.id,
      providerThreadId,
      scope,
    });
    const encoded = JSON.stringify(data);
    return {
      threadId: thread.id,
      environmentId: environment.id,
      providerThreadId,
      scope,
      sequence,
      type,
      ...deriveStoredEventItemFields(parsed),
      createdAt: now,
      data: encoded,
    };
  }

  function append(inputs: EventInput[]): void {
    if (inputs.length === 0) return;
    if (bulkInputs !== null) {
      bulkInputs.push(...inputs);
      return;
    }
    vi.setSystemTime(now);
    insertEvents(db, harness.hub, inputs);
    eventCount += inputs.length;
    harness.hub.notifyThread(thread.id, ["events-appended"]);
  }

  function setStatus(status: ThreadStatus): void {
    db.update(threads).set({ status }).where(eq(threads.id, thread.id)).run();
  }

  function request(
    text: string,
    target: Record<string, unknown>,
    hidden: HiddenInput | null = null,
  ): { input: EventInput; requestId: string } {
    const requestId = encodeClientTurnRequestIdNumber({
      value: sequence + 1,
    });
    const visible = { type: "text", text, mentions: [] };
    const agentOnly = { ...visible, visibility: "agent-only" };
    const input = event(
      "client/turn/requested",
      threadScope(),
      {
        direction: "outbound",
        source: "tell",
        initiator: hidden === null ? "user" : "system",
        request: { method: "turn/start", params: {} },
        requestId,
        senderThreadId: null,
        input:
          hidden === null
            ? [visible]
            : hidden === "empty"
              ? []
              : hidden === "mixed"
                ? [agentOnly, visible]
                : [agentOnly],
        target,
        execution,
      },
      null,
    );
    requests.push({
      editable: hidden === null && target.kind !== "steer",
      sequence: input.sequence,
    });
    return { input, requestId };
  }

  function startTurn(text: string): EventInput[] {
    turnCount += 1;
    const turnId = `turn-${turnCount}`;
    const { input, requestId } = request(
      text,
      turnCount === 1 ? { kind: "thread-start" } : { kind: "new-turn" },
    );
    openTurns.push({
      abandonedDelegations: 0,
      delegations: [],
      pendingSteerAcceptances: [],
      turnId,
    });
    setStatus("active");
    const provisioning = turnCount === 1 || rng() < 0.3 ? requestFreeRun() : [];
    const started = event("turn/started", turnScope(turnId), {});
    turnStartSequences.set(turnId, started.sequence);
    return [
      input,
      ...provisioning,
      started,
      event("turn/input/accepted", turnScope(turnId), {
        clientRequestId: requestId,
      }),
    ];
  }

  function message(turnId: string, parentToolCallId: string | null) {
    const id = nextId("message");
    const parent = parentToolCallId === null ? {} : { parentToolCallId };
    const text = `${id}: ${"progress note ".repeat(1 + Math.floor(rng() * 6))}`;
    const deltas = Math.floor(rng() * 3);
    const inputs: EventInput[] = [];
    for (let index = 0; index < deltas; index += 1) {
      inputs.push(
        event("item/agentMessage/delta", turnScope(turnId), {
          itemId: id,
          delta: `${text.slice(0, 8)} `,
          ...parent,
        }),
      );
    }
    inputs.push(
      event("item/completed", turnScope(turnId), {
        item: { type: "agentMessage", id, text, ...parent },
      }),
    );
    return inputs;
  }

  function command(turnId: string): EventInput[] {
    const id = nextId("command");
    const large = chance(rng, shape.largeOutputChance);
    const line = `${id} output line\n`;
    const output = large
      ? line.repeat(Math.ceil(LARGE_OUTPUT_CHARS / line.length))
      : line.repeat(1 + Math.floor(rng() * 4));
    const item = {
      type: "commandExecution",
      id,
      command: `run ${id}`,
      cwd: "/repo",
      approvalStatus: null,
    };
    const inputs = [
      event("item/started", turnScope(turnId), {
        item: { ...item, status: "pending" },
      }),
    ];
    if (chance(rng, 0.5)) {
      inputs.push(
        event("item/commandExecution/outputDelta", turnScope(turnId), {
          itemId: id,
          delta: line,
        }),
      );
    }
    inputs.push(
      event("item/completed", turnScope(turnId), {
        item: {
          ...item,
          status: "completed",
          aggregatedOutput: output,
          exitCode: 0,
          durationMs: 5,
        },
      }),
    );
    return inputs;
  }

  function steer(turn: OpenTurn): EventInput[] {
    const { input, requestId } = request(`Steer ${sequence + 1}`, {
      kind: "steer",
      expectedTurnId: turn.turnId,
    });
    if (chance(rng, shape.deferredSteerAcceptanceChance)) {
      turn.pendingSteerAcceptances.push(requestId);
      return [input];
    }
    return [
      input,
      event("turn/input/accepted", turnScope(turn.turnId), {
        clientRequestId: requestId,
      }),
    ];
  }

  function delegationItem(delegation: OpenDelegation, status: string) {
    return {
      type: "delegation",
      id: delegation.id,
      childRef: `child-${delegation.id}`,
      label: `Delegate ${delegation.id}`,
      status,
      background: delegation.background,
    };
  }

  function startDelegation(turn: OpenTurn): EventInput[] {
    const id = nextId("delegation");
    const delegation: OpenDelegation = {
      background: chance(rng, 0.4),
      childTurnId: `${id}-turn`,
      id,
      ownerTurnId: turn.turnId,
      startSequence: sequence + 1,
    };
    trackDelegation(delegation);
    if (sometimes(rng, shape.abandonedDelegationChance)) {
      turn.abandonedDelegations += 1;
      delegationFinishes.set(delegation, { abandoned: true, finishedAt: null });
    } else {
      turn.delegations.push(delegation);
    }
    return [
      event("item/started", turnScope(turn.turnId), {
        item: delegationItem(delegation, "pending"),
      }),
      event("turn/started", turnScope(delegation.childTurnId), {
        parentToolCallId: id,
      }),
      ...message(delegation.childTurnId, id),
    ];
  }

  function startDelegationInCompletedTurn(turnId: string): EventInput[] {
    const id = nextId("delegation");
    const delegation: OpenDelegation = {
      background: true,
      childTurnId: `${id}-turn`,
      id,
      ownerTurnId: turnId,
      startSequence: sequence + 1,
    };
    trackDelegation(delegation);
    backgroundDelegations.push(delegation);
    return [
      event("item/started", turnScope(turnId), {
        item: delegationItem(delegation, "pending"),
      }),
      event("turn/started", turnScope(delegation.childTurnId), {
        parentToolCallId: id,
      }),
      ...message(delegation.childTurnId, id),
    ];
  }

  function trackDelegation(delegation: OpenDelegation): void {
    delegationFinishes.set(delegation, {
      abandoned: false,
      finishedAt: null,
    });
  }

  function finishDelegation(
    delegation: OpenDelegation,
    ownerOpen: boolean,
  ): EventInput[] {
    delegationFinishes.set(delegation, {
      abandoned: delegationFinishes.get(delegation)?.abandoned ?? false,
      finishedAt: sequence + 1,
    });
    const inputs = [
      ...message(delegation.childTurnId, delegation.id),
      event("turn/completed", turnScope(delegation.childTurnId), {
        status: "completed",
      }),
    ];
    inputs.push(
      ownerOpen
        ? event("item/completed", turnScope(delegation.ownerTurnId), {
            item: delegationItem(delegation, "completed"),
          })
        : event("item/delegation/completed", threadScope(), {
            item: delegationItem(delegation, "completed"),
          }),
    );
    return inputs;
  }

  function backgroundTaskItem(task: OpenBackgroundTask, done: boolean) {
    return {
      type: "backgroundTask",
      id: task.id,
      taskType: "local_bash",
      description: `Background ${task.id}`,
      status: done ? "completed" : "pending",
      taskStatus: done ? "completed" : "running",
      skipTranscript: false,
      foreground: false,
      usage: {
        totalTokens: task.progress,
        toolUses: task.progress,
        durationMs: 0,
      },
    };
  }

  function startBackgroundTask(turn: OpenTurn): EventInput[] {
    const task: OpenBackgroundTask = {
      id: nextId("background"),
      ownerTurnId: turn.turnId,
      progress: 0,
      startSequence: sequence + 1,
    };
    backgroundTasks.push(task);
    return [
      event("item/started", turnScope(turn.turnId), {
        item: backgroundTaskItem(task, false),
      }),
    ];
  }

  function finishBackgroundTask(task: OpenBackgroundTask): EventInput[] {
    backgroundTasks = backgroundTasks.filter((open) => open !== task);
    return [
      event("item/backgroundTask/completed", threadScope(), {
        item: backgroundTaskItem(task, true),
      }),
    ];
  }

  function advanceBackgroundTask(
    candidates: readonly OpenBackgroundTask[],
  ): EventInput[] {
    const task = pick(rng, candidates);
    task.progress += 1;
    if (task.progress < 3 || chance(rng, 0.5)) {
      return [
        event("item/backgroundTask/progress", threadScope(), {
          item: backgroundTaskItem(task, false),
        }),
      ];
    }
    return finishBackgroundTask(task);
  }

  function compaction(turn: OpenTurn): EventInput[] {
    const id = nextId("compaction");
    return [
      event("item/started", turnScope(turn.turnId), {
        item: { type: "contextCompaction", id },
      }),
      event("item/completed", turnScope(turn.turnId), {
        item: { type: "contextCompaction", id },
      }),
      event("thread/compacted", turnScope(turn.turnId), {}),
    ];
  }

  function completeTurn(turn: OpenTurn): EventInput[] {
    const inputs: EventInput[] = [];
    for (const clientRequestId of turn.pendingSteerAcceptances) {
      inputs.push(
        event("turn/input/accepted", turnScope(turn.turnId), {
          clientRequestId,
        }),
      );
    }
    turn.pendingSteerAcceptances = [];
    if (!shape.lateBackgroundWork) {
      for (const task of backgroundTasks) {
        if (task.ownerTurnId === turn.turnId) {
          inputs.push(...finishBackgroundTask(task));
        }
      }
    }
    for (const delegation of turn.delegations) {
      if (delegation.background && shape.lateBackgroundWork) {
        backgroundDelegations.push(delegation);
      } else {
        inputs.push(...finishDelegation(delegation, true));
      }
    }
    inputs.push(...message(turn.turnId, null));
    const interrupted =
      turn.abandonedDelegations > 0 && !shape.pendingWorkWhileIdle;
    if (interrupted) {
      for (const [delegation, finish] of delegationFinishes) {
        if (delegation.ownerTurnId === turn.turnId && finish.abandoned) {
          finish.finishedAt = sequence + 1;
        }
      }
    }
    inputs.push(
      event("turn/completed", turnScope(turn.turnId), {
        status: interrupted ? "interrupted" : "completed",
      }),
    );
    completedTurns.push({ completedAt: sequence, turnId: turn.turnId });
    openTurns = openTurns.filter((open) => open !== turn);
    if (openTurns.length === 0 && !shape.pendingWorkWhileIdle) {
      for (const [delegation, { finishedAt }] of delegationFinishes) {
        if (finishedAt === null) {
          inputs.push(...finishDelegation(delegation, false));
        }
      }
      backgroundDelegations = [];
    }
    if (openTurns.length === 0) setStatus("idle");
    return inputs;
  }

  function startConcurrentTurn(turn: OpenTurn): EventInput[] {
    const inputs: EventInput[] = shape.backgroundTasksAcrossConcurrentTurns
      ? []
      : backgroundTasks.flatMap(finishBackgroundTask);
    if (
      sometimes(rng, shape.abandonedTurnChance) &&
      (shape.pendingWorkWhileIdle || turn.abandonedDelegations === 0)
    ) {
      if (!shape.pendingWorkWhileIdle) {
        for (const delegation of turn.delegations) {
          inputs.push(...finishDelegation(delegation, true));
        }
        turn.delegations = [];
      }
      openTurns = openTurns.filter((open) => open !== turn);
      for (const requestId of turn.pendingSteerAcceptances) {
        inputs.push(
          event(
            "client/turn/rejected",
            threadScope(),
            {
              requestId,
              reason: "command_failed",
              message: "The turn ended before the steer was delivered",
            },
            null,
          ),
        );
      }
      turn.pendingSteerAcceptances = [];
    }
    return [...inputs, ...startTurn(`User message ${turnCount + 1}`)];
  }

  function hiddenRequests(turn: OpenTurn): EventInput[] {
    const inputs: EventInput[] = [];
    const count = 1 + Math.floor(rng() * 5);
    for (let index = 0; index < count; index += 1) {
      const { input, requestId } = request(
        `Hidden update ${sequence + 1}`,
        { kind: "new-turn" },
        pick(rng, ["agent-only", "empty", "mixed"] as const),
      );
      inputs.push(
        input,
        event("turn/input/accepted", turnScope(turn.turnId), {
          clientRequestId: requestId,
        }),
      );
    }
    return inputs;
  }

  function requestFreeRun(): EventInput[] {
    const count = 3 + Math.floor(rng() * 6);
    return Array.from({ length: count }, () =>
      event(
        "system/operation",
        threadScope(),
        {
          operation: "fixture_output",
          status: "completed",
          operationId: nextId("operation"),
          message: `Output ${sequence + 1}`,
        },
        null,
      ),
    );
  }

  function extensionState(): EventInput[] {
    return [
      event("thread/extensionState/updated", threadScope(), {
        kind: `${GUARD_PROVIDER_PLUGIN_ID}/${pick(rng, GUARD_PROVIDER_STATE_KINDS)}`,
        payload: { status: `status ${sequence + 1}` },
      }),
    ];
  }

  function turnStep(turn: OpenTurn, keepTurnOpen: boolean): EventInput[] {
    const clientRequestId = turn.pendingSteerAcceptances[0];
    if (clientRequestId !== undefined && chance(rng, 0.6)) {
      turn.pendingSteerAcceptances.shift();
      return [
        event("turn/input/accepted", turnScope(turn.turnId), {
          clientRequestId,
        }),
      ];
    }
    const openDelegations = turn.delegations;
    const options: [number, () => EventInput[]][] = [
      [shape.messageWeight, () => message(turn.turnId, null)],
      [shape.commandWeight, () => command(turn.turnId)],
      [shape.steerWeight, () => steer(turn)],
      [shape.delegationWeight, () => startDelegation(turn)],
      [
        openTurns.length > 1 && !shape.backgroundTasksAcrossConcurrentTurns
          ? 0
          : shape.backgroundTaskWeight,
        () => startBackgroundTask(turn),
      ],
      [shape.compactionWeight, () => compaction(turn)],
      [keepTurnOpen ? 0 : shape.turnCompleteWeight, () => completeTurn(turn)],
      [
        keepTurnOpen ? 0 : shape.concurrentTurnWeight,
        () => startConcurrentTurn(turn),
      ],
      [shape.hiddenRequestWeight, () => hiddenRequests(turn)],
      [
        shape.requestFreeRunsInsideTurns ? shape.requestFreeRunWeight : 0,
        requestFreeRun,
      ],
      [shape.extensionStateWeight, extensionState],
    ];
    if (openDelegations.length > 0) {
      options.push([
        shape.delegationWeight,
        () => {
          const delegation = pick(rng, openDelegations);
          if (chance(rng, 0.5)) {
            return message(delegation.childTurnId, delegation.id);
          }
          turn.delegations = openDelegations.filter(
            (open) => open !== delegation,
          );
          return finishDelegation(delegation, true);
        },
      ]);
    }
    if (shape.lateBackgroundWork && completedTurns.length > 0) {
      options.push([
        shape.delegationWeight / 4,
        () => startDelegationInCompletedTurn(pick(rng, completedTurns).turnId),
      ]);
    }
    const progressing = shape.lateBackgroundWork
      ? backgroundTasks
      : backgroundTasks.filter((task) => task.ownerTurnId === turn.turnId);
    if (progressing.length > 0) {
      options.push([
        shape.backgroundTaskWeight,
        () => advanceBackgroundTask(progressing),
      ]);
    }
    return weighted(rng, options)();
  }

  function idleStep(): EventInput[] {
    const options: [number, () => EventInput[]][] = [
      [3, () => startTurn(`User message ${turnCount + 1}`)],
      [shape.requestFreeRunWeight, requestFreeRun],
    ];
    if (shape.lateBackgroundWork && backgroundTasks.length > 0) {
      options.push([1, () => advanceBackgroundTask(backgroundTasks)]);
    }
    if (backgroundDelegations.length > 0) {
      options.push([
        1,
        () => {
          const delegation = pick(rng, backgroundDelegations);
          backgroundDelegations = backgroundDelegations.filter(
            (open) => open !== delegation,
          );
          return finishDelegation(delegation, false);
        },
      ]);
    }
    return weighted(rng, options)();
  }

  function forgetFrom(cutoff: number): void {
    backgroundTasks = backgroundTasks.filter(
      (task) => task.startSequence < cutoff,
    );
    backgroundDelegations = backgroundDelegations.filter(
      (delegation) => delegation.startSequence < cutoff,
    );
    completedTurns = completedTurns.filter((turn) => turn.completedAt < cutoff);
    for (const [delegation, finish] of delegationFinishes) {
      if (delegation.startSequence >= cutoff) {
        delegationFinishes.delete(delegation);
      } else if (finish.finishedAt !== null && finish.finishedAt >= cutoff) {
        finish.finishedAt = null;
      }
    }
    requests = requests.filter((entry) => entry.sequence < cutoff);
  }

  function nextTurn(): OpenTurn | null {
    if (openTurns.length < 2) return openTurns[0] ?? null;
    return pick(rng, openTurns);
  }

  return {
    threadId: thread.id,
    eventCount: () => eventCount,
    step(options = {}) {
      const turn = nextTurn();
      const inputs =
        turn === null
          ? idleStep()
          : turnStep(turn, options.keepTurnOpen ?? false);
      append(inputs);
      return inputs.length;
    },
    bulk(steps, options = {}) {
      bulkInputs = [];
      for (let step = 0; step < steps; step += 1) this.step(options);
      const inputs = bulkInputs;
      bulkInputs = null;
      vi.setSystemTime(now);
      for (let start = 0; start < inputs.length; start += BULK_INSERT_CHUNK) {
        insertEvents(
          db,
          harness.hub,
          inputs.slice(start, start + BULK_INSERT_CHUNK),
        );
      }
      eventCount += inputs.length;
      harness.hub.notifyThread(thread.id, ["events-appended"]);
    },
    finishOpenWork() {
      const inputs: EventInput[] = [];
      for (const turn of openTurns) inputs.push(...completeTurn(turn));
      for (const delegation of backgroundDelegations) {
        inputs.push(...finishDelegation(delegation, false));
      }
      backgroundDelegations = [];
      append(inputs);
    },
    editLatestMessage() {
      if (openTurns.length > 0) return false;
      const completesAfter = (cutoff: number) =>
        completedTurns.some(
          (turn) =>
            turn.completedAt >= cutoff &&
            (turnStartSequences.get(turn.turnId) ?? cutoff) < cutoff,
        );
      const target = requests
        .filter((entry) => entry.editable && !completesAfter(entry.sequence))
        .at(-1);
      if (target === undefined || target.sequence <= 1) return false;
      editCount += 1;
      const oldMaxSequence = sequence;
      append([
        event(
          "system/operation",
          threadScope(),
          {
            operation: "edit_message",
            status: "completed",
            message: "Message edited",
            operationId: `edit-${editCount}`,
            metadata: {
              cutoffSequence: target.sequence,
              oldMaxSequence,
              requestSequence: oldMaxSequence + 2,
            },
          },
          null,
        ),
      ]);
      db.transaction((tx) => {
        deleteThreadEventSuffixInTransaction(tx, {
          cutoffSequence: target.sequence,
          oldMaxSequence,
          threadId: thread.id,
        });
      });
      forgetFrom(target.sequence);
      harness.hub.notifyThread(thread.id, ["history-rewritten"]);
      append(startTurn(`Edited message ${editCount}`));
      return true;
    },
    prune() {
      let removed = 0;
      for (let pass = 0; pass < 24; pass += 1) {
        removed += advanceThreadPruning(db, { threadId: thread.id }).removed;
      }
      return removed;
    },
    rename() {
      renameCount += 1;
      updateThread(db, harness.hub, thread.id, {
        title: `Renamed ${renameCount}`,
      });
    },
    advanceClockPastRetention() {
      const deadline = db
        .select({ expiresAt: min(retainedEventOutputs.expiresAt) })
        .from(retainedEventOutputs)
        .where(gt(retainedEventOutputs.expiresAt, now))
        .get()?.expiresAt;
      if (deadline === undefined || deadline === null) return false;
      now = deadline + 1;
      vi.setSystemTime(now);
      return true;
    },
    sweepExpiredOutputs() {
      const { deleted } = deleteExpiredRetainedEventOutputs(db, {
        expiredAtOrBefore: now,
        limit: 1_000,
      });
      if (deleted > 0) {
        harness.hub.notifyThread(thread.id, ["history-compacted"]);
      }
      return deleted;
    },
  };
}

function weighted<T>(rng: Rng, options: readonly [number, T][]): T {
  const total = options.reduce((sum, [weight]) => sum + weight, 0);
  let roll = rng() * total;
  for (const [weight, value] of options) {
    roll -= weight;
    if (roll < 0) return value;
  }
  const last = options.at(-1);
  if (last === undefined) throw new Error("no weighted options");
  return last[1];
}

export interface ClientSurface {
  deferContent: boolean;
  includeNestedRows: boolean;
  segmentLimit: number | null;
}

export const APP_SURFACE: ClientSurface = {
  deferContent: true,
  includeNestedRows: false,
  segmentLimit: null,
};

function timelineQuery(
  surface: ClientSurface,
  extra: Record<string, string>,
): string {
  const query = new URLSearchParams(extra);
  if (surface.deferContent) query.set("deferContent", "true");
  if (surface.includeNestedRows) query.set("includeNestedRows", "true");
  if (surface.segmentLimit !== null) {
    query.set("segmentLimit", String(surface.segmentLimit));
  }
  return query.toString();
}

export async function requestTimeline(
  harness: TestAppHarness,
  threadId: string,
  surface: ClientSurface,
  extra: Record<string, string> = {},
): Promise<{ status: number; body: ThreadTimelineReadResponse | null }> {
  const response = await harness.app.request(
    `/api/v1/threads/${threadId}/timeline?${timelineQuery(surface, extra)}`,
  );
  if (response.status !== 200) {
    return { status: response.status, body: null };
  }
  return {
    status: 200,
    body: threadTimelineReadResponseSchema.parse(await readJson(response)),
  };
}

export interface TimelineClient {
  readonly surface: ClientSurface;
  latest(): ThreadTimelineResponse;
  loaded(): LoadedTimelineState;
  refetch(): Promise<void>;
  deliverPushes(): Promise<void>;
  loadOlder(): Promise<"loaded" | "recovered" | "done">;
  walkToStart(): Promise<number>;
  close(): void;
}

const MAX_WALK_PAGES = 400;
const MAX_STALE_RECOVERIES_PER_WALK = 3;
const PUSH_DEADLINE_MS = 3_000;

export async function openTimelineClient(
  harness: TestAppHarness,
  threadId: string,
  surface: ClientSurface,
): Promise<TimelineClient> {
  const target: ThreadTimelineSubscriptionTarget = {
    kind: "thread-timeline",
    threadId,
    segmentLimit: surface.segmentLimit,
    deferContent: surface.deferContent,
  };
  const socket = createMockHubSocket();
  const pushed = !surface.includeNestedRows;
  const syncTag = (tag: string) => {
    if (pushed) harness.deps.hub.subscribe(socket, target, tag);
  };
  let latest = await readFullLatest(harness, threadId, surface);
  const surfaceKeyFor = (timeline: ThreadTimelineResponse) =>
    resolveLoadedTimelineSurfaceKey(threadId, timeline);
  let loaded = mergeLoadedTimelineWithLatest({
    current: buildLoadedTimelineState({
      historySnapshot: null,
      latestRows: [],
      latestWindowEndSequence: null,
      olderCursor: null,
      surfaceKey: surfaceKeyFor(latest),
    }),
    latestTimeline: latest,
    surfaceKey: surfaceKeyFor(latest),
  });
  syncTag(latest.tag);

  function receiveLatest(next: ThreadTimelineResponse): void {
    latest = next;
    loaded = mergeLoadedTimelineWithLatest({
      current: loaded,
      latestTimeline: next,
      surfaceKey: surfaceKeyFor(next),
    });
    syncTag(next.tag);
  }

  async function refetch(): Promise<void> {
    const { body } = await requestTimeline(harness, threadId, surface, {
      afterTag: latest.tag,
    });
    if (body === null) throw new Error("latest timeline request failed");
    const next = isThreadTimelineDelta(body)
      ? applyThreadTimelineDelta(latest, body)
      : body;
    receiveLatest(next ?? (await readFullLatest(harness, threadId, surface)));
  }

  async function loadOlder(): Promise<"loaded" | "recovered" | "done"> {
    const cursor = loaded.olderCursor;
    if (cursor === null) return "done";
    const { status, body } = await requestTimeline(harness, threadId, surface, {
      beforeAnchorSeq: String(cursor.anchorSeq),
      beforeAnchorId: cursor.anchorId,
    });
    if (body !== null) {
      const page = threadTimelineResponseSchema.parse(body);
      loaded = {
        ...loaded,
        olderCursor: page.timelinePage.olderCursor,
        rows: prependOlderTimelineRows({
          loadedRows: loaded.rows,
          olderRows: page.rows,
        }),
      };
      return "loaded";
    }
    expect(status, "older page request").toBe(400);
    const { body: recoveredBody } = await requestTimeline(
      harness,
      threadId,
      surface,
      { afterTag: latest.tag },
    );
    if (recoveredBody === null) throw new Error("latest refetch failed");
    const recovered =
      (isThreadTimelineDelta(recoveredBody)
        ? applyThreadTimelineDelta(latest, recoveredBody)
        : recoveredBody) ?? (await readFullLatest(harness, threadId, surface));
    loaded = recoverLoadedTimelineAfterStaleCursor({
      current: loaded,
      latestTimeline: recovered,
      surfaceKey: surfaceKeyFor(recovered),
    });
    latest = recovered;
    syncTag(recovered.tag);
    return "recovered";
  }

  async function receivePush(
    timeline: ThreadTimelineReadResponse | null,
  ): Promise<void> {
    if (timeline === null) {
      await refetch();
      return;
    }
    if (!isThreadTimelineDelta(timeline)) {
      if (timeline.maxSeq > latest.maxSeq) receiveLatest(timeline);
      return;
    }
    const applied = applyThreadTimelineDelta(latest, timeline);
    if (applied !== null) {
      receiveLatest(applied);
    } else if (timeline.maxSeq > latest.maxSeq) {
      await refetch();
    }
  }

  return {
    surface,
    latest: () => latest,
    loaded: () => loaded,
    refetch,
    async deliverPushes() {
      if (!pushed) {
        await refetch();
        return;
      }
      const target = getLatestThreadSequence(harness.db, { threadId });
      const deadline = performance.now() + PUSH_DEADLINE_MS;
      while (true) {
        const signals = socket.messages
          .splice(0)
          .map((raw) => JSON.parse(raw))
          .filter((message) => message.type === "thread-timeline")
          .map((message) => threadTimelineSignalSchema.parse(message));
        for (const { timeline } of signals) {
          await receivePush(timeline);
        }
        if (latest.maxSeq >= target) return;
        if (performance.now() > deadline) {
          throw new Error(
            `no push reached maxSeq ${target}; the client holds ${latest.maxSeq}`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    },
    loadOlder,
    async walkToStart() {
      let pages = 0;
      let recoveries = 0;
      while (loaded.olderCursor !== null) {
        const result = await loadOlder();
        pages += 1;
        if (result === "recovered") recoveries += 1;
        if (recoveries > MAX_STALE_RECOVERIES_PER_WALK) {
          throw new Error(
            `walk kept hitting stale cursors (${recoveries} recoveries)`,
          );
        }
        if (pages > MAX_WALK_PAGES) {
          throw new Error(`walk did not reach the start in ${pages} pages`);
        }
      }
      return pages;
    },
    close() {
      if (pushed) harness.deps.hub.unsubscribe(socket, target);
    },
  };
}

async function readFullLatest(
  harness: TestAppHarness,
  threadId: string,
  surface: ClientSurface,
): Promise<ThreadTimelineResponse> {
  const { body } = await requestTimeline(harness, threadId, surface);
  if (body === null || isThreadTimelineDelta(body)) {
    throw new Error("expected a full latest timeline");
  }
  return body;
}

interface UncachedTimelineArgs {
  eventBudget: number;
  responseByteBudget?: number;
  segmentLimit: number;
  surface: ClientSurface;
  threadId: string;
}

function buildUncachedTimeline(
  harness: TestAppHarness,
  args: UncachedTimelineArgs,
): ThreadTimelineResponse {
  const db: DbConnection = createConnection(harness.db.$client.serialize());
  try {
    const thread = getThread(db, args.threadId);
    if (thread === null) throw new Error("uncached build thread missing");
    const deps = { ...harness.deps, db };
    const settings = getAppSettings(db);
    const { response } = buildThreadTimelineWithProfile(db, thread, {
      ...resolveThreadHeadStateOptions(deps, thread.providerId),
      completedTurnDisplay: resolveThreadCompletedTurnDisplay(
        deps,
        settings,
        thread.providerId,
      ),
      deferContent: args.surface.deferContent,
      includeClearedContextHistory: settings.keepHistoryAfterContextClear,
      includeDiagnosticOperations: settings.showDiagnosticEvents,
      includeNestedRows: args.surface.includeNestedRows,
      maxInlineOutputChars: DEFAULT_MAX_INLINE_OUTPUT_CHARS,
      providerDisplayName: resolveThreadProviderDisplayName(
        deps,
        thread.providerId,
      ),
      summarizeShellCommands: settings.summarizeShellCommands,
      eventBudget: args.eventBudget,
      ...(args.responseByteBudget === undefined
        ? {}
        : { responseByteBudget: args.responseByteBudget }),
      maxSeq: getLatestThreadSequence(db, { threadId: args.threadId }),
      page: { kind: "latest", segmentLimit: args.segmentLimit },
    });
    const shortened = shortenTimelineResponseOutputs(response, {
      maxInlineOutputChars: DEFAULT_MAX_INLINE_OUTPUT_CHARS,
      preview: !args.surface.includeNestedRows,
    });
    return threadTimelineResponseSchema.parse(
      JSON.parse(JSON.stringify({ ...shortened, tag: "uncached" })),
    );
  } finally {
    db.$client.close();
  }
}

export function buildUncachedFullTimeline(
  harness: TestAppHarness,
  threadId: string,
  surface: ClientSurface,
): ThreadTimelineResponse {
  const response = buildUncachedTimeline(harness, {
    eventBudget: 1_000_000_000,
    responseByteBudget: 1_000_000_000,
    segmentLimit: 1_000_000,
    surface,
    threadId,
  });
  if (response.timelinePage.olderCursor !== null) {
    throw new Error("the uncached full build did not cover the thread");
  }
  return response;
}

export function describeRowDifference(
  actual: readonly TimelineRow[],
  expected: readonly TimelineRow[],
): string | null {
  const actualIds = actual.map((row) => row.id);
  const expectedIds = expected.map((row) => row.id);
  const expectedSet = new Set(expectedIds);
  const actualSet = new Set(actualIds);
  const missing = expectedIds.filter((id) => !actualSet.has(id));
  const extra = actualIds.filter((id) => !expectedSet.has(id));
  const duplicated = actualIds.filter(
    (id, index) => actualIds.indexOf(id) !== index,
  );
  const lines: string[] = [];
  if (missing.length > 0) lines.push(`missing rows: ${missing.join(", ")}`);
  if (extra.length > 0) lines.push(`extra rows: ${extra.join(", ")}`);
  if (duplicated.length > 0) {
    lines.push(`duplicated rows: ${duplicated.join(", ")}`);
  }
  if (lines.length === 0 && actualIds.join("\n") !== expectedIds.join("\n")) {
    const index = actualIds.findIndex((id, at) => id !== expectedIds[at]);
    lines.push(
      `order differs at ${index}: got ${actualIds.slice(index, index + 4).join(", ")}; want ${expectedIds.slice(index, index + 4).join(", ")}`,
    );
  }
  if (lines.length === 0) {
    const index = actual.findIndex(
      (row, at) => !isDeepStrictEqual(row, expected[at]),
    );
    if (index === -1) return null;
    lines.push(
      `row ${actual[index]?.id} differs:\n  got  ${JSON.stringify(actual[index]).slice(0, 1_200)}\n  want ${JSON.stringify(expected[index]).slice(0, 1_200)}`,
    );
  }
  return lines.join("\n");
}
