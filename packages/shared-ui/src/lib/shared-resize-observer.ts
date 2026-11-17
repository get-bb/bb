import { flushSync } from "react-dom";

export interface SharedResizePhases<T> {
  read: (entry: ResizeObserverEntry | undefined) => T;
  write: (value: T) => void;
}

interface RegisteredPhases {
  read: (entry: ResizeObserverEntry | undefined) => () => void;
}

interface PhaseDispatch {
  registration: RegisteredPhases;
  entry: ResizeObserverEntry | undefined;
}

const phasesByTarget = new Map<Element, Set<RegisteredPhases>>();
let sharedResizeObserver: ResizeObserver | null = null;
let batchSettles: Set<() => void> | null = null;

function collectDispatches(
  entries: readonly ResizeObserverEntry[],
): PhaseDispatch[] {
  const dispatched = new Set<RegisteredPhases>();
  const dispatches: PhaseDispatch[] = [];
  const add = (
    registration: RegisteredPhases,
    entry: ResizeObserverEntry | undefined,
  ) => {
    if (dispatched.has(registration)) return;
    dispatched.add(registration);
    dispatches.push({ registration, entry });
  };
  if (entries.length === 0) {
    for (const registrations of phasesByTarget.values()) {
      for (const registration of registrations) add(registration, undefined);
    }
    return dispatches;
  }
  for (const entry of entries) {
    for (const registration of phasesByTarget.get(entry.target) ?? []) {
      add(registration, entry);
    }
  }
  return dispatches;
}

function dispatchPhased(dispatches: readonly PhaseDispatch[]): void {
  const writes = dispatches.map(({ registration, entry }) =>
    registration.read(entry),
  );
  const settles = new Set<() => void>();
  batchSettles = settles;
  try {
    flushSync(() => {
      for (const write of writes) {
        write();
      }
    });
  } finally {
    batchSettles = null;
  }
  for (const settle of settles) {
    settle();
  }
}

export function settleAfterSharedResizeWrites(settle: () => void): void {
  if (batchSettles === null) {
    settle();
    return;
  }
  batchSettles.add(settle);
}

function getSharedResizeObserver(): ResizeObserver {
  sharedResizeObserver ??= new ResizeObserver((entries) => {
    dispatchPhased(collectDispatches(entries));
  });
  return sharedResizeObserver;
}

function release(target: Element, registration: RegisteredPhases): void {
  const registrations = phasesByTarget.get(target);
  registrations?.delete(registration);
  if (registrations?.size !== 0) return;
  phasesByTarget.delete(target);
  sharedResizeObserver?.unobserve?.(target);
  if (phasesByTarget.size === 0) {
    sharedResizeObserver?.disconnect?.();
    sharedResizeObserver = null;
  }
}

export function observeSharedResize<T>(
  target: Element | readonly Element[],
  phases: SharedResizePhases<T>,
): () => void {
  if (typeof ResizeObserver === "undefined") return () => {};
  const targets = [...new Set(Array.isArray(target) ? target : [target])];
  const registration: RegisteredPhases = {
    read: (entry) => {
      const value = phases.read(entry);
      return () => phases.write(value);
    },
  };
  for (const element of targets) {
    let registrations = phasesByTarget.get(element);
    if (registrations === undefined) {
      registrations = new Set();
      phasesByTarget.set(element, registrations);
      getSharedResizeObserver().observe(element);
    }
    registrations.add(registration);
  }

  return () => {
    for (const element of targets) release(element, registration);
  };
}

export function observedBorderBoxBlockSize(
  entry: ResizeObserverEntry,
): number | undefined {
  return entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect?.height;
}
