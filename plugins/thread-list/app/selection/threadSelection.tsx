import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { SIDEBAR_CONTENT_SELECTOR } from "../ui/sidebar.js";
import { SIDEBAR_WINDOWED_NAV_ATTRIBUTE } from "../list/sidebarThreadShortcuts.js";

const NO_THREAD_IDS: readonly string[] = [];

const THREAD_ROW_TARGET_SELECTOR = "a[data-sidebar-thread-id]";

export interface ThreadSelectionModifiers {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}

export class ThreadSelectionStore {
  private selected: readonly string[] = NO_THREAD_IDS;
  private selectedSet: ReadonlySet<string> = new Set();
  private anchor: string | null = null;
  private activeThreadId: string | null = null;
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSelected = (): readonly string[] => this.selected;

  getSelectedSet(): ReadonlySet<string> {
    return this.selectedSet;
  }

  isSelected(threadId: string): boolean {
    return this.selectedSet.has(threadId);
  }

  setActiveThreadId(threadId: string | null): void {
    this.activeThreadId = threadId;
  }

  clear(): void {
    this.anchor = null;
    this.replace(NO_THREAD_IDS);
  }

  select(threadIds: readonly string[], anchor: string | null): void {
    this.anchor = anchor;
    this.replace(threadIds.length === 0 ? NO_THREAD_IDS : threadIds);
  }

  handleClick(
    threadId: string,
    modifiers: ThreadSelectionModifiers,
    origin: Element,
  ): boolean {
    const toggle = modifiers.metaKey || modifiers.ctrlKey;
    if (!toggle && !modifiers.shiftKey) {
      this.anchor = threadId;
      if (this.selected.length > 0) this.replace(NO_THREAD_IDS);
      return false;
    }
    const order = collectVisibleThreadIds(origin);
    if (modifiers.shiftKey) {
      const anchor = this.anchor ?? this.activeThreadId ?? threadId;
      const from = order.indexOf(anchor);
      const to = order.indexOf(threadId);
      if (from === -1 || to === -1) {
        this.select([threadId], threadId);
        return true;
      }
      const range = order.slice(Math.min(from, to), Math.max(from, to) + 1);
      const next = toggle
        ? sortByOrder(new Set([...this.selected, ...range]), order)
        : range;
      this.anchor = anchor;
      this.replace(next);
      return true;
    }
    const base = new Set(this.selected);
    if (
      base.size === 0 &&
      this.activeThreadId !== null &&
      order.includes(this.activeThreadId)
    ) {
      base.add(this.activeThreadId);
    }
    if (base.has(threadId)) base.delete(threadId);
    else base.add(threadId);
    this.anchor = threadId;
    this.replace(sortByOrder(base, order));
    return true;
  }

  private replace(next: readonly string[]): void {
    if (
      next.length === this.selected.length &&
      next.every((threadId, index) => this.selected[index] === threadId)
    ) {
      return;
    }
    this.selected = next;
    this.selectedSet = new Set(next);
    for (const listener of this.listeners) listener();
  }
}

function sortByOrder(
  threadIds: ReadonlySet<string>,
  order: readonly string[],
): readonly string[] {
  const rank = new Map(order.map((threadId, index) => [threadId, index]));
  return [...threadIds].sort(
    (left, right) =>
      (rank.get(left) ?? Number.MAX_SAFE_INTEGER) -
      (rank.get(right) ?? Number.MAX_SAFE_INTEGER),
  );
}

export function collectVisibleThreadIds(origin: Element): string[] {
  const root = origin.closest(SIDEBAR_CONTENT_SELECTOR) ?? origin.ownerDocument;
  const elements = root.querySelectorAll<HTMLElement>(
    `${THREAD_ROW_TARGET_SELECTOR}, [${SIDEBAR_WINDOWED_NAV_ATTRIBUTE}]`,
  );
  const seen = new Set<string>();
  const order: string[] = [];
  const push = (threadId: string) => {
    if (seen.has(threadId)) return;
    seen.add(threadId);
    order.push(threadId);
  };
  for (const element of elements) {
    if (element.closest("[data-sidebar-overflow='true']")) continue;
    if (
      typeof element.checkVisibility === "function" &&
      !element.checkVisibility({ visibilityProperty: true })
    ) {
      continue;
    }
    if (element instanceof HTMLAnchorElement) {
      const threadId = element.dataset.sidebarThreadId;
      if (threadId) push(threadId);
      continue;
    }
    const encoded = element.getAttribute(SIDEBAR_WINDOWED_NAV_ATTRIBUTE) ?? "";
    for (const pair of encoded.split(" ")) {
      const separator = pair.indexOf(":");
      if (separator > 0) push(pair.slice(0, separator));
    }
  }
  return order;
}

const ThreadSelectionContext = createContext(new ThreadSelectionStore());

export function ThreadSelectionProvider({
  activeThreadId,
  children,
}: {
  activeThreadId: string | null;
  children: ReactNode;
}) {
  const [store] = useState(() => new ThreadSelectionStore());
  useLayoutEffect(() => {
    store.setActiveThreadId(activeThreadId);
  }, [activeThreadId, store]);
  const hasSelection = useSyncExternalStore(
    store.subscribe,
    () => store.getSelected().length > 0,
  );
  useEffect(() => {
    if (!hasSelection) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !event.isTrusted || event.defaultPrevented)
        return;
      store.clear();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hasSelection, store]);
  return (
    <ThreadSelectionContext.Provider value={store}>
      {children}
    </ThreadSelectionContext.Provider>
  );
}

export function useThreadSelectionStore(): ThreadSelectionStore {
  return useContext(ThreadSelectionContext);
}

export function useIsThreadSelected(threadId: string): boolean {
  const store = useThreadSelectionStore();
  return useSyncExternalStore(store.subscribe, () =>
    store.isSelected(threadId),
  );
}

export function useSelectedThreadIds(): readonly string[] {
  const store = useThreadSelectionStore();
  return useSyncExternalStore(store.subscribe, store.getSelected);
}

export function useIsSelectionHidingActiveRow(isActive: boolean): boolean {
  const store = useThreadSelectionStore();
  return useSyncExternalStore(
    store.subscribe,
    () => isActive && store.getSelected().length > 0,
  );
}

export function useMultiSelectionContaining(
  threadId: string,
): readonly string[] | null {
  const store = useThreadSelectionStore();
  return useSyncExternalStore(store.subscribe, () => {
    const selected = store.getSelected();
    return selected.length > 1 && store.isSelected(threadId) ? selected : null;
  });
}
