import {
  useCallback,
  useRef,
  useState,
  type KeyboardEventHandler,
  type RefObject,
} from "react";
import {
  haveSameSidebarThreadSearchNavigationItems,
  isThreadSearchKeyboardEventTarget,
  type SidebarThreadSearchNavigationItem,
} from "./sidebarThreadSearch";

interface UseSidebarThreadSearchOptions {
  /**
   * Coarse pointers pop the on-screen keyboard on focus, which hides the
   * results, so search opens there without stealing focus.
   */
  isPointerCoarse: boolean;
  /** Reveals the sidebar, so the search field is on screen when search opens. */
  onOpenSidebar: () => void;
  /** Opens the thread behind a selected result. */
  onOpenThread: (item: SidebarThreadSearchNavigationItem) => void;
  /** Runs after any sidebar thread opens; closes the mobile sidebar drawer. */
  onThreadOpened: () => void;
}

export interface SidebarThreadSearchController {
  activeDescendantId: string | undefined;
  activeIndex: number;
  inputRef: RefObject<HTMLInputElement | null>;
  isActive: boolean;
  onActivate: () => void;
  onActiveIndexChange: (index: number) => void;
  /** Clears the query and returns the sidebar to its pre-search state. */
  onClose: () => void;
  /**
   * Ends search after a thread opens outside the result list, such as from a
   * plugin thread list that filters by the host query.
   */
  onExternalThreadOpen: () => void;
  onKeyDown: KeyboardEventHandler<HTMLDivElement>;
  onNavigationItemsChange: (
    items: readonly SidebarThreadSearchNavigationItem[],
  ) => void;
  onQueryChange: (query: string) => void;
  onSelectItem: (item: SidebarThreadSearchNavigationItem) => void;
  query: string;
}

/**
 * Owns the sidebar thread-search state: the query, the result list, and the
 * keyboard cursor over it. Selecting a result resets all of it, so the sidebar
 * shows the normal thread list again after the thread opens.
 */
export function useSidebarThreadSearch({
  isPointerCoarse,
  onOpenSidebar,
  onOpenThread,
  onThreadOpened,
}: UseSidebarThreadSearchOptions): SidebarThreadSearchController {
  const [isActive, setIsActive] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [navigationItems, setNavigationItems] = useState<
    readonly SidebarThreadSearchNavigationItem[]
  >([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const activeDescendantId = navigationItems[activeIndex]?.optionId;

  const focusInput = useCallback(() => {
    if (isPointerCoarse) return;

    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, [isPointerCoarse]);

  const handleActivate = useCallback(() => {
    setIsActive(true);
    onOpenSidebar();
    focusInput();
  }, [focusInput, onOpenSidebar]);

  const handleClose = useCallback(() => {
    setIsActive(false);
    setQuery("");
    setActiveIndex(0);
    setNavigationItems([]);
  }, []);

  const handleNavigationItemsChange = useCallback(
    (items: readonly SidebarThreadSearchNavigationItem[]) => {
      setNavigationItems((current) =>
        haveSameSidebarThreadSearchNavigationItems(current, items)
          ? current
          : items,
      );
      setActiveIndex((current) => {
        if (items.length === 0) {
          return 0;
        }
        return Math.min(current, items.length - 1);
      });
    },
    [],
  );

  // Search is a transient mode over the thread list. Once a thread opens, the
  // query has done its work, so drop it and show the list again. Every sidebar
  // thread selection ends here: a result row, and a plugin list that filters by
  // the host query.
  const handleThreadOpened = useCallback(() => {
    onThreadOpened();
    handleClose();
  }, [handleClose, onThreadOpened]);

  const handleSelectItem = useCallback(
    (item: SidebarThreadSearchNavigationItem) => {
      onOpenThread(item);
      handleThreadOpened();
    },
    [handleThreadOpened, onOpenThread],
  );

  const handleKeyDown = useCallback<KeyboardEventHandler<HTMLDivElement>>(
    (event) => {
      if (!isActive || event.defaultPrevented) {
        return;
      }
      if (!isThreadSearchKeyboardEventTarget(event.target, inputRef.current)) {
        return;
      }

      if (event.key === "ArrowDown") {
        if (navigationItems.length === 0) {
          return;
        }
        event.preventDefault();
        setActiveIndex((current) =>
          current >= navigationItems.length - 1 ? 0 : current + 1,
        );
        return;
      }

      if (event.key === "ArrowUp") {
        if (navigationItems.length === 0) {
          return;
        }
        event.preventDefault();
        setActiveIndex((current) =>
          current <= 0 ? navigationItems.length - 1 : current - 1,
        );
        return;
      }

      if (event.key === "Enter") {
        const item = navigationItems[activeIndex];
        if (!item) {
          return;
        }
        event.preventDefault();
        handleSelectItem(item);
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        if (query.length > 0) {
          setQuery("");
          focusInput();
          return;
        }
        handleClose();
      }
    },
    [
      activeIndex,
      focusInput,
      handleClose,
      handleSelectItem,
      isActive,
      navigationItems,
      query.length,
    ],
  );

  return {
    activeDescendantId,
    activeIndex,
    inputRef,
    isActive,
    onActivate: handleActivate,
    onActiveIndexChange: setActiveIndex,
    onClose: handleClose,
    onExternalThreadOpen: handleThreadOpened,
    onKeyDown: handleKeyDown,
    onNavigationItemsChange: handleNavigationItemsChange,
    onQueryChange: setQuery,
    onSelectItem: handleSelectItem,
    query,
  };
}
