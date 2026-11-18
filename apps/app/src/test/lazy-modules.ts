import { setImmediate as realSetImmediate } from "node:timers";

interface HeldImport {
  specifier: string;
  release: () => void;
}

interface LazyImportState {
  holding: boolean;
  held: HeldImport[];
  inFlight: Map<Promise<void>, string>;
  unsettled: string[];
}

const SETTLING_WRAPPER = Symbol.for("bb.settleLazyModulesBeforeWaiting");

declare global {
  var __bbLazyImportState: LazyImportState | undefined;
  var __bbTrackLazyImport: <T>(
    load: Promise<T>,
    specifier: string,
  ) => Promise<T>;
}

function lazyImportState(): LazyImportState {
  globalThis.__bbLazyImportState ??= {
    holding: false,
    held: [],
    inFlight: new Map(),
    unsettled: [],
  };
  return globalThis.__bbLazyImportState;
}

function trackLazyImport<T>(load: Promise<T>, specifier: string): Promise<T> {
  const state = lazyImportState();
  let loaded = load;
  if (state.holding) {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    state.held.push({ specifier, release });
    loaded = gate.then(() => load);
  }
  const settled = loaded.then(
    () => undefined,
    () => undefined,
  );
  state.inFlight.set(settled, specifier);
  void settled.then(() => state.inFlight.delete(settled));
  return loaded;
}

function releaseHeldImports(state: LazyImportState): void {
  for (const held of state.held.splice(0)) held.release();
}

function nextMacrotask(): Promise<void> {
  return new Promise((resolve) => realSetImmediate(resolve));
}

async function reactAct(run: () => Promise<void>): Promise<void> {
  const { act } = await import("@testing-library/react");
  await act(run);
}

async function settleTrackedImports(state: LazyImportState): Promise<void> {
  do {
    await reactAct(async () => {
      await Promise.all([...state.inFlight.keys()]);
      await nextMacrotask();
    });
  } while (state.inFlight.size > 0);
}

async function whileImportsFlow<T>(run: () => Promise<T>): Promise<T> {
  const state = lazyImportState();
  const holding = state.holding;
  state.holding = false;
  releaseHeldImports(state);
  try {
    return await run();
  } finally {
    state.holding = holding;
  }
}

export async function settleLazyModules(): Promise<void>;
export async function settleLazyModules<T>(operation: Promise<T>): Promise<T>;
export async function settleLazyModules<T>(
  operation?: Promise<T>,
): Promise<T | undefined> {
  return whileImportsFlow(async () => {
    let result: T | undefined;
    if (operation !== undefined) {
      await reactAct(async () => {
        result = await operation;
      });
    }
    await settleTrackedImports(lazyImportState());
    return result;
  });
}

export function installLazyImportTracking(): void {
  globalThis.__bbTrackLazyImport = trackLazyImport;
}

export async function settleLazyModulesBeforeWaiting(): Promise<void> {
  const { configure, getConfig } = await import("@testing-library/react");
  const { asyncWrapper } = getConfig();
  if (Reflect.get(asyncWrapper, SETTLING_WRAPPER) === true) return;
  const settlingWrapper = async <T>(callback: () => Promise<T>) => {
    await settleLazyModules();
    const result = await whileImportsFlow(() => asyncWrapper(callback));
    await settleLazyModules();
    return result;
  };
  Reflect.set(settlingWrapper, SETTLING_WRAPPER, true);
  configure({ asyncWrapper: settlingWrapper });
}

export function holdLazyImports(): void {
  const state = lazyImportState();
  state.unsettled = [];
  state.inFlight.clear();
  state.holding = true;
}

function describeUnsettled(state: LazyImportState): string[] {
  const held = new Set(state.held.map((entry) => entry.specifier));
  return [
    ...[...held].map((specifier) => `${specifier} (held)`),
    ...[...new Set(state.inFlight.values())]
      .filter((specifier) => !held.has(specifier))
      .map((specifier) => `${specifier} (loading)`),
  ];
}

export function releaseLazyImports(): void {
  const state = lazyImportState();
  state.holding = false;
  state.unsettled = describeUnsettled(state);
  releaseHeldImports(state);
}

export function unsettledLazyImports(): readonly string[] {
  const state = lazyImportState();
  return state.holding ? describeUnsettled(state) : state.unsettled;
}
