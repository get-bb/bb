import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { experimental_useExperiment } from "@get-bb/plugin-sdk/app";
import { useSidebarData } from "../model/use-sidebar-data.js";
import { SIDEBAR_CONTENT_SELECTOR } from "../ui/sidebar.js";
import { SIDEBAR_WINDOWED_NAV_ATTRIBUTE } from "../list/sidebarThreadShortcuts.js";

const NO_THREAD_IDS: readonly string[] = [];

const THREAD_ROW_TARGET_SELECTOR = "a[data-sidebar-thread-id]";

const SELECTION_KEEPING_SELECTOR =
  '[data-sidebar-rename-row], [data-radix-popper-content-wrapper], [role="menu"]';

export const SIDEBAR_MULTI_SELECT_EXPERIMENT = "sidebarMultiSelect";

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
  private enabled = true;
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSelected = (): readonly string[] => this.selected;

  isSelected(threadId: string): boolean {
    return this.selectedSet.has(threadId);
  }

  setActiveThreadId(threadId: string | null): void {
    this.activeThreadId = threadId;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.clear();
  }

  clear(): void {
    this.anchor = null;
    this.replace(NO_THREAD_IDS);
  }

  remove(threadIds: ReadonlySet<string>): void {
    if (this.anchor !== null && threadIds.has(this.anchor)) this.anchor = null;
    this.replace(this.selected.filter((threadId) => !threadIds.has(threadId)));
  }

  restoreActiveThreadFocus(): void {
    const focused = document.activeElement;
    const active = [
      ...document.querySelectorAll<HTMLAnchorElement>(
        THREAD_ROW_TARGET_SELECTOR,
      ),
    ].find(
      (element) => element.dataset.sidebarThreadId === this.activeThreadId,
    );
    if (active) active.focus({ preventScroll: true });
    else if (
      focused instanceof HTMLElement &&
      focused.matches(THREAD_ROW_TARGET_SELECTOR)
    )
      focused.blur();
  }

  handleClick(
    threadId: string,
    modifiers: ThreadSelectionModifiers,
    origin: Element,
  ): boolean {
    if (!this.enabled) return false;
    if (!modifiers.shiftKey) {
      this.anchor = threadId;
      if (this.selected.length > 0) this.replace(NO_THREAD_IDS);
      return false;
    }
    const order = collectVisibleThreadIds(origin);
    if (!modifiers.metaKey && !modifiers.ctrlKey) {
      const anchor = this.anchor ?? this.activeThreadId ?? threadId;
      const from = order.indexOf(anchor);
      const to = order.indexOf(threadId);
      if (from === -1 || to === -1) {
        this.anchor = threadId;
        this.replace([threadId]);
        return true;
      }
      this.anchor = anchor;
      this.replace(order.slice(Math.min(from, to), Math.max(from, to) + 1));
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
  const overflow = origin.closest("[data-sidebar-overflow='true']");
  const root =
    overflow ??
    origin.closest(SIDEBAR_CONTENT_SELECTOR) ??
    origin.ownerDocument;
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
    if (element.closest("[data-sidebar-overflow='true']") !== overflow)
      continue;
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
  const enabled = experimental_useExperiment(SIDEBAR_MULTI_SELECT_EXPERIMENT);
  useLayoutEffect(() => {
    store.setActiveThreadId(activeThreadId);
  }, [activeThreadId, store]);
  useLayoutEffect(() => {
    store.setEnabled(enabled);
  }, [enabled, store]);
  const { projects } = useSidebarData();
  const listedThreadIds = useMemo(
    () =>
      new Set(
        projects.flatMap((project) =>
          project.threads.map((thread) => thread.id),
        ),
      ),
    [projects],
  );
  const previousListedThreadIds = useRef(listedThreadIds);
  useLayoutEffect(() => {
    const previous = previousListedThreadIds.current;
    previousListedThreadIds.current = listedThreadIds;
    const removed = new Set(
      [...previous].filter((threadId) => !listedThreadIds.has(threadId)),
    );
    if (removed.size > 0) store.remove(removed);
  }, [listedThreadIds, store]);
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
      store.restoreActiveThreadFocus();
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest(SELECTION_KEEPING_SELECTOR) !== null
      ) {
        return;
      }
      store.clear();
    };
    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
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
