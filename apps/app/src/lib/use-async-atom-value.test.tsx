// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { type Atom, Provider, atom, createStore } from "jotai";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { useAsyncAtomState } from "./use-async-atom-value";

afterEach(() => {
  cleanup();
});

interface PendingRequest {
  promise: Promise<string[]>;
  reject: (error: Error) => void;
  resolve: (value: string[]) => void;
}

interface SourceAtomProps {
  sourceAtom: Atom<string[] | Promise<string[]>>;
}

function createPendingRequest(): PendingRequest {
  let resolve: PendingRequest["resolve"] = () => {};
  let reject: PendingRequest["reject"] = () => {};
  const promise = new Promise<string[]>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createRefreshableAtom() {
  const pending: PendingRequest[] = [];
  const refreshTickAtom = atom(0);
  const targetsAtom = atom((get) => {
    get(refreshTickAtom);
    const request = createPendingRequest();
    pending.push(request);
    return request.promise;
  });
  const store = createStore();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  const settle = async (
    settleRequest: (request: PendingRequest) => void,
    index = pending.length - 1,
  ) => {
    await act(async () => {
      const request = pending[index];
      if (!request) throw new Error(`No request ${index}`);
      settleRequest(request);
      await request.promise.catch(() => undefined);
    });
  };
  const refresh = () => {
    act(() => {
      store.set(refreshTickAtom, (tick) => tick + 1);
    });
  };
  return { refresh, settle, targetsAtom, wrapper };
}

describe("useAsyncAtomState", () => {
  it("keeps the last value while the atom revalidates", async () => {
    const { refresh, settle, targetsAtom, wrapper } = createRefreshableAtom();
    const { result } = renderHook(() => useAsyncAtomState(targetsAtom, []), {
      wrapper,
    });
    expect(result.current).toEqual({ data: [], error: null, isLoading: true });

    await settle((request) => request.resolve(["finder", "vscode"]));
    await waitFor(() => {
      expect(result.current.data).toEqual(["finder", "vscode"]);
    });

    refresh();
    expect(result.current).toEqual({
      data: ["finder", "vscode"],
      error: null,
      isLoading: false,
    });

    await settle((request) => request.resolve(["finder"]));
    await waitFor(() => {
      expect(result.current.data).toEqual(["finder"]);
    });

    refresh();
    await settle((request) => request.resolve([]));
    await waitFor(() => {
      expect(result.current.data).toEqual([]);
    });
  });

  it("ignores a superseded revalidation that settles late", async () => {
    const { refresh, settle, targetsAtom, wrapper } = createRefreshableAtom();
    const { result } = renderHook(() => useAsyncAtomState(targetsAtom, []), {
      wrapper,
    });
    await settle((request) => request.resolve(["finder"]), 0);
    refresh();
    refresh();

    await settle((request) => request.resolve(["vscode"]), 2);
    await waitFor(() => {
      expect(result.current.data).toEqual(["vscode"]);
    });
    await settle((request) => request.resolve(["cursor"]), 1);

    expect(result.current).toEqual({
      data: ["vscode"],
      error: null,
      isLoading: false,
    });
  });

  it("reports a failed revalidation instead of the stale value", async () => {
    const { refresh, settle, targetsAtom, wrapper } = createRefreshableAtom();
    const { result } = renderHook(() => useAsyncAtomState(targetsAtom, []), {
      wrapper,
    });
    await settle((request) => request.resolve(["finder"]));
    await waitFor(() => {
      expect(result.current.data).toEqual(["finder"]);
    });

    refresh();
    const failure = new Error("daemon unavailable");
    await settle((request) => request.reject(failure));

    await waitFor(() => {
      expect(result.current).toEqual({
        data: [],
        error: failure,
        isLoading: false,
      });
    });

    refresh();
    expect(result.current.data).toEqual([]);
    await settle((request) => request.resolve(["finder"]));
    await waitFor(() => {
      expect(result.current).toEqual({
        data: ["finder"],
        error: null,
        isLoading: false,
      });
    });
  });

  it("does not carry a value across source atoms", async () => {
    const { settle, targetsAtom, wrapper } = createRefreshableAtom();
    const disabledAtom = atom<string[]>([]);
    const unresolvedAtom = atom(() => new Promise<string[]>(() => {}));
    const initialProps: SourceAtomProps = { sourceAtom: targetsAtom };
    const { result, rerender } = renderHook(
      ({ sourceAtom }: SourceAtomProps) =>
        useAsyncAtomState(sourceAtom, ["fallback"]),
      { initialProps, wrapper },
    );
    await settle((request) => request.resolve(["finder"]));
    await waitFor(() => {
      expect(result.current.data).toEqual(["finder"]);
    });

    rerender({ sourceAtom: disabledAtom });
    expect(result.current).toEqual({ data: [], error: null, isLoading: false });

    rerender({ sourceAtom: unresolvedAtom });
    expect(result.current).toEqual({
      data: ["fallback"],
      error: null,
      isLoading: true,
    });
  });
});
