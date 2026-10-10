import { type Atom, atom, useAtomValue } from "jotai";
import { unwrap } from "jotai/utils";

type SettledState<T> =
  | { state: "hasError"; error: unknown }
  | { state: "hasData"; data: T };

type AsyncAtomSnapshot<T> = SettledState<T> | { state: "loading" };

const snapshotAtomCache = new WeakMap<Atom<unknown>, Atom<unknown>>();

function hasData<T>(data: T): SettledState<T> {
  return { state: "hasData", data };
}

function hasError<T>(error: unknown): SettledState<T> {
  return { state: "hasError", error };
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function"
  );
}

function snapshotAtomFor<T>(
  sourceAtom: Atom<T | Promise<T>>,
): Atom<AsyncAtomSnapshot<T>> {
  const cached = snapshotAtomCache.get(sourceAtom);
  if (cached) {
    return cached as Atom<AsyncAtomSnapshot<T>>;
  }
  const settledAtom = atom(
    (get): SettledState<T> | Promise<SettledState<T>> => {
      try {
        const value = get(sourceAtom);
        return isPromiseLike(value)
          ? value.then(hasData<T>, hasError<T>)
          : hasData(value);
      } catch (error) {
        return hasError<T>(error);
      }
    },
  );
  const created = unwrap(
    settledAtom,
    (previous): AsyncAtomSnapshot<T> => previous ?? { state: "loading" },
  );
  snapshotAtomCache.set(sourceAtom, created);
  return created;
}

export function useAsyncAtomValue<T>(
  asyncAtom: Atom<T | Promise<T>>,
  fallback: T,
): T {
  return useAsyncAtomState(asyncAtom, fallback).data;
}

interface AsyncAtomState<T> {
  data: T;
  error: unknown | null;
  isLoading: boolean;
}

export function useAsyncAtomState<T>(
  asyncAtom: Atom<T | Promise<T>>,
  fallback: T,
): AsyncAtomState<T> {
  const result = useAtomValue(snapshotAtomFor(asyncAtom));
  if (result.state === "hasData") {
    return { data: result.data, error: null, isLoading: false };
  }
  if (result.state === "hasError") {
    return { data: fallback, error: result.error, isLoading: false };
  }
  return { data: fallback, error: null, isLoading: true };
}
