import { splitLayoutAtom } from "./atoms";
import { findPane, isNewThreadComposerPane, listPanes } from "./ops";
import type { SplitLayout } from "./types";

export interface SplitLayoutStore {
  get(atom: typeof splitLayoutAtom): SplitLayout | null;
  set(atom: typeof splitLayoutAtom, value: SplitLayout): void;
}

interface NewThreadPaneGuard {
  isCreating: (paneId: string) => boolean;
  setCreating: (paneId: string, creating: boolean) => void;
  discard: (
    paneIds: string[],
    accept: () => boolean,
    cancel: () => void,
  ) => void;
}

const guards = new WeakMap<SplitLayoutStore, NewThreadPaneGuard>();

export function registerNewThreadPaneGuard(
  store: SplitLayoutStore,
  guard: NewThreadPaneGuard,
) {
  guards.set(store, guard);
  return () => {
    if (guards.get(store) === guard) guards.delete(store);
  };
}

export function isComposerPaneCreating(
  store: SplitLayoutStore,
  paneId: string,
): boolean {
  return guards.get(store)?.isCreating(paneId) ?? false;
}

export function setComposerPaneCreating(
  store: SplitLayoutStore,
  paneId: string,
  creating: boolean,
): void {
  guards.get(store)?.setCreating(paneId, creating);
}

export function requestSplitLayoutChange(
  store: SplitLayoutStore,
  next: SplitLayout,
  accepted: () => void,
  cancelled: () => void = () => {},
): void {
  const current = store.get(splitLayoutAtom);
  const removed =
    current === null
      ? []
      : listPanes(current.root).filter((pane) => {
          if (!isNewThreadComposerPane(pane)) return false;
          const survivor = findPane(next.root, pane.paneId);
          return survivor === null || !isNewThreadComposerPane(survivor);
        });
  const guard = guards.get(store);
  if (removed.some((pane) => guard?.isCreating(pane.paneId))) {
    cancelled();
    return;
  }
  const commit = () => {
    if (store.get(splitLayoutAtom) !== current) {
      cancelled();
      return false;
    }
    store.set(splitLayoutAtom, next);
    accepted();
    return true;
  };
  if (guard !== undefined && removed.length > 0) {
    guard.discard(
      removed.map((pane) => pane.paneId),
      commit,
      cancelled,
    );
  } else {
    commit();
  }
}
