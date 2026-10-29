export type InFlightThreadRpcKind =
  | "thread.start"
  | "thread.start.title-sync"
  | "thread.stop"
  | "thread.storage.delete"
  | "thread.stop.release";

export class InFlightThreadRpcGuard {
  private readonly holders = new Map<string, number>();

  private key(threadId: string, kind: InFlightThreadRpcKind): string {
    return `${kind}:${threadId}`;
  }

  claim(threadId: string, kind: InFlightThreadRpcKind): boolean {
    const key = this.key(threadId, kind);
    if (this.holders.has(key)) {
      return false;
    }
    this.holders.set(key, 1);
    return true;
  }

  share(threadId: string, kind: InFlightThreadRpcKind): void {
    const key = this.key(threadId, kind);
    this.holders.set(key, (this.holders.get(key) ?? 0) + 1);
  }

  release(threadId: string, kind: InFlightThreadRpcKind): void {
    const key = this.key(threadId, kind);
    const count = this.holders.get(key);
    if (count === undefined || count <= 1) {
      this.holders.delete(key);
      return;
    }
    this.holders.set(key, count - 1);
  }

  isHeld(threadId: string, kind: InFlightThreadRpcKind): boolean {
    return this.holders.has(this.key(threadId, kind));
  }
}
