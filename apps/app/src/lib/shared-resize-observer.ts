/**
 * One module-level ResizeObserver shared by every registered element, with
 * each delivery dispatched in two phases: every registration's `read` runs
 * before any registration's `write`.
 *
 * Per-component observers whose callbacks interleave a layout read with a
 * style write defeat the browser's batching: when one event resizes N
 * observed elements at once (viewport resize, iOS keyboard, font swap), each
 * callback's read forces layout against the previous callback's write — N
 * synchronous layout passes over the document. Phasing the shared batch
 * bounds that at one forced layout no matter how many elements resized.
 *
 * Same registry shape as `conversation-message-overflow.tsx`'s shared
 * overflow observer; this module generalizes it to arbitrary read/write
 * pairs and is the sanctioned pattern for per-row measurement.
 */

export interface SharedResizePhases<T> {
  /**
   * Gather everything `write` needs, preferring the entry's already-measured
   * boxes over live layout reads. Runs with `undefined` when the dispatch
   * carries no entry for the target (a broadcast re-sync) — read live layout
   * (`offsetHeight`) then. Must not write styles.
   */
  read: (entry: ResizeObserverEntry | undefined) => T;
  /** Apply the value `read` produced. Must not read layout. */
  write: (value: T) => void;
}

/**
 * Type-erased registration: `read` closes over its typed value by returning
 * the matching `write` as a thunk, so the registry needs no generics.
 */
interface RegisteredPhases {
  read: (entry: ResizeObserverEntry | undefined) => () => void;
}

interface PhaseDispatch {
  registration: RegisteredPhases;
  entry: ResizeObserverEntry | undefined;
}

const phasesByTarget = new Map<Element, Set<RegisteredPhases>>();
let sharedResizeObserver: ResizeObserver | null = null;

function collectDispatches(
  entries: readonly ResizeObserverEntry[],
): PhaseDispatch[] {
  if (entries.length === 0) {
    // The platform always delivers at least one entry. An empty batch only
    // comes from synthetic dispatch (test stubs, polyfills) and carries no
    // target information, so conservatively re-sync every registration from
    // live layout.
    return [...phasesByTarget.values()].flatMap((registrations) =>
      [...registrations].map((registration) => ({
        registration,
        entry: undefined,
      })),
    );
  }
  const dispatches: PhaseDispatch[] = [];
  for (const entry of entries) {
    for (const registration of phasesByTarget.get(entry.target) ?? []) {
      dispatches.push({ registration, entry });
    }
  }
  return dispatches;
}

function dispatchPhased(dispatches: readonly PhaseDispatch[]): void {
  // Complete every read before any write can dirty layout for the next one.
  const writes = dispatches.map(({ registration, entry }) =>
    registration.read(entry),
  );
  for (const write of writes) {
    write();
  }
}

function getSharedResizeObserver(): ResizeObserver {
  sharedResizeObserver ??= new ResizeObserver((entries) => {
    dispatchPhased(collectDispatches(entries));
  });
  return sharedResizeObserver;
}

/**
 * Observe `target` on the shared observer. Returns the unregister function;
 * the last unregistration for a target unobserves it, and the last overall
 * releases the observer entirely (so per-test `ResizeObserver` stubs take
 * effect on the next registration).
 */
export function observeSharedResize<T>(
  target: Element,
  phases: SharedResizePhases<T>,
): () => void {
  const registration: RegisteredPhases = {
    read: (entry) => {
      const value = phases.read(entry);
      return () => phases.write(value);
    },
  };
  let registrations = phasesByTarget.get(target);
  const isFirstForTarget = registrations === undefined;
  if (registrations === undefined) {
    registrations = new Set();
    phasesByTarget.set(target, registrations);
  }
  registrations.add(registration);
  if (isFirstForTarget) {
    // Register before observing: the initial observation can deliver
    // synchronously in some environments and must reach this registration.
    getSharedResizeObserver().observe(target);
  }

  return () => {
    const currentRegistrations = phasesByTarget.get(target);
    currentRegistrations?.delete(registration);
    if (currentRegistrations?.size === 0) {
      phasesByTarget.delete(target);
      sharedResizeObserver?.unobserve?.(target);
      if (phasesByTarget.size === 0) {
        sharedResizeObserver?.disconnect?.();
        sharedResizeObserver = null;
      }
    }
  };
}

/**
 * Border-box block size carried by an entry — `offsetHeight`'s metric without
 * the layout read (the observer already measured this frame). The two must
 * agree wherever an observer path and a direct path size the same element, or
 * a padded box would get clipped by a content-box height. Returns `undefined`
 * when the entry carries no usable box: entries cross a platform boundary and
 * synthetic ones (test doubles, polyfills) omit boxes the spec guarantees —
 * fall back to a live layout read then.
 */
export function observedBorderBoxBlockSize(
  entry: ResizeObserverEntry,
): number | undefined {
  return entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect?.height;
}
