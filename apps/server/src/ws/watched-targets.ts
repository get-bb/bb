import type { RealtimeSubscriptionTarget } from "@bb/domain";

export type WatchedTargetKind = RealtimeSubscriptionTarget["kind"];

export type WatchedTarget<Kind extends WatchedTargetKind> = Extract<
  RealtimeSubscriptionTarget,
  { kind: Kind }
>;

export interface WatchedTargetChange<
  Target extends RealtimeSubscriptionTarget,
> {
  started: readonly Target[];
  stopped: readonly Target[];
}

export interface WatchedTargetStart {
  key: string;
  target: RealtimeSubscriptionTarget;
}

interface WatchedTargetListener {
  isWatched(target: RealtimeSubscriptionTarget): boolean;
  notify(change: WatchedTargetChange<RealtimeSubscriptionTarget>): void;
}

function isTargetOfKinds<Kind extends WatchedTargetKind>(
  kinds: readonly Kind[],
): (target: RealtimeSubscriptionTarget) => target is WatchedTarget<Kind> {
  const kindSet = new Set<WatchedTargetKind>(kinds);
  return (target): target is WatchedTarget<Kind> => kindSet.has(target.kind);
}

export class WatchedTargetRegistry {
  private readonly targetsByKey = new Map<string, RealtimeSubscriptionTarget>();
  private readonly targetsByKind = new Map<
    WatchedTargetKind,
    Set<RealtimeSubscriptionTarget>
  >();
  private readonly listeners = new Set<WatchedTargetListener>();

  list<Kind extends WatchedTargetKind>(kind: Kind): WatchedTarget<Kind>[] {
    return [...(this.targetsByKind.get(kind) ?? [])].filter(
      isTargetOfKinds([kind]),
    );
  }

  listen<Kind extends WatchedTargetKind>(
    kinds: readonly Kind[],
    listener: (change: WatchedTargetChange<WatchedTarget<Kind>>) => void,
  ): () => void {
    const isWatched = isTargetOfKinds(kinds);
    const entry: WatchedTargetListener = {
      isWatched,
      notify: (change) => {
        listener({
          started: change.started.filter(isWatched),
          stopped: change.stopped.filter(isWatched),
        });
      },
    };
    this.listeners.add(entry);
    const current = kinds.flatMap((kind) => this.list(kind));
    if (current.length > 0) {
      listener({ started: current, stopped: [] });
    }
    return () => {
      this.listeners.delete(entry);
    };
  }

  update(
    starts: readonly WatchedTargetStart[],
    stoppedKeys: readonly string[],
  ): void {
    const started: RealtimeSubscriptionTarget[] = [];
    const stopped: RealtimeSubscriptionTarget[] = [];
    for (const key of stoppedKeys) {
      const target = this.targetsByKey.get(key);
      if (target === undefined) {
        continue;
      }
      this.targetsByKey.delete(key);
      this.targetsByKind.get(target.kind)?.delete(target);
      stopped.push(target);
    }
    for (const { key, target } of starts) {
      if (this.targetsByKey.has(key)) {
        continue;
      }
      this.targetsByKey.set(key, target);
      const targets = this.targetsByKind.get(target.kind) ?? new Set();
      targets.add(target);
      this.targetsByKind.set(target.kind, targets);
      started.push(target);
    }
    for (const listener of [...this.listeners]) {
      if (
        started.some(listener.isWatched) ||
        stopped.some(listener.isWatched)
      ) {
        listener.notify({ started, stopped });
      }
    }
  }
}
