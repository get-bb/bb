export interface SharedResizePhases<T> {
  read: (entry: ResizeObserverEntry | undefined) => T;
  write: (value: T) => void;
  coalesce?: (previous: T, latest: T) => T;
}

export interface SharedResizeSubscription {
  discardPending: () => void;
  disconnect: () => void;
}

interface RegisteredPhases {
  active: boolean;
  version: number;
  read: (entry: ResizeObserverEntry | undefined, version: number) => void;
}

interface PhaseDispatch {
  registration: RegisteredPhases;
  entry: ResizeObserverEntry | undefined;
  version: number;
}

const phasesByTarget = new Map<Element, Set<RegisteredPhases>>();
let sharedResizeObserver: ResizeObserver | null = null;
let pendingWrites = new Map<RegisteredPhases, () => void>();
let writeFrame: number | null = null;

function collectDispatches(
  entries: readonly ResizeObserverEntry[],
): PhaseDispatch[] {
  const dispatches: PhaseDispatch[] = [];
  const select = (
    registration: RegisteredPhases,
    entry: ResizeObserverEntry | undefined,
  ) => {
    dispatches.push({ registration, entry, version: ++registration.version });
  };
  if (entries.length === 0) {
    for (const registrations of phasesByTarget.values()) {
      for (const registration of registrations) select(registration, undefined);
    }
  } else {
    for (const entry of entries) {
      for (const registration of phasesByTarget.get(entry.target) ?? []) {
        select(registration, entry);
      }
    }
  }
  return dispatches;
}

function isCurrent(registration: RegisteredPhases, version: number): boolean {
  return registration.active && registration.version === version;
}

function scheduleWrites(): void {
  if (writeFrame !== null) return;
  writeFrame = requestAnimationFrame(() => {
    writeFrame = null;
    const writes = pendingWrites;
    pendingWrites = new Map();
    for (const write of writes.values()) write();
  });
}

function getSharedResizeObserver(): ResizeObserver {
  if (sharedResizeObserver === null) {
    const observer = new ResizeObserver((entries) => {
      if (sharedResizeObserver !== observer) return;
      for (const { registration, entry, version } of collectDispatches(
        entries,
      )) {
        if (isCurrent(registration, version)) registration.read(entry, version);
      }
    });
    sharedResizeObserver = observer;
  }
  return sharedResizeObserver;
}

export function observeSharedResize<T>(
  target: Element,
  phases: SharedResizePhases<T>,
): SharedResizeSubscription {
  let pending: { value: T } | null = null;
  const registration: RegisteredPhases = {
    active: true,
    version: 0,
    read: (entry, version) => {
      const latest = phases.read(entry);
      if (!isCurrent(registration, version)) return;
      const value =
        pending !== null && phases.coalesce
          ? phases.coalesce(pending.value, latest)
          : latest;
      pending = { value };
      pendingWrites.set(registration, () => {
        if (!isCurrent(registration, version)) return;
        pending = null;
        phases.write(value);
      });
      scheduleWrites();
    },
  };
  let registrations = phasesByTarget.get(target);
  const isFirstForTarget = registrations === undefined;
  if (registrations === undefined) {
    registrations = new Set();
    phasesByTarget.set(target, registrations);
  }
  registrations.add(registration);
  if (isFirstForTarget) getSharedResizeObserver().observe(target);

  const discardPending = () => {
    registration.version += 1;
    pending = null;
    pendingWrites.delete(registration);
    if (pendingWrites.size === 0 && writeFrame !== null) {
      cancelAnimationFrame(writeFrame);
      writeFrame = null;
    }
  };
  return {
    discardPending,
    disconnect: () => {
      if (!registration.active) return;
      registration.active = false;
      discardPending();
      const currentRegistrations = phasesByTarget.get(target);
      currentRegistrations?.delete(registration);
      if (currentRegistrations?.size === 0) {
        phasesByTarget.delete(target);
        sharedResizeObserver?.unobserve(target);
        if (phasesByTarget.size === 0) {
          sharedResizeObserver?.disconnect();
          sharedResizeObserver = null;
        }
      }
    },
  };
}

export function observedBorderBoxBlockSize(
  entry: ResizeObserverEntry,
): number | undefined {
  return entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect?.height;
}
