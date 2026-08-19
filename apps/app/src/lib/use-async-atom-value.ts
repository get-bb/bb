import { type Atom, useAtomValue } from "jotai";
import { loadable } from "jotai/utils";

type LoadableState<T> =
  | { state: "loading" }
  | { state: "hasError"; error: unknown }
  | { state: "hasData"; data: T };

// `loadable()` derives a brand-new atom on every call, so the wrapper atoms must
// be created once and reused across renders — keyed here by their source atom.
const loadableAtomCache = new WeakMap<Atom<unknown>, Atom<unknown>>();

function loadableAtomFor<T>(
  sourceAtom: Atom<T | Promise<T>>,
): Atom<LoadableState<T>> {
  const cached = loadableAtomCache.get(sourceAtom);
  if (cached) {
    // The cache maps each source atom to its own loadable wrapper; that
    // per-key type relationship isn't expressible through a WeakMap.
    return cached as Atom<LoadableState<T>>;
  }
  const created = loadable(sourceAtom);
  loadableAtomCache.set(sourceAtom, created);
  return created;
}

/**
 * Read an async atom without suspending. Returns `fallback` while the atom's
 * promise is pending or has rejected, and the resolved value once available.
 *
 * Use this instead of a bare `useAtomValue(asyncAtom)` so a slow or failed
 * fetch (e.g. a host-daemon probe) never blanks the route via the app-level
 * Suspense boundary, whose fallback is `null`.
 */
export function useAsyncAtomValue<T>(
  asyncAtom: Atom<T | Promise<T>>,
  fallback: T,
): T {
  return useAsyncAtomState(asyncAtom, fallback).data;
}

export interface AsyncAtomState<T> {
  data: T;
  error: unknown | null;
  isLoading: boolean;
}

/** Non-suspending async-atom state for consumers that must await discovery. */
export function useAsyncAtomState<T>(
  asyncAtom: Atom<T | Promise<T>>,
  fallback: T,
): AsyncAtomState<T> {
  const result = useAtomValue(loadableAtomFor(asyncAtom));
  if (result.state === "hasData") {
    return { data: result.data, error: null, isLoading: false };
  }
  if (result.state === "hasError") {
    return { data: fallback, error: result.error, isLoading: false };
  }
  return { data: fallback, error: null, isLoading: true };
}
