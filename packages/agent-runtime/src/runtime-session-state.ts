import type { ThreadEvent } from "@bb/domain";
import { requireThreadEventScopeTurnId } from "@bb/domain";

export type RuntimeSessionPhase =
  | { phase: "starting" }
  | { phase: "idle"; sinceMs: number }
  | { phase: "turnStarting"; sinceMs: number }
  | { phase: "turnRunning"; turnId: string }
  | { phase: "compacting"; turnId: string }
  | { phase: "waitingOnUser"; turnId: string | null }
  | { phase: "stopping" }
  | { phase: "dead" };

export type RuntimeSessionPhaseName = RuntimeSessionPhase["phase"];

export type RuntimeInputAdmission =
  | { kind: "admitted" }
  | { kind: "busy"; message: string }
  | { kind: "stale"; activeTurnId: string | null };

interface PendingTurnStart {
  sinceMs: number;
  watchdogFired: boolean;
}

interface ThreadSessionState {
  lifecycle: "starting" | "live" | "stopping";
  turnStart: PendingTurnStart | null;
  activeTurnId: string | null;
  compactionItemIds: Set<string>;
  interactions: number;
  idleSinceMs: number;
}

interface PendingActiveTurnWaiter {
  resolve: (turnId: string | null) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export interface RuntimePendingTurnStart {
  threadId: string;
  sinceMs: number;
}

export class RuntimeSessionStates {
  private readonly states = new Map<string, ThreadSessionState>();
  private readonly activeTurnWaiters = new Map<
    string,
    Set<PendingActiveTurnWaiter>
  >();

  constructor(private readonly now: () => number = Date.now) {}

  private ensure(threadId: string): ThreadSessionState {
    const existing = this.states.get(threadId);
    if (existing !== undefined) {
      return existing;
    }
    const created: ThreadSessionState = {
      lifecycle: "starting",
      turnStart: null,
      activeTurnId: null,
      compactionItemIds: new Set(),
      interactions: 0,
      idleSinceMs: this.now(),
    };
    this.states.set(threadId, created);
    return created;
  }

  beginConstruction(threadId: string): void {
    const state = this.ensure(threadId);
    state.lifecycle = "starting";
  }

  markLive(threadId: string): void {
    const state = this.ensure(threadId);
    state.lifecycle = "live";
    if (state.activeTurnId === null && state.turnStart === null) {
      state.idleSinceMs = this.now();
    }
  }

  cancelStopping(threadId: string): void {
    const state = this.states.get(threadId);
    if (state?.lifecycle === "stopping") {
      state.lifecycle = "live";
    }
  }

  markStopping(threadId: string): void {
    const state = this.states.get(threadId);
    if (state !== undefined) {
      state.lifecycle = "stopping";
    }
  }

  forget(threadId: string): void {
    this.states.delete(threadId);
    this.resolveWaiters(threadId, null);
  }

  clear(): void {
    this.states.clear();
    for (const threadId of [...this.activeTurnWaiters.keys()]) {
      this.resolveWaiters(threadId, null);
    }
  }

  phase(threadId: string): RuntimeSessionPhase {
    const state = this.states.get(threadId);
    if (state === undefined) {
      return { phase: "dead" };
    }
    if (state.lifecycle === "stopping") {
      return { phase: "stopping" };
    }
    if (state.lifecycle === "starting") {
      return { phase: "starting" };
    }
    if (state.interactions > 0) {
      return { phase: "waitingOnUser", turnId: state.activeTurnId };
    }
    if (state.activeTurnId !== null) {
      return state.compactionItemIds.size > 0
        ? { phase: "compacting", turnId: state.activeTurnId }
        : { phase: "turnRunning", turnId: state.activeTurnId };
    }
    if (state.turnStart !== null) {
      return { phase: "turnStarting", sinceMs: state.turnStart.sinceMs };
    }
    return { phase: "idle", sinceMs: state.idleSinceMs };
  }

  admitTurnStart(threadId: string): RuntimeInputAdmission {
    const phase = this.phase(threadId);
    switch (phase.phase) {
      case "idle": {
        const state = this.ensure(threadId);
        state.turnStart = { sinceMs: this.now(), watchdogFired: false };
        return { kind: "admitted" };
      }
      case "dead":
        return { kind: "busy", message: "The provider session is not live." };
      case "starting":
        return {
          kind: "busy",
          message: "The provider session is still starting.",
        };
      case "stopping":
        return { kind: "busy", message: "The provider session is stopping." };
      case "compacting":
        return { kind: "busy", message: "The agent is compacting context." };
      case "turnStarting":
      case "turnRunning":
      case "waitingOnUser":
        return {
          kind: "busy",
          message: "Another turn is active or starting.",
        };
    }
  }

  admitSteer(threadId: string, expectedTurnId: string): RuntimeInputAdmission {
    const phase = this.phase(threadId);
    const activeTurnId = this.getActiveTurnId(threadId);
    if (activeTurnId !== expectedTurnId) {
      return { kind: "stale", activeTurnId };
    }
    switch (phase.phase) {
      case "turnRunning":
      case "waitingOnUser":
        return { kind: "admitted" };
      case "compacting":
        return { kind: "busy", message: "The agent is compacting context." };
      case "stopping":
        return { kind: "busy", message: "The provider session is stopping." };
      case "starting":
      case "turnStarting":
      case "idle":
      case "dead":
        return { kind: "stale", activeTurnId };
    }
  }

  settleTurnStart(threadId: string): void {
    const state = this.states.get(threadId);
    if (state === undefined || state.turnStart === null) {
      return;
    }
    state.turnStart = null;
    if (state.activeTurnId === null) {
      state.idleSinceMs = this.now();
      this.resolveWaiters(threadId, null);
    }
  }

  hasTurnStart(threadId: string): boolean {
    return this.states.get(threadId)?.turnStart != null;
  }

  takeOverdueTurnStarts(thresholdMs: number): RuntimePendingTurnStart[] {
    const nowMs = this.now();
    const overdue: RuntimePendingTurnStart[] = [];
    for (const [threadId, state] of this.states) {
      const start = state.turnStart;
      if (
        start === null ||
        start.watchdogFired ||
        nowMs - start.sinceMs < thresholdMs
      ) {
        continue;
      }
      start.watchdogFired = true;
      overdue.push({ threadId, sinceMs: start.sinceMs });
    }
    return overdue;
  }

  beginInteraction(threadId: string): void {
    const state = this.states.get(threadId);
    if (state !== undefined) {
      state.interactions += 1;
    }
  }

  endInteraction(threadId: string): void {
    const state = this.states.get(threadId);
    if (state !== undefined && state.interactions > 0) {
      state.interactions -= 1;
    }
  }

  getActiveTurnId(threadId: string): string | null {
    return this.states.get(threadId)?.activeTurnId ?? null;
  }

  getActiveThreadIds(): string[] {
    return [...this.states]
      .filter(([, state]) => state.activeTurnId !== null)
      .map(([threadId]) => threadId);
  }

  isIdle(threadId: string): boolean {
    return this.phase(threadId).phase === "idle";
  }

  waitForActiveTurn(args: {
    threadId: string;
    timeoutMs: number;
  }): Promise<string | null> {
    const activeTurnId = this.getActiveTurnId(args.threadId);
    if (activeTurnId !== null) {
      return Promise.resolve(activeTurnId);
    }
    return new Promise((resolve) => {
      const waiters =
        this.activeTurnWaiters.get(args.threadId) ??
        new Set<PendingActiveTurnWaiter>();
      this.activeTurnWaiters.set(args.threadId, waiters);
      const waiter: PendingActiveTurnWaiter = {
        resolve,
        timeout: setTimeout(() => {
          waiters.delete(waiter);
          if (waiters.size === 0) {
            this.activeTurnWaiters.delete(args.threadId);
          }
          resolve(null);
        }, args.timeoutMs),
      };
      waiters.add(waiter);
    });
  }

  resolveWaitersWithoutTurn(threadId: string): void {
    const state = this.states.get(threadId);
    if (state?.activeTurnId != null || state?.turnStart != null) {
      return;
    }
    this.resolveWaiters(threadId, null);
  }

  clearStaleTurn(threadId: string, staleTurnId: string): void {
    const state = this.states.get(threadId);
    if (state === undefined) {
      return;
    }
    if (state.activeTurnId !== null && state.activeTurnId !== staleTurnId) {
      return;
    }
    state.activeTurnId = null;
    state.compactionItemIds.clear();
    state.idleSinceMs = this.now();
    this.resolveWaiters(threadId, null);
  }

  observe(event: ThreadEvent): void {
    const state = this.states.get(event.threadId);
    if (state === undefined) {
      return;
    }
    switch (event.type) {
      case "turn/started": {
        if (event.parentToolCallId) {
          return;
        }
        const turnId = requireThreadEventScopeTurnId({
          type: event.type,
          scope: event.scope,
        });
        state.turnStart = null;
        state.activeTurnId = turnId;
        state.compactionItemIds.clear();
        this.resolveWaiters(event.threadId, turnId);
        return;
      }
      case "turn/completed": {
        const turnId = requireThreadEventScopeTurnId({
          type: event.type,
          scope: event.scope,
        });
        state.turnStart = null;
        if (state.activeTurnId === turnId) {
          state.activeTurnId = null;
          state.compactionItemIds.clear();
        }
        if (state.activeTurnId === null) {
          state.idleSinceMs = this.now();
          this.resolveWaiters(event.threadId, null);
        }
        return;
      }
      case "item/started":
      case "item/completed": {
        if (
          event.item.type !== "contextCompaction" ||
          event.scope.kind !== "turn" ||
          event.scope.turnId !== state.activeTurnId
        ) {
          return;
        }
        if (event.type === "item/started") {
          state.compactionItemIds.add(event.item.id);
        } else {
          state.compactionItemIds.delete(event.item.id);
        }
        return;
      }
      case "provider/error": {
        if (event.willRetry === true || state.turnStart === null) {
          return;
        }
        state.turnStart = null;
        if (state.activeTurnId === null) {
          state.idleSinceMs = this.now();
          this.resolveWaiters(event.threadId, null);
        }
        return;
      }
      default:
        return;
    }
  }

  private resolveWaiters(threadId: string, turnId: string | null): void {
    const waiters = this.activeTurnWaiters.get(threadId);
    if (!waiters) {
      return;
    }
    this.activeTurnWaiters.delete(threadId);
    for (const waiter of waiters) {
      clearTimeout(waiter.timeout);
      waiter.resolve(turnId);
    }
  }
}
