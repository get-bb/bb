import type {
  HeldTurnCompletion,
  StoredThreadRunState,
  ThreadStopState,
  ThreadTurnRequestState,
} from "@bb/db";
import {
  THREAD_LIFECYCLE,
  THREAD_LIFECYCLE_EVENT_PREDICATES,
  type HeldTurnCompletionStatus,
  type SystemThreadInterruptedReason,
  type ThreadStatus,
  type ThreadStatusMove,
  type ThreadTurnRequestKind,
} from "@bb/domain";
import {
  COMPETING_TURN_ERROR_CODE,
  STEER_UNCONFIRMED_ERROR_CODE,
  TURN_START_UNCONFIRMED_ERROR_CODE,
} from "@bb/host-daemon-contract";

export interface ThreadLifecycleState extends StoredThreadRunState {
  activeTurnId: string | null;
  archived: boolean;
  deleted: boolean;
  provisioning: boolean;
  status: ThreadStatus;
}

export interface ThreadStartAcceptance {
  emptyFork: boolean;
  executionId: string;
  providerThreadId: string;
  stale: boolean;
}

export type TurnRequestAnswer =
  | { kind: "accepted"; threadStart: ThreadStartAcceptance | null }
  | { kind: "unconfirmed" }
  | { kind: "lost" }
  | { kind: "stale" }
  | {
      kind: "refused";
      code: string;
      commandType: string;
      expectedTurnCompleted: boolean;
      message: string;
      scopeTurnId: string | null;
    };

export type StopAnswer =
  | { kind: "stopped"; providerCheckpointId: string | null }
  | { kind: "unreachable" }
  | { kind: "gone" }
  | { kind: "failed" };

export type DaemonLossReason =
  | "host-daemon-restarted"
  | "host-connection-lost"
  | "host-removed";

export type RuntimeInterruptionReason =
  | SystemThreadInterruptedReason
  | "host-connection-lost";

export type ThreadLifecycleInput =
  | { type: "provisioning.started" }
  | { type: "provisioning.seeded" }
  | { type: "provisioning.failed" }
  | {
      type: "request.sent";
      request: {
        hostId: string;
        kind: ThreadTurnRequestKind;
        requestId: string;
        syncTitle: boolean;
      };
      now: number;
    }
  | { type: "request.answered"; requestId: string; answer: TurnRequestAnswer }
  | { type: "request.accepted"; requestId: string }
  | { type: "turn.started"; turnId: string; now: number }
  | { type: "turn.completed"; turnId: string; status: HeldTurnCompletionStatus }
  | { type: "provider.failed"; unstartedRequestId: string | null }
  | { type: "stop.requested"; reason: SystemThreadInterruptedReason; now: number }
  | { type: "stop.answered"; answer: StopAnswer; now: number }
  | { type: "stop.finalized"; providerCheckpointId: string | null }
  | { type: "release.answered"; retained: boolean }
  | {
      type: "daemon.reported";
      eventsPending: boolean;
      now: number;
      revivalBlocked: boolean;
      running: boolean;
      sameInstance: boolean;
    }
  | { type: "daemon.socket-opened"; now: number }
  | { type: "daemon.lost"; reason: DaemonLossReason; resuming: boolean }
  | { type: "turn-start.overdue"; deadlineMinutes: number; now: number }
  | { type: "server.restarted" };

export type ThreadLifecycleInputType = ThreadLifecycleInput["type"];

export type ParentNotice =
  | { turnStatus: "failed"; failureContext: string | null; turnId: null }
  | {
      turnStatus: "interrupted";
      turnId: string;
      interruption: {
        reason: SystemThreadInterruptedReason;
        cause: "host-connection-lost" | null;
      };
    };

export type ThreadLifecycleEffect =
  | { kind: "append-turn-interrupted"; turnId: string; providerCheckpointId: string | null }
  | {
      kind: "append-interruption";
      reason: SystemThreadInterruptedReason;
      cause: "host-connection-lost" | null;
      onlyIfMissing: boolean;
    }
  | { kind: "append-request-rejected"; requestId: string; reason: string; message: string }
  | {
      kind: "append-system-error";
      code: string;
      message: string;
      detail: string | null;
      turnId: string | null;
    }
  | { kind: "end-pending-interactions"; reason: RuntimeInterruptionReason | "thread-deleted" }
  | { kind: "abort-plugin-tool-calls"; reason: "thread-stopped" | "thread-deleted" }
  | { kind: "settle-background-tasks" }
  | { kind: "clear-provision-schedule" }
  | {
      kind: "record-empty-fork-session";
      executionId: string;
      providerThreadId: string;
    }
  | { kind: "send-stop" }
  | { kind: "redeliver-steer"; requestId: string }
  | { kind: "drain-queue"; wake: "thread-ready" | "turn-started" }
  | {
      kind: "turn-ended";
      turnId: string;
      status: HeldTurnCompletionStatus;
      disposition: "applied" | "held" | "released" | "ignored";
      afterStop: boolean;
    }
  | { kind: "notify-parent"; notice: ParentNotice }
  | { kind: "archive-provider-session" }
  | { kind: "sync-title" }
  | { kind: "prune-idle" };

export type ThreadLifecycleRefusal =
  | "deleted"
  | "archived"
  | "stopping"
  | "start-in-flight"
  | "not-startable"
  | "not-preparable"
  | "not-settleable";

export interface ThreadLifecycleTransition {
  effects: ThreadLifecycleEffect[];
  next: StoredThreadRunState & { status: ThreadStatus };
  refusal: ThreadLifecycleRefusal | null;
  stopRoute: "live" | "pre-start" | "none";
}

const UNCONFIRMED_STEER_MESSAGE =
  "The turn ended before the agent confirmed this steer";
const UNSTARTED_TURN_MESSAGE = "The agent did not start a turn for this message";

export function nextThreadStatus(
  thread: { archived: boolean; deleted: boolean; status: ThreadStatus },
  move: ThreadStatusMove,
): ThreadStatus | null {
  const predicates = THREAD_LIFECYCLE_EVENT_PREDICATES[move];
  if (predicates.notDeleted && thread.deleted) return null;
  if (predicates.notArchived && thread.archived) return null;
  return THREAD_LIFECYCLE[thread.status][move] ?? null;
}

class Draft {
  readonly effects: ThreadLifecycleEffect[] = [];
  heldCompletion: HeldTurnCompletion | null;
  refusal: ThreadLifecycleRefusal | null = null;
  requests: ThreadTurnRequestState[];
  status: ThreadStatus;
  stop: ThreadStopState | null;
  stopRoute: ThreadLifecycleTransition["stopRoute"] = "none";

  constructor(readonly state: ThreadLifecycleState) {
    this.status = state.status;
    this.requests = state.requests.map((request) => ({ ...request }));
    this.heldCompletion = state.heldCompletion;
    this.stop = state.stop;
  }

  move(move: ThreadStatusMove): boolean {
    const to = nextThreadStatus(
      {
        archived: this.state.archived,
        deleted: this.state.deleted,
        status: this.status,
      },
      move,
    );
    if (to === null) return false;
    this.status = to;
    return true;
  }

  effect(effect: ThreadLifecycleEffect): void {
    this.effects.push(effect);
  }

  refuse(refusal: ThreadLifecycleRefusal): void {
    this.refusal = refusal;
  }

  find(requestId: string): ThreadTurnRequestState | undefined {
    return this.requests.find((request) => request.requestId === requestId);
  }

  remove(requestId: string): void {
    this.requests = this.requests.filter(
      (request) => request.requestId !== requestId,
    );
  }

  reject(request: ThreadTurnRequestState): void {
    this.remove(request.requestId);
    if (request.kind === "thread-start") return;
    const steer = request.kind === "steer";
    this.effect({
      kind: "append-request-rejected",
      requestId: request.requestId,
      reason: steer ? STEER_UNCONFIRMED_ERROR_CODE : TURN_START_UNCONFIRMED_ERROR_CODE,
      message: steer ? UNCONFIRMED_STEER_MESSAGE : UNSTARTED_TURN_MESSAGE,
    });
  }

  awaitingAnswers(): boolean {
    return this.requests.some(
      (request) =>
        request.phase === "sent" ||
        (request.phase === "accepted" && request.kind !== "thread-start"),
    );
  }

  hasThreadStart(): boolean {
    return this.requests.some((request) => request.kind === "thread-start");
  }

  finish(): ThreadLifecycleTransition {
    return {
      effects: this.effects,
      next: {
        status: this.status,
        requests: this.requests,
        heldCompletion: this.heldCompletion,
        stop: this.stop,
      },
      refusal: this.refusal,
      stopRoute: this.stopRoute,
    };
  }
}

function moveForCompletion(status: HeldTurnCompletionStatus): ThreadStatusMove {
  if (status === "failed") return "run.failed";
  if (status === "interrupted") return "stop.settled";
  return "run.succeeded";
}

function moveForInterruption(reason: RuntimeInterruptionReason): ThreadStatusMove {
  return reason === "manual-stop" || reason === "host-removed"
    ? "stop.settled"
    : "run.failed";
}

function interruptionFailureMessage(
  reason: RuntimeInterruptionReason,
  resuming: boolean,
): { message: string; detail: string } | null {
  if (resuming) {
    return {
      message: "Thread interrupted because bb restarted",
      detail: "bb will resume the thread shortly.",
    };
  }
  switch (reason) {
    case "host-removed":
    case "manual-stop":
      return null;
    case "host-daemon-restarted":
      return {
        message: "Thread interrupted because the host daemon disconnected",
        detail: "Please retry the thread to continue.",
      };
    case "host-connection-lost":
      return {
        message: "Thread interrupted because the connection to the host was lost",
        detail: "Please retry the thread to continue.",
      };
    case "provider-turn-idle":
      return {
        message:
          "Live runtime work failed because the provider stopped sending progress",
        detail: "Provider stopped sending progress while the thread was running",
      };
  }
}

function rejectUnconfirmed(
  draft: Draft,
  kinds: readonly ThreadTurnRequestKind[],
): void {
  for (const request of [...draft.requests]) {
    if (request.phase === "unconfirmed" && kinds.includes(request.kind)) {
      draft.reject(request);
    }
  }
}

function unconfirm(draft: Draft, request: ThreadTurnRequestState): void {
  if (request.kind === "steer" && draft.state.activeTurnId === null) {
    draft.reject(request);
    return;
  }
  if (request.kind === "new-turn" && draft.status !== "active") {
    draft.reject(request);
    return;
  }
  request.phase = "unconfirmed";
}

function applyCompletion(
  draft: Draft,
  held: HeldTurnCompletion,
  disposition: "applied" | "released",
): void {
  const afterStop = draft.stop !== null && held.status !== "interrupted";
  const applied = draft.move(moveForCompletion(held.status));
  if (applied || draft.status === "idle" || draft.status === "error") {
    draft.stop = null;
  }
  if (applied && draft.status === "idle") {
    draft.effect({ kind: "prune-idle" });
  }
  draft.effect({
    kind: "turn-ended",
    turnId: held.turnId,
    status: held.status,
    disposition: applied ? disposition : "ignored",
    afterStop,
  });
}

function releaseHeld(draft: Draft): void {
  const held = draft.heldCompletion;
  if (held === null || draft.awaitingAnswers()) return;
  draft.heldCompletion = null;
  const active = draft.state.activeTurnId;
  if (active !== null && active !== held.turnId) return;
  applyCompletion(draft, held, "released");
}

function settleStopped(
  draft: Draft,
  args: {
    providerCheckpointId: string | null;
    reason: SystemThreadInterruptedReason;
  },
): void {
  const { state } = draft;
  const recorded = draft.stop !== null;
  if (draft.status === "active" || draft.status === "stopping") {
    if (state.activeTurnId !== null) {
      draft.effect({
        kind: "append-turn-interrupted",
        turnId: state.activeTurnId,
        providerCheckpointId: args.providerCheckpointId,
      });
    }
    draft.move(moveForInterruption(args.reason));
  } else if (draft.status === "starting") {
    draft.move(moveForInterruption(args.reason));
  }
  draft.heldCompletion = null;
  rejectUnconfirmed(draft, ["steer", "new-turn", "thread-start"]);
  if (state.deleted) {
    draft.effect({ kind: "end-pending-interactions", reason: "thread-deleted" });
    draft.effect({ kind: "abort-plugin-tool-calls", reason: "thread-deleted" });
    draft.effect({ kind: "clear-provision-schedule" });
    return;
  }
  draft.effect({ kind: "end-pending-interactions", reason: args.reason });
  draft.effect({ kind: "abort-plugin-tool-calls", reason: "thread-stopped" });
  if (!recorded) {
    draft.effect({
      kind: "append-interruption",
      reason: args.reason,
      cause: null,
      onlyIfMissing: true,
    });
  }
}

function interruptForLoss(
  draft: Draft,
  args: {
    cause: "host-connection-lost" | null;
    reason: SystemThreadInterruptedReason;
    resuming: boolean;
  },
): void {
  const { state } = draft;
  const effective: RuntimeInterruptionReason = args.cause ?? args.reason;
  if (state.activeTurnId !== null) {
    draft.effect({
      kind: "append-turn-interrupted",
      turnId: state.activeTurnId,
      providerCheckpointId: null,
    });
  }
  const failure = interruptionFailureMessage(effective, args.resuming);
  if (failure !== null) {
    draft.effect({
      kind: "append-system-error",
      code: "thread_command_failed",
      message: failure.message,
      detail: failure.detail,
      turnId: state.activeTurnId,
    });
  }
  draft.effect({
    kind: "append-interruption",
    reason: args.reason,
    cause: args.cause,
    onlyIfMissing: false,
  });
  if (args.reason === "host-removed" && draft.status === "active") {
    draft.move("stop.requested");
  }
  draft.move(moveForInterruption(effective));
  draft.effect({ kind: "end-pending-interactions", reason: effective });
  draft.effect({ kind: "abort-plugin-tool-calls", reason: "thread-stopped" });
  if (state.activeTurnId !== null && !args.resuming) {
    draft.effect({
      kind: "notify-parent",
      notice: {
        turnStatus: "interrupted",
        turnId: state.activeTurnId,
        interruption: { reason: args.reason, cause: args.cause },
      },
    });
  }
}

function sendStop(draft: Draft, now: number): void {
  if (draft.stop === null) return;
  draft.stop = { ...draft.stop, sentAt: now };
  draft.effect({ kind: "send-stop" });
}

function hasLiveRuntime(draft: Draft): boolean {
  return (
    draft.status === "active" ||
    draft.hasThreadStart() ||
    (draft.status === "stopping" && draft.state.activeTurnId !== null)
  );
}

function requestStop(
  draft: Draft,
  args: { now: number; reason: SystemThreadInterruptedReason },
): void {
  if (draft.status !== "stopping" && draft.move("stop.requested")) {
    draft.effect({
      kind: "append-interruption",
      reason: args.reason,
      cause: null,
      onlyIfMissing: false,
    });
  }
  const owed =
    draft.stop !== null && draft.stop.ackedAt === null ? draft.stop : null;
  draft.stop = {
    ackedAt: null,
    reason: owed?.reason ?? args.reason,
    requestedAt: owed?.requestedAt ?? args.now,
    sentAt: owed?.sentAt ?? null,
  };
}

function sendStopUnlessInFlight(draft: Draft, now: number): void {
  if (draft.stop !== null && draft.stop.sentAt === null) {
    sendStop(draft, now);
  }
}

function acceptThreadStart(
  draft: Draft,
  request: ThreadTurnRequestState,
  acceptance: ThreadStartAcceptance | null,
): void {
  draft.effect({ kind: "clear-provision-schedule" });
  if (draft.state.deleted) {
    settleStopped(draft, { providerCheckpointId: null, reason: "manual-stop" });
    return;
  }
  if (acceptance !== null && !acceptance.stale) {
    if (acceptance.emptyFork) {
      draft.effect({
        kind: "record-empty-fork-session",
        executionId: acceptance.executionId,
        providerThreadId: acceptance.providerThreadId,
      });
    }
    const applied = draft.move(
      acceptance.emptyFork ? "run.succeeded" : "run.started",
    );
    if (applied && acceptance.emptyFork) {
      draft.effect({ kind: "drain-queue", wake: "thread-ready" });
    }
  }
  if (request.syncTitle) {
    draft.effect({ kind: "sync-title" });
  }
}

function answerRequest(
  draft: Draft,
  input: Extract<ThreadLifecycleInput, { type: "request.answered" }>,
): void {
  const request = draft.find(input.requestId);
  if (request === undefined) return;
  const { answer } = input;
  if (request.phase === "accepted" && answer.kind !== "accepted") {
    draft.remove(request.requestId);
    releaseHeld(draft);
    return;
  }
  switch (answer.kind) {
    case "accepted":
      draft.remove(request.requestId);
      if (request.kind === "thread-start") {
        acceptThreadStart(draft, request, answer.threadStart);
      }
      releaseHeld(draft);
      return;
    case "unconfirmed":
      unconfirm(draft, request);
      releaseHeld(draft);
      return;
    case "lost":
      request.phase = "unconfirmed";
      releaseHeld(draft);
      return;
    case "stale":
      if (draft.status === "active" && !draft.state.deleted) {
        draft.effect({ kind: "redeliver-steer", requestId: request.requestId });
        return;
      }
      refuseRequest(draft, request, {
        kind: "refused",
        code: "stale_turn",
        commandType: "turn.submit",
        expectedTurnCompleted: true,
        message: "The turn this steer targeted already ended",
        scopeTurnId: null,
      });
      releaseHeld(draft);
      return;
    case "refused":
      refuseRequest(draft, request, answer);
      releaseHeld(draft);
      return;
  }
}

function refuseRequest(
  draft: Draft,
  request: ThreadTurnRequestState,
  answer: Extract<TurnRequestAnswer, { kind: "refused" }>,
): void {
  draft.remove(request.requestId);
  if (draft.state.deleted) return;
  if (request.kind === "thread-start") {
    draft.effect({ kind: "clear-provision-schedule" });
  } else {
    draft.effect({
      kind: "append-request-rejected",
      requestId: request.requestId,
      reason: answer.code,
      message: answer.message,
    });
    if (
      answer.code === COMPETING_TURN_ERROR_CODE &&
      draft.state.activeTurnId !== null
    ) {
      return;
    }
  }
  if (answer.expectedTurnCompleted) return;
  draft.effect({
    kind: "append-system-error",
    code: "thread_command_failed",
    message: `Command ${answer.commandType} failed`,
    detail: answer.message,
    turnId: answer.scopeTurnId,
  });
  draft.move("run.failed");
  draft.heldCompletion = null;
  draft.effect({
    kind: "notify-parent",
    notice: { turnStatus: "failed", failureContext: null, turnId: null },
  });
}

function reportDaemon(
  draft: Draft,
  input: Extract<ThreadLifecycleInput, { type: "daemon.reported" }>,
): void {
  const { state } = draft;
  if (state.archived) {
    if (input.running) {
      requestStop(draft, { now: input.now, reason: "manual-stop" });
      sendStop(draft, input.now);
      return;
    }
    if (
      draft.status === "active" ||
      draft.status === "starting" ||
      draft.status === "stopping"
    ) {
      settleStopped(draft, {
        providerCheckpointId: null,
        reason: draft.stop?.reason ?? "manual-stop",
      });
      draft.stop = null;
      draft.effect({ kind: "drain-queue", wake: "thread-ready" });
      draft.effect({ kind: "archive-provider-session" });
    }
    return;
  }
  if (draft.status === "stopping") {
    if (input.running) {
      requestStop(draft, { now: input.now, reason: "manual-stop" });
      sendStop(draft, input.now);
      return;
    }
    settleStopped(draft, {
      providerCheckpointId: null,
      reason: draft.stop?.reason ?? "manual-stop",
    });
    draft.stop = null;
    draft.effect({ kind: "drain-queue", wake: "thread-ready" });
    draft.effect({ kind: "archive-provider-session" });
    return;
  }
  if (!input.running) {
    if (input.eventsPending) return;
    const lostStart = draft.requests.some(
      (request) => request.kind === "thread-start" && request.phase === "unconfirmed",
    );
    rejectUnconfirmed(draft, ["steer", "new-turn", "thread-start"]);
    draft.stop = null;
    if (draft.status === "active") {
      if (draft.heldCompletion !== null && !draft.awaitingAnswers()) {
        const held = draft.heldCompletion;
        draft.heldCompletion = null;
        applyCompletion(draft, held, "released");
        return;
      }
      interruptForLoss(draft, {
        cause: input.sameInstance ? "host-connection-lost" : null,
        reason: "host-daemon-restarted",
        resuming: false,
      });
      return;
    }
    if (draft.status === "starting" && lostStart) {
      draft.effect({
        kind: "append-system-error",
        code: "thread_command_failed",
        message: "Thread start was interrupted",
        detail:
          "bb lost the answer to the thread start and the machine is not running it. Send a message to try again.",
        turnId: null,
      });
      draft.effect({ kind: "clear-provision-schedule" });
      draft.move("run.failed");
      draft.effect({
        kind: "notify-parent",
        notice: { turnStatus: "failed", failureContext: null, turnId: null },
      });
    }
    return;
  }
  for (const request of [...draft.requests]) {
    if (request.kind === "thread-start" && request.phase === "unconfirmed") {
      draft.remove(request.requestId);
    }
  }
  if (draft.stop !== null) {
    sendStop(draft, input.now);
    return;
  }
  if (draft.status === "error") {
    draft.move("run.started");
    return;
  }
  if (draft.status === "starting" || draft.status === "idle") {
    if (input.revivalBlocked) return;
    if (draft.move("run.started")) {
      draft.effect({ kind: "clear-provision-schedule" });
    }
  }
}

function loseDaemon(
  draft: Draft,
  input: Extract<ThreadLifecycleInput, { type: "daemon.lost" }>,
): void {
  for (const request of [...draft.requests]) {
    if (request.phase === "accepted") {
      draft.remove(request.requestId);
    } else {
      draft.reject(request);
    }
  }
  draft.stop = null;
  const held = draft.heldCompletion;
  draft.heldCompletion = null;
  const interruptible =
    draft.status === "active" ||
    (input.reason === "host-removed" && draft.status === "stopping");
  if (!interruptible) return;
  if (held !== null && input.reason !== "host-removed") {
    applyCompletion(draft, held, "released");
    return;
  }
  const cause = input.reason === "host-connection-lost" ? "host-connection-lost" : null;
  interruptForLoss(draft, {
    cause,
    reason:
      input.reason === "host-connection-lost" ? "host-daemon-restarted" : input.reason,
    resuming: input.resuming,
  });
}

export function transitionThreadLifecycle(
  state: ThreadLifecycleState,
  input: ThreadLifecycleInput,
): ThreadLifecycleTransition {
  const draft = new Draft(state);
  switch (input.type) {
    case "provisioning.started":
      if (!draft.move("run.preparing")) draft.refuse("not-preparable");
      break;
    case "provisioning.seeded":
      if (!draft.move("run.succeeded")) draft.refuse("not-settleable");
      break;
    case "provisioning.failed":
      if (!draft.move("run.failed")) draft.refuse("not-settleable");
      break;
    case "request.sent": {
      const { request } = input;
      if (state.deleted) {
        draft.refuse("deleted");
        break;
      }
      if (draft.status === "stopping") {
        draft.refuse("stopping");
        break;
      }
      if (request.kind === "thread-start" && draft.hasThreadStart()) {
        draft.refuse("start-in-flight");
        break;
      }
      if (request.kind === "new-turn" && !draft.move("run.started")) {
        draft.refuse(state.archived ? "archived" : "not-startable");
        break;
      }
      if (request.kind === "thread-start") {
        if (state.archived) {
          draft.refuse("archived");
          break;
        }
        if (draft.status === "idle" || draft.status === "error") {
          draft.move("run.started");
        }
      }
      draft.requests.push({ ...request, phase: "sent", sentAt: input.now });
      if (request.kind !== "steer") draft.stop = null;
      break;
    }
    case "request.answered":
      answerRequest(draft, input);
      break;
    case "request.accepted": {
      const request = draft.find(input.requestId);
      if (request === undefined) break;
      if (request.phase === "unconfirmed") {
        draft.remove(request.requestId);
      } else {
        request.phase = "accepted";
      }
      break;
    }
    case "turn.started":
      if (draft.stop !== null) {
        if (draft.status !== "stopping") sendStop(draft, input.now);
        break;
      }
      for (const request of draft.requests) {
        if (request.kind === "thread-start" && request.phase === "sent") {
          request.phase = "accepted";
        }
      }
      draft.move("run.started");
      if (draft.status === "active") {
        draft.effect({ kind: "drain-queue", wake: "turn-started" });
      }
      break;
    case "turn.completed": {
      rejectUnconfirmed(draft, ["steer"]);
      const completion = { turnId: input.turnId, status: input.status };
      if (draft.awaitingAnswers()) {
        draft.heldCompletion = completion;
        draft.effect({
          kind: "turn-ended",
          turnId: input.turnId,
          status: input.status,
          disposition: "held",
          afterStop: draft.stop !== null && input.status !== "interrupted",
        });
        break;
      }
      draft.heldCompletion = null;
      applyCompletion(draft, completion, "applied");
      break;
    }
    case "provider.failed":
      if (input.unstartedRequestId !== null) {
        const unstarted = draft.find(input.unstartedRequestId);
        draft.remove(input.unstartedRequestId);
        draft.effect({
          kind: "append-request-rejected",
          requestId: input.unstartedRequestId,
          reason: TURN_START_UNCONFIRMED_ERROR_CODE,
          message: UNSTARTED_TURN_MESSAGE,
        });
        if (unstarted?.kind === "thread-start") {
          draft.effect({ kind: "clear-provision-schedule" });
        }
      }
      if (draft.move("run.failed")) {
        draft.heldCompletion = null;
        draft.effect({
          kind: "notify-parent",
          notice: { turnStatus: "failed", failureContext: null, turnId: null },
        });
      }
      break;
    case "stop.requested":
      if (hasLiveRuntime(draft)) {
        draft.stopRoute = "live";
        requestStop(draft, input);
        sendStopUnlessInFlight(draft, input.now);
        break;
      }
      if (
        draft.status === "starting" ||
        draft.status === "stopping" ||
        state.provisioning
      ) {
        draft.stopRoute = "pre-start";
        requestStop(draft, input);
      }
      break;
    case "stop.answered":
      switch (input.answer.kind) {
        case "stopped":
        case "gone":
        case "unreachable": {
          const reason = draft.stop?.reason ?? "manual-stop";
          draft.effect({ kind: "settle-background-tasks" });
          settleStopped(draft, {
            providerCheckpointId:
              input.answer.kind === "stopped"
                ? input.answer.providerCheckpointId
                : null,
            reason,
          });
          if (draft.stop !== null && input.answer.kind !== "gone") {
            draft.stop = {
              ...draft.stop,
              ackedAt: input.answer.kind === "stopped" ? input.now : null,
              sentAt: null,
            };
          } else {
            draft.stop = null;
          }
          if (input.answer.kind === "stopped") {
            draft.effect({ kind: "archive-provider-session" });
          }
          draft.effect({ kind: "drain-queue", wake: "thread-ready" });
          break;
        }
        case "failed":
          if (draft.stop !== null) draft.stop = { ...draft.stop, sentAt: null };
          break;
      }
      break;
    case "stop.finalized": {
      settleStopped(draft, {
        providerCheckpointId: input.providerCheckpointId,
        reason: draft.stop?.reason ?? "manual-stop",
      });
      draft.stop = null;
      if (!state.deleted) {
        draft.effect({ kind: "drain-queue", wake: "thread-ready" });
        draft.effect({ kind: "archive-provider-session" });
      }
      break;
    }
    case "release.answered":
      if (input.retained) {
        if (draft.status === "idle" || draft.status === "error") {
          draft.move("run.started");
        }
      } else {
        draft.effect({ kind: "settle-background-tasks" });
        if (draft.status === "idle" || draft.status === "error") {
          draft.effect({
            kind: "end-pending-interactions",
            reason: "manual-stop",
          });
        }
      }
      break;
    case "daemon.reported":
      reportDaemon(draft, input);
      break;
    case "daemon.socket-opened":
      if (draft.stop !== null && draft.stop.ackedAt === null) {
        sendStopUnlessInFlight(draft, input.now);
      }
      break;
    case "daemon.lost":
      loseDaemon(draft, input);
      break;
    case "turn-start.overdue":
      if (draft.status !== "active" || state.activeTurnId !== null) break;
      requestStop(draft, { now: input.now, reason: "provider-turn-idle" });
      draft.effect({
        kind: "append-system-error",
        code: "provider_turn_start_deadline",
        message: `The provider did not start the turn within ${input.deadlineMinutes} minutes, so bb stopped it. Send a message to try again.`,
        detail: null,
        turnId: null,
      });
      sendStop(draft, input.now);
      draft.effect({
        kind: "notify-parent",
        notice: {
          turnStatus: "failed",
          failureContext: `was stopped by bb because its provider did not start the turn within ${input.deadlineMinutes} minutes`,
          turnId: null,
        },
      });
      break;
    case "server.restarted":
      for (const request of [...draft.requests]) {
        if (request.phase === "accepted") {
          draft.remove(request.requestId);
        } else if (request.phase === "sent") {
          request.phase = "unconfirmed";
        }
      }
      if (draft.stop !== null) draft.stop = { ...draft.stop, sentAt: null };
      releaseHeld(draft);
      break;
  }
  return draft.finish();
}
