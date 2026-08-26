import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@bb/shared-ui/lib/utils";

/**
 * A small right-click menu.
 *
 * Hand-rolled rather than vendored from the BB registry: the registry's
 * context menu pulls in an icon module and with it the whole hugeicons map,
 * which is a lot of bundle for three copy actions. That trade would flip the
 * moment this menu needs submenus, checkboxes, or typeahead — at which point
 * `npx shadcn add @bb/context-menu` is the right move rather than growing
 * this file.
 *
 * Portals to the body so the panel's `overflow-y-auto` cannot clip it, the
 * same reason Monaco's hovers need their own host node.
 */

export interface ContextMenuItem {
  label: string;
  onSelect: () => void;
}

export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

const VIEWPORT_MARGIN_PX = 8;

/**
 * Chrome copied from BB's timeline selection menu (the "Reply in side chat"
 * popover) so the two read as the same surface. Container and item classes
 * are its `SELECTION_MENU_CONTENT_CLASS` and `SELECTION_ACTION_BUTTON_CLASS`,
 * minus the radix `data-[state]` variants — this menu is not radix, so it
 * animates in unconditionally on mount.
 */
const MENU_CLASS =
  "fixed z-50 w-auto rounded-md border bg-popover p-0.5 text-popover-foreground shadow-md outline-none animate-in fade-in-0 zoom-in-95";
const ITEM_CLASS =
  "flex w-full cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-left text-xs text-foreground transition-colors select-none hover:bg-surface-recessed focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none max-md:pointer-coarse:min-h-7 max-md:pointer-coarse:px-2 max-md:pointer-coarse:py-1";

export function ContextMenu({
  state,
  onClose,
}: {
  state: ContextMenuState | null;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  // Measure before paint, so a menu opened near an edge never renders
  // off-screen for a frame first.
  useLayoutEffect(() => {
    if (state === null) return;
    // Width is measured rather than fixed: the menu sizes to its labels, like
    // the selection menu it mirrors.
    const menu = menuRef.current;
    const width = menu?.offsetWidth ?? 0;
    const height = menu?.offsetHeight ?? 0;
    setPosition({
      x: Math.max(
        VIEWPORT_MARGIN_PX,
        Math.min(state.x, window.innerWidth - width - VIEWPORT_MARGIN_PX),
      ),
      y: Math.max(
        VIEWPORT_MARGIN_PX,
        Math.min(state.y, window.innerHeight - height - VIEWPORT_MARGIN_PX),
      ),
    });
  }, [state]);

  useEffect(() => {
    if (state === null) return;
    menuRef.current?.querySelector("button")?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      const menu = menuRef.current;
      if (menu === null) return;
      const buttons = Array.from(menu.querySelectorAll("button"));
      if (buttons.length === 0) return;
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const next = (index + delta + buttons.length) % buttons.length;
      buttons[next]?.focus();
    };
    // `true` so a scroll anywhere — including inside the tree — dismisses
    // rather than leaving the menu floating over unrelated rows.
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [state, onClose]);

  if (state === null) return null;

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      style={{ left: position.x, top: position.y }}
      className={MENU_CLASS}
    >
      {state.items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          onClick={() => {
            item.onSelect();
            onClose();
          }}
          className={cn(ITEM_CLASS, "whitespace-nowrap")}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
