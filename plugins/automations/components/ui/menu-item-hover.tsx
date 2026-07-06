import * as React from "react";

// Keys that mean keyboard navigation has taken over the menu; the persistent
// pointer highlight yields to Radix's own data-[highlighted]/:focus highlight.
const MENU_NAV_KEYS = new Set([
  "ArrowDown",
  "ArrowUp",
  "Home",
  "End",
  "PageDown",
  "PageUp",
]);

export const MENU_ITEM_LAST_HOVERED_CLASS =
  "data-[last-hovered]:bg-state-hover data-[last-hovered]:text-foreground";

interface MenuHoverContextValue {
  lastHoveredId: string | null;
  setLastHovered: (id: string) => void;
  clearLastHovered: () => void;
}

const MenuHoverContext = React.createContext<MenuHoverContextValue>({
  lastHoveredId: null,
  setLastHovered: () => {},
  clearLastHovered: () => {},
});

/**
 * Tracks the last pointer-hovered menu item so its highlight PERSISTS after the
 * pointer drifts into the menu's padding, instead of blinking off the way a bare
 * Radix `:focus`/`data-[highlighted]` highlight does. The highlight only moves
 * when another item is hovered, and is handed back to Radix the moment keyboard
 * navigation begins. Mount one provider per open menu surface; the state resets
 * when the menu closes and the provider unmounts.
 */
export function MenuHoverProvider({ children }: { children: React.ReactNode }) {
  const [lastHoveredId, setLastHoveredId] = React.useState<string | null>(null);
  const value = React.useMemo<MenuHoverContextValue>(
    () => ({
      lastHoveredId,
      setLastHovered: setLastHoveredId,
      clearLastHovered: () => setLastHoveredId(null),
    }),
    [lastHoveredId],
  );
  return (
    <MenuHoverContext.Provider value={value}>
      {children}
    </MenuHoverContext.Provider>
  );
}

export interface MenuItemHoverProps {
  "data-last-hovered": "" | undefined;
  onPointerEnter: React.PointerEventHandler;
  onKeyDown: React.KeyboardEventHandler;
}

/** The item's own handlers, run alongside the persistent-highlight glue. */
interface MenuItemHoverHandlers {
  onPointerEnter?: React.PointerEventHandler;
  onKeyDown?: React.KeyboardEventHandler;
}

/**
 * Per-item glue for {@link MenuHoverProvider}. Pass the item's own
 * `onPointerEnter`/`onKeyDown` (if any) and spread the returned `hoverProps`
 * directly — the hook merges your handlers with the glue, so a call site stays
 * a single `{...hoverProps}` instead of hand-merging both handlers.
 *
 * It registers the item as last-hovered on pointer enter, exposes a
 * `data-last-hovered` attribute while it holds the highlight, and clears that
 * highlight on the first keyboard-navigation key so Radix's focus highlight can
 * take over. Note: the keyboard hand-off only has somewhere to go on surfaces
 * with Radix roving focus (real menu items); on plain-button lists the highlight
 * simply clears on the first arrow key. Outside a provider it is an inert no-op.
 */
export function useMenuItemHover(handlers?: MenuItemHoverHandlers): {
  isLastHovered: boolean;
  hoverProps: MenuItemHoverProps;
} {
  const id = React.useId();
  const { lastHoveredId, setLastHovered, clearLastHovered } =
    React.useContext(MenuHoverContext);
  const isLastHovered = lastHoveredId === id;

  // Hold the caller's handlers in a ref so the merged callbacks stay stable
  // even when handlers are passed inline.
  const handlersRef = React.useRef(handlers);
  handlersRef.current = handlers;

  const onPointerEnter = React.useCallback(
    (event: React.PointerEvent) => {
      handlersRef.current?.onPointerEnter?.(event);
      setLastHovered(id);
    },
    [id, setLastHovered],
  );

  const onKeyDown = React.useCallback(
    (event: React.KeyboardEvent) => {
      handlersRef.current?.onKeyDown?.(event);
      if (MENU_NAV_KEYS.has(event.key)) {
        clearLastHovered();
      }
    },
    [clearLastHovered],
  );

  return {
    isLastHovered,
    hoverProps: {
      "data-last-hovered": isLastHovered ? "" : undefined,
      onPointerEnter,
      onKeyDown,
    },
  };
}
