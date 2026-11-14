import type { ThreadEvent } from "@bb/domain";
import { requireThreadEventScopeTurnId } from "@bb/domain";

interface PendingActiveTurnWaiter {
  resolve: (turnId: string | null) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface WaitForActiveTurnStateArgs {
  threadId: string;
  timeoutMs: number;
}

export class RuntimeTurnState {
  private readonly activeTurnIdByThreadId = new Map<string, string>();
  private readonly activeTurnRequestIdsByThreadId = new Map<
    string,
    Set<string>
  >();
  private readonly activeTurnWaitersByThreadId = new Map<
    string,
    Set<PendingActiveTurnWaiter>
  >();

  clear(): void {
    this.activeTurnIdByThreadId.clear();
    this.activeTurnRequestIdsByThreadId.clear();
    for (const threadId of [...this.activeTurnWaitersByThreadId.keys()]) {
      this.resolveWaiters(threadId, null);
    }
  }

  clearThread(threadId: string): void {
    this.activeTurnIdByThreadId.delete(threadId);
    this.activeTurnRequestIdsByThreadId.delete(threadId);
    this.resolveWaiters(threadId, null);
  }

  clearStaleTurn(threadId: string, staleTurnId: string): void {
    const activeTurnId = this.activeTurnIdByThreadId.get(threadId);
    if (activeTurnId !== undefined && activeTurnId !== staleTurnId) {
      return;
    }
    this.clearThread(threadId);
  }

  resolveWaitersWithoutTurn(threadId: string): void {
    if (this.activeTurnIdByThreadId.has(threadId)) {
      return;
    }
    this.resolveWaiters(threadId, null);
  }

  getActiveTurnId(threadId: string): string | null {
    return this.activeTurnIdByThreadId.get(threadId) ?? null;
  }

  getActiveTurnRequestIds(threadId: string): string[] {
    return [...(this.activeTurnRequestIdsByThreadId.get(threadId) ?? [])];
  }

  noteActiveTurnRequest(threadId: string, requestId: string): void {
    this.activeTurnRequestIdsByThreadId.get(threadId)?.add(requestId);
  }

  getActiveThreadIds(): string[] {
    return [...this.activeTurnIdByThreadId.keys()];
  }

  waitForActiveTurn(args: WaitForActiveTurnStateArgs): Promise<string | null> {
    const activeTurnId = this.activeTurnIdByThreadId.get(args.threadId);
    if (activeTurnId !== undefined) {
      return Promise.resolve(activeTurnId);
    }

    return new Promise((resolve) => {
      const waiters =
        this.activeTurnWaitersByThreadId.get(args.threadId) ??
        new Set<PendingActiveTurnWaiter>();
      this.activeTurnWaitersByThreadId.set(args.threadId, waiters);
      const waiter: PendingActiveTurnWaiter = {
        resolve,
        timeout: setTimeout(() => {
          waiters.delete(waiter);
          if (waiters.size === 0) {
            this.activeTurnWaitersByThreadId.delete(args.threadId);
          }
          resolve(null);
        }, args.timeoutMs),
      };
      waiters.add(waiter);
    });
  }

  observe(event: ThreadEvent): void {
    if (event.type === "turn/started") {
      if (event.parentToolCallId) {
        return;
      }
      const turnId = requireThreadEventScopeTurnId({
        type: event.type,
        scope: event.scope,
      });
      this.activeTurnIdByThreadId.set(event.threadId, turnId);
      this.activeTurnRequestIdsByThreadId.set(event.threadId, new Set());
      this.resolveWaiters(event.threadId, turnId);
      return;
    }

    if (event.type === "turn/input/accepted") {
      if (
        event.scope.kind === "turn" &&
        this.activeTurnIdByThreadId.get(event.threadId) === event.scope.turnId
      ) {
        this.noteActiveTurnRequest(event.threadId, event.clientRequestId);
      }
      return;
    }

    if (event.type === "turn/completed") {
      const turnId = requireThreadEventScopeTurnId({
        type: event.type,
        scope: event.scope,
      });
      if (this.activeTurnIdByThreadId.get(event.threadId) === turnId) {
        this.activeTurnIdByThreadId.delete(event.threadId);
        this.activeTurnRequestIdsByThreadId.delete(event.threadId);
      }
    }
  }

  private resolveWaiters(threadId: string, turnId: string | null): void {
    const waiters = this.activeTurnWaitersByThreadId.get(threadId);
    if (!waiters) {
      return;
    }
    this.activeTurnWaitersByThreadId.delete(threadId);
    for (const waiter of waiters) {
      clearTimeout(waiter.timeout);
      waiter.resolve(turnId);
    }
  }
}
