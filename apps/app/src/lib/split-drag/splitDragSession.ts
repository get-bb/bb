import { pickZone, zoneBox, type SplitZone, type ZoneDecision } from "./zones";

/** Marks a pane's root element so the drag layer can hit-test it. */
export const SPLIT_PANE_DATA_ATTR = "data-split-pane-id";

export interface SplitDropTarget {
  paneId: string;
  zone: SplitZone;
}

export interface SplitDragFallbackTarget {
  /** Pane id to attribute a drop to when no marked pane is under the pointer. */
  paneId: string;
  /**
   * Element whose rect stands in for the pane. Used by the single-pane surface,
   * which renders no wrapper element (so it stays byte-identical to the page):
   * the whole content container becomes the drop target for creating the first
   * split.
   */
  container: HTMLElement | null;
}

export interface SplitDragConfig {
  /** Text shown in the cursor-following ghost. */
  ghostLabel: string;
  /** Element dimmed while dragging (the source row or pane); restored on end. */
  sourceEl?: HTMLElement | null;
  /**
   * Resolves the hovered pane + raw zone into a highlighted target, or null
   * when the pane is not a valid target (the overlay hides). The layout ops
   * still enforce legality on drop; this only picks and labels the region.
   */
  decide: (paneId: string, zone: SplitZone) => ZoneDecision | null;
  /** Runs on release when a valid target is under the pointer. */
  onDrop: (target: SplitDropTarget) => void;
  /**
   * Gate that flips the drag from "pending" to "engaged". Until it returns
   * true nothing is shown and no default is prevented, so an in-sidebar
   * reorder or a plain click still works.
   */
  shouldEngage: (clientX: number, clientY: number) => boolean;
  /** Runs once when the pending gesture becomes an owned split drag. */
  onEngage?: () => void;
  /**
   * Runs after teardown on every engaged exit path. `dropped` is true only
   * when a valid target was handed to {@link onDrop}.
   */
  onEnd?: (result: { dropped: boolean }) => void;
  /**
   * Hit-test fallback for when no {@link SPLIT_PANE_DATA_ATTR} element is under
   * the pointer (the wrapper-less single-pane surface).
   */
  fallback?: SplitDragFallbackTarget;
  /**
   * When true, engaging the drag cancels any in-flight dnd-kit reorder so a
   * sidebar tear-out can't both split and reorder the same row (Finding 1).
   * The two gestures become mutually exclusive: a tear-out that crosses the
   * sidebar edge owns the gesture; a drag that never engages leaves reorder
   * untouched.
   */
  cancelSidebarReorderOnEngage?: boolean;
}

interface ResolvedTarget {
  paneId: string;
  rect: DOMRect;
}

/**
 * Shared pointer-driven drag session for the split area, used by sidebar thread
 * rows and pane headers alike. It intentionally does NOT nest a second dnd-kit
 * context (plan §3): it renders a cursor ghost + a drop-zone overlay directly,
 * hit-tests panes by their {@link SPLIT_PANE_DATA_ATTR}, and calls back with the
 * chosen target. Colors come from theme tokens (never hardcoded), per AGENTS.md.
 */
export function beginSplitDrag(config: SplitDragConfig): void {
  let engaged = false;
  let target: SplitDropTarget | null = null;
  let ghostEl: HTMLElement | null = null;
  let overlayEl: HTMLElement | null = null;

  // Sidebar rows carry a native-draggable `<a>` overlay; without this a
  // mousedown+move starts a native anchor drag that swallows the pointermove
  // stream the session depends on. Suppress it for the whole gesture.
  const preventNativeDrag = (event: DragEvent): void => {
    event.preventDefault();
  };
  window.addEventListener("dragstart", preventNativeDrag);

  const engage = (): void => {
    engaged = true;
    if (config.cancelSidebarReorderOnEngage) {
      // dnd-kit's pointer sensors cancel on an Escape keydown; dispatching one
      // hands exclusive ownership of the gesture to the split drag.
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          code: "Escape",
          bubbles: true,
        }),
      );
    }
    ghostEl = createGhost(config.ghostLabel);
    overlayEl = createOverlay();
    document.body.append(ghostEl, overlayEl);
    document.body.style.cursor = "grabbing";
    if (config.sourceEl) {
      config.sourceEl.style.opacity = "0.45";
    }
    config.onEngage?.();
  };

  const resolveTarget = (
    clientX: number,
    clientY: number,
  ): ResolvedTarget | null => {
    const paneEl = paneElementAt(clientX, clientY);
    const paneId = paneEl?.getAttribute(SPLIT_PANE_DATA_ATTR) ?? null;
    if (paneEl && paneId !== null) {
      return { paneId, rect: paneEl.getBoundingClientRect() };
    }
    const fallback = config.fallback;
    if (fallback && fallback.container) {
      const rect = fallback.container.getBoundingClientRect();
      if (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      ) {
        return { paneId: fallback.paneId, rect };
      }
    }
    return null;
  };

  const handleMove = (event: PointerEvent): void => {
    if (!engaged) {
      if (!config.shouldEngage(event.clientX, event.clientY)) {
        return;
      }
      engage();
    }
    // Only suppress the default (text selection / native drag) once we own the
    // gesture, so pending in-sidebar interactions stay untouched.
    event.preventDefault();
    if (ghostEl) {
      ghostEl.style.left = `${event.clientX + 12}px`;
      ghostEl.style.top = `${event.clientY + 8}px`;
    }

    target = null;
    const resolved = resolveTarget(event.clientX, event.clientY);
    if (resolved && overlayEl) {
      const zone = pickZone(resolved.rect, event.clientX, event.clientY);
      const decision = config.decide(resolved.paneId, zone);
      if (decision) {
        target = { paneId: resolved.paneId, zone: decision.zone };
        positionOverlay(
          overlayEl,
          zoneBox(resolved.rect, decision.zone),
          decision.label,
        );
      } else {
        overlayEl.style.display = "none";
      }
    } else if (overlayEl) {
      overlayEl.style.display = "none";
    }
  };

  const teardown = (): void => {
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", handleUp);
    window.removeEventListener("pointercancel", handleCancel);
    window.removeEventListener("dragstart", preventNativeDrag);
    ghostEl?.remove();
    overlayEl?.remove();
    document.body.style.cursor = "";
    if (config.sourceEl) {
      config.sourceEl.style.opacity = "";
    }
  };

  function handleUp(): void {
    const wasEngaged = engaged;
    const dropTarget = engaged ? target : null;
    teardown();
    if (wasEngaged) {
      // Swallow the click the browser synthesizes after a drag release so a
      // dragged-out sidebar row's NavLink (or a header's focus click) doesn't
      // fire on top of the drop.
      swallowNextClick();
    }
    if (dropTarget) {
      config.onDrop(dropTarget);
    }
    if (wasEngaged) {
      config.onEnd?.({ dropped: dropTarget !== null });
    }
  }

  function handleCancel(): void {
    const wasEngaged = engaged;
    teardown();
    if (wasEngaged) {
      swallowNextClick();
      config.onEnd?.({ dropped: false });
    }
  }

  window.addEventListener("pointermove", handleMove);
  window.addEventListener("pointerup", handleUp);
  window.addEventListener("pointercancel", handleCancel);
}

function swallowNextClick(): void {
  const swallow = (event: MouseEvent): void => {
    event.stopPropagation();
    event.preventDefault();
    window.removeEventListener("click", swallow, true);
  };
  window.addEventListener("click", swallow, true);
  // If no click follows (some pointer paths don't synthesize one), drop the
  // listener shortly so it can't swallow a later, unrelated click.
  window.setTimeout(
    () => window.removeEventListener("click", swallow, true),
    300,
  );
}

function paneElementAt(clientX: number, clientY: number): HTMLElement | null {
  for (const element of document.elementsFromPoint(clientX, clientY)) {
    const pane =
      element instanceof HTMLElement
        ? element.closest<HTMLElement>(`[${SPLIT_PANE_DATA_ATTR}]`)
        : null;
    if (pane) {
      return pane;
    }
  }
  return null;
}

function createGhost(label: string): HTMLElement {
  const ghost = document.createElement("div");
  ghost.textContent = label;
  Object.assign(ghost.style, {
    position: "fixed",
    zIndex: "100",
    pointerEvents: "none",
    left: "-9999px",
    top: "-9999px",
    maxWidth: "260px",
    padding: "6px 12px",
    borderRadius: "10px",
    fontSize: "12.5px",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    background: "var(--popover)",
    color: "var(--popover-foreground)",
    border: "1px solid var(--border)",
    boxShadow: "0 6px 20px color-mix(in oklab, var(--ink) 22%, transparent)",
  } satisfies Partial<CSSStyleDeclaration>);
  return ghost;
}

function createOverlay(): HTMLElement {
  const overlay = document.createElement("div");
  const label = document.createElement("div");
  Object.assign(label.style, {
    position: "absolute",
    inset: "0",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "12px",
    fontWeight: "600",
    color: "var(--primary)",
  } satisfies Partial<CSSStyleDeclaration>);
  label.dataset.splitDragLabel = "";
  overlay.append(label);
  Object.assign(overlay.style, {
    position: "fixed",
    zIndex: "90",
    display: "none",
    pointerEvents: "none",
    borderRadius: "12px",
    background: "color-mix(in oklab, var(--primary) 12%, transparent)",
    border: "2px solid color-mix(in oklab, var(--primary) 55%, transparent)",
    transition:
      "left 0.09s ease-out, top 0.09s ease-out, width 0.09s ease-out, height 0.09s ease-out",
  } satisfies Partial<CSSStyleDeclaration>);
  return overlay;
}

function positionOverlay(
  overlay: HTMLElement,
  box: { left: number; top: number; width: number; height: number },
  label: string,
): void {
  overlay.style.display = "block";
  overlay.style.left = `${box.left}px`;
  overlay.style.top = `${box.top}px`;
  overlay.style.width = `${box.width}px`;
  overlay.style.height = `${box.height}px`;
  const labelEl = overlay.querySelector<HTMLElement>("[data-split-drag-label]");
  if (labelEl) {
    labelEl.textContent = label;
  }
}
