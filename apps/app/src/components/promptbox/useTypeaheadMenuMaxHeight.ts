import { useLayoutEffect, type RefObject } from "react";

const TYPEAHEAD_MENU_MAX_HEIGHT_PROPERTY = "--promptbox-typeahead-max-height";
const APP_CONTENT_SHELL_SELECTOR = "[data-app-content-shell]";

const TYPEAHEAD_MENU_EDGE_GAP_PX = 8;

function clipsOverflow(element: Element): boolean {
  const style = getComputedStyle(element);
  return style.overflowX !== "visible" || style.overflowY !== "visible";
}

function findClippingAncestorTop({
  anchor,
  shell,
  menuBottom,
}: {
  anchor: Element;
  shell: Element | null;
  menuBottom: number;
}): number | null {
  let element: Element | null = anchor;
  while (element !== null && element !== shell) {
    if (clipsOverflow(element)) {
      const top = element.getBoundingClientRect().top;
      if (top < menuBottom) return top;
    }
    element = element.parentElement;
  }
  return null;
}

function measureMaxHeight(menu: HTMLElement): string | null {
  const anchor = menu.offsetParent;
  if (anchor === null) return null;
  const shell = menu.closest(APP_CONTENT_SHELL_SELECTOR);
  const menuBottom = menu.getBoundingClientRect().bottom;
  const limits: string[] = [];
  const clipTop = findClippingAncestorTop({ anchor, shell, menuBottom });
  if (clipTop !== null) {
    limits.push(`${menuBottom - clipTop - TYPEAHEAD_MENU_EDGE_GAP_PX}px`);
  }
  if (shell !== null) {
    const shellContentTop =
      shell.getBoundingClientRect().top +
      Number.parseFloat(getComputedStyle(shell).paddingTop);
    limits.push(
      `calc(${menuBottom - shellContentTop - TYPEAHEAD_MENU_EDGE_GAP_PX}px - var(--bb-app-chrome-row-height))`,
    );
  }
  return limits.length === 0 ? null : `max(0px, min(${limits.join(", ")}))`;
}

export function useTypeaheadMenuMaxHeight(
  menuRef: RefObject<HTMLElement | null>,
  enabled: boolean,
): void {
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!enabled || menu === null) return;
    const update = () => {
      const maxHeight = measureMaxHeight(menu);
      if (maxHeight === null) {
        menu.style.removeProperty(TYPEAHEAD_MENU_MAX_HEIGHT_PROPERTY);
      } else {
        menu.style.setProperty(TYPEAHEAD_MENU_MAX_HEIGHT_PROPERTY, maxHeight);
      }
    };
    update();
    const container = menu.parentElement;
    const shell = menu.closest(APP_CONTENT_SHELL_SELECTOR);
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    if (container !== null) resizeObserver?.observe(container);
    if (shell !== null) resizeObserver?.observe(shell);
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
      menu.style.removeProperty(TYPEAHEAD_MENU_MAX_HEIGHT_PROPERTY);
    };
  }, [enabled, menuRef]);
}
