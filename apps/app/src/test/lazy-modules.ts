import { setImmediate as realSetImmediate } from "node:timers";
import type * as React from "react";
import type { ComponentType } from "react";
import { afterEach, beforeEach } from "vitest";

interface HeldImport {
  specifier: string;
  release: () => void;
}

interface LazyImportState {
  holding: boolean;
  held: HeldImport[];
  inFlight: Map<Promise<void>, string>;
  unsettled: string[];
  started: number;
  generation: number;
  collecting: boolean;
  prepared: Set<unknown>;
  renderGates: Map<unknown, React.ElementType>;
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
    started: 0,
    generation: 0,
    collecting: true,
    prepared: new Set(),
    renderGates: new Map(),
  };
  return globalThis.__bbLazyImportState;
}

function trackLazyImport<T>(load: Promise<T>, specifier: string): Promise<T> {
  const state = lazyImportState();
  state.started += 1;
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

function lazyModuleGeneration(): number {
  return lazyImportState().generation;
}

function gatedLazyComponent<P extends object>(
  key: unknown,
  specifier: string,
  loadedGeneration: number,
  View: ComponentType<P>,
  lazy: typeof React.lazy,
): React.ElementType<P> {
  const state = lazyImportState();
  const existing = state.renderGates.get(key);
  if (existing !== undefined) return existing as React.ElementType<P>;
  const chosen: React.ElementType<P> =
    state.holding &&
    loadedGeneration < state.generation &&
    !state.prepared.has(key)
      ? (() => {
          const gate = trackLazyImport(Promise.resolve(), specifier);
          return lazy(() => gate.then(() => ({ default: View })));
        })()
      : View;
  state.renderGates.set(key, chosen as React.ElementType);
  return chosen;
}

function beginLazyModuleTestFile(): void {
  const state = lazyImportState();
  state.collecting = true;
  state.prepared.clear();
}

export function prepareLazyModuleForFile(key: string): void {
  const state = lazyImportState();
  if (state.collecting) state.prepared.add(key);
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
  let started: number;
  do {
    started = state.started;
    await reactAct(async () => {
      await Promise.all([...state.inFlight.keys()]);
      await nextMacrotask();
    });
    await nextMacrotask();
  } while (state.inFlight.size > 0 || state.started !== started);
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

function installLazyImportTracking(): void {
  globalThis.__bbTrackLazyImport = trackLazyImport;
}

async function settleLazyModulesBeforeWaiting(): Promise<void> {
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

function holdLazyImports(): void {
  const state = lazyImportState();
  state.unsettled = [];
  state.inFlight.clear();
  state.renderGates.clear();
  state.generation += 1;
  state.collecting = false;
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

function releaseLazyImports(): void {
  const state = lazyImportState();
  state.holding = false;
  state.unsettled = describeUnsettled(state);
  releaseHeldImports(state);
}

function unsettledLazyImports(): readonly string[] {
  const state = lazyImportState();
  return state.holding ? describeUnsettled(state) : state.unsettled;
}

let reactModule: typeof React | undefined;

function loadedReact(): typeof React {
  if (reactModule === undefined) {
    throw new Error(
      "gateLoadedComponent rendered before installLazyModuleHold() loaded React",
    );
  }
  return reactModule;
}

const UNSETTLED_HINT =
  "A lazy import resolves when the test awaits settleLazyModules() from @/test/lazy-modules or a Testing Library findBy/waitFor; synchronous assertions after the render or interaction that starts it see the loading state.";

export function installLazyModuleHold(): void {
  installLazyImportTracking();
  beginLazyModuleTestFile();
  beforeEach(async (context) => {
    reactModule ??= await import("react");
    await settleLazyModulesBeforeWaiting();
    holdLazyImports();
    context.onTestFailed(({ task }) => {
      const unsettled = unsettledLazyImports();
      const [error] = task.result?.errors ?? [];
      if (unsettled.length === 0 || error === undefined) return;
      error.message += `\n\nLazy imports had not settled when this test failed: ${unsettled.join(", ")}. ${UNSETTLED_HINT}`;
    });
  });
  afterEach(() => {
    releaseLazyImports();
  });
}

export function gateLoadedComponent<P extends object>(
  key: string,
  View: ComponentType<P>,
): ComponentType<P> {
  const loadedIn = lazyModuleGeneration();
  function GatedLoadedComponent(props: P) {
    const react = loadedReact();
    const Gated = gatedLazyComponent(key, key, loadedIn, View, react.lazy);
    return react.createElement(Gated, props);
  }
  return GatedLoadedComponent;
}

export function gateReactLazy<R extends typeof React>(react: R): R {
  reactModule = react;
  const lazy: typeof react.lazy = (load) => {
    let resolvedIn: number | null = null;
    const Inner: React.ElementType = react.lazy(() =>
      load().then((module) => {
        resolvedIn ??= lazyModuleGeneration();
        return module;
      }),
    );
    function LazyContent(props: object) {
      return react.createElement(Inner, props);
    }
    function GatedLazy(props: object) {
      const View =
        resolvedIn === null
          ? LazyContent
          : gatedLazyComponent(
              load,
              "React.lazy",
              resolvedIn,
              LazyContent,
              react.lazy,
            );
      return react.createElement(View, props);
    }
    return GatedLazy as never;
  };
  return { ...react, lazy, default: { ...react, lazy } };
}
