export type ScrollRowOffsetSource = (rowId: string) => number | null;

export type ScrollHoldEdge = "top" | "bottom";

type KeptAnchor =
  | {
      kind: "row";
      rowId: string;
      element: HTMLElement;
      offset: number;
      topLevel: boolean;
    }
  | {
      kind: "element";
      element: HTMLElement;
      edge: ScrollHoldEdge;
      offset: number;
    };

interface ScrollPositionKeeperOptions {
  getScrollElement: () => HTMLElement | null;
  getTopLevelRows: (scrollElement: HTMLElement) => ArrayLike<HTMLElement>;
  isActive: () => boolean;
}

const ROW_ID_ATTRIBUTE = "data-timeline-row-id";
const ROW_SELECTOR = `[${ROW_ID_ATTRIBUTE}]`;
const DIRECT_ROW_SELECTOR = [
  `:scope > ${ROW_SELECTOR}`,
  `:scope > [data-timeline-items] > ${ROW_SELECTOR}`,
].join(", ");
const MIN_CORRECTION_PX = 0.5;

export function getDirectTimelineRows(
  list: Element,
): NodeListOf<HTMLElement> {
  return list.querySelectorAll<HTMLElement>(DIRECT_ROW_SELECTOR);
}

function previousRowSibling(row: HTMLElement): HTMLElement | null {
  let sibling = row.previousElementSibling;
  while (sibling !== null) {
    if (sibling instanceof HTMLElement && sibling.hasAttribute(ROW_ID_ATTRIBUTE)) {
      return sibling;
    }
    sibling = sibling.previousElementSibling;
  }
  return null;
}

export class ScrollPositionKeeper {
  private readonly options: ScrollPositionKeeperOptions;
  private anchor: KeptAnchor | null = null;
  private holdUntil = 0;
  private readonly rowOffsetSources = new Set<ScrollRowOffsetSource>();
  private readonly writeListeners = new Set<() => void>();
  private overflowAnchorDisabled = false;

  constructor(options: ScrollPositionKeeperOptions) {
    this.options = options;
  }

  isActive(): boolean {
    return this.options.isActive();
  }

  registerRowOffsetSource(source: ScrollRowOffsetSource): () => void {
    this.rowOffsetSources.add(source);
    return () => {
      this.rowOffsetSources.delete(source);
    };
  }

  subscribeScrollWrites(listener: () => void): () => void {
    this.writeListeners.add(listener);
    return () => {
      this.writeListeners.delete(listener);
    };
  }

  handleScroll(): void {
    this.reconcile();
    this.capture();
  }

  hold(element: HTMLElement, edge: ScrollHoldEdge, durationMs: number): void {
    const scrollElement = this.options.getScrollElement();
    if (scrollElement === null || !this.options.isActive()) return;
    this.holdUntil = window.performance.now() + durationMs;
    this.anchor = {
      kind: "element",
      element,
      edge,
      offset: this.elementEdgeOffset(scrollElement, element, edge),
    };
    this.setOverflowAnchorDisabled(scrollElement, true);
  }

  releaseHold(): void {
    if (this.holdUntil === 0) return;
    this.holdUntil = 0;
    this.capture();
  }

  capture(): void {
    const scrollElement = this.options.getScrollElement();
    if (scrollElement === null) return;
    if (!this.options.isActive()) {
      this.anchor = null;
      this.holdUntil = 0;
      this.setOverflowAnchorDisabled(scrollElement, false);
      return;
    }
    const anchor = this.anchor;
    if (
      anchor?.kind === "element" &&
      window.performance.now() < this.holdUntil &&
      anchor.element.isConnected
    ) {
      anchor.offset = this.elementEdgeOffset(
        scrollElement,
        anchor.element,
        anchor.edge,
      );
      return;
    }
    this.holdUntil = 0;
    if (anchor?.kind !== "row" || !this.isStillFirstRow(scrollElement, anchor)) {
      this.anchor = this.findRowAnchor(scrollElement);
    }
    this.setOverflowAnchorDisabled(scrollElement, this.anchor !== null);
  }

  reconcile(): void {
    const anchor = this.anchor;
    if (anchor === null) return;
    const scrollElement = this.options.getScrollElement();
    if (scrollElement === null || !this.options.isActive()) {
      this.capture();
      return;
    }
    const current = this.locate(scrollElement, anchor);
    if (current === null) {
      this.capture();
      return;
    }
    const delta = current - anchor.offset;
    if (Math.abs(delta) < MIN_CORRECTION_PX) return;
    anchor.offset = current;
    scrollElement.scrollTop += delta;
    for (const listener of this.writeListeners) listener();
  }

  private locate(
    scrollElement: HTMLElement,
    anchor: KeptAnchor,
  ): number | null {
    if (anchor.kind === "element") {
      return anchor.element.isConnected
        ? this.elementEdgeOffset(scrollElement, anchor.element, anchor.edge)
        : null;
    }
    if (
      !anchor.element.isConnected ||
      anchor.element.getAttribute(ROW_ID_ATTRIBUTE) !== anchor.rowId ||
      !scrollElement.contains(anchor.element)
    ) {
      const element = this.findMountedRow(scrollElement, anchor.rowId);
      if (element !== null) anchor.element = element;
    }
    if (anchor.element.isConnected) {
      return this.elementEdgeOffset(scrollElement, anchor.element, "top");
    }
    for (const source of this.rowOffsetSources) {
      const offset = source(anchor.rowId);
      if (offset !== null) return offset;
    }
    return null;
  }

  private isStillFirstRow(
    scrollElement: HTMLElement,
    anchor: Extract<KeptAnchor, { kind: "row" }>,
  ): boolean {
    const element = anchor.element;
    if (!anchor.topLevel || !element.isConnected) return false;
    if (!scrollElement.contains(element)) return false;
    const viewport = scrollElement.getBoundingClientRect();
    const top = element.getBoundingClientRect().top;
    if (top < viewport.top || top >= viewport.bottom) return false;
    const previous = previousRowSibling(element);
    if (previous === null) return true;
    const previousRect = previous.getBoundingClientRect();
    if (previousRect.bottom <= viewport.top) return true;
    return (
      previousRect.top < viewport.top &&
      previous.querySelector(ROW_SELECTOR) === null
    );
  }

  private findMountedRow(
    scrollElement: HTMLElement,
    rowId: string,
  ): HTMLElement | null {
    for (const row of scrollElement.querySelectorAll<HTMLElement>(
      ROW_SELECTOR,
    )) {
      if (row.getAttribute(ROW_ID_ATTRIBUTE) === rowId) return row;
    }
    return null;
  }

  private findRowAnchor(scrollElement: HTMLElement): KeptAnchor | null {
    const scrollRect = scrollElement.getBoundingClientRect();
    const viewportTop = scrollRect.top;
    const viewportBottom = scrollRect.bottom;
    const rows = this.options.getTopLevelRows(scrollElement);
    let low = 0;
    let high = rows.length - 1;
    let straddling = -1;
    while (low <= high) {
      const index = low + Math.floor((high - low) / 2);
      const row = rows[index];
      if (row === undefined) break;
      if (row.getBoundingClientRect().bottom <= viewportTop) {
        low = index + 1;
      } else {
        straddling = index;
        high = index - 1;
      }
    }
    if (straddling < 0) return null;
    const first = rows[straddling];
    if (first === undefined) return null;
    const firstTop = first.getBoundingClientRect().top;
    let chosen: HTMLElement = first;
    let topLevel = true;
    if (firstTop < viewportTop) {
      const nested = this.firstRowStartingInViewport(
        first.querySelectorAll<HTMLElement>(ROW_SELECTOR),
        viewportTop,
        viewportBottom,
      );
      const next = rows[straddling + 1];
      if (nested !== null) {
        chosen = nested;
        topLevel = false;
      } else if (
        next !== undefined &&
        next.getBoundingClientRect().top < viewportBottom
      ) {
        chosen = next;
      }
    }
    const rowId = chosen.getAttribute(ROW_ID_ATTRIBUTE);
    if (rowId === null) return null;
    return {
      kind: "row",
      rowId,
      element: chosen,
      offset: this.elementEdgeOffset(scrollElement, chosen, "top"),
      topLevel,
    };
  }

  private firstRowStartingInViewport(
    rows: NodeListOf<HTMLElement>,
    viewportTop: number,
    viewportBottom: number,
  ): HTMLElement | null {
    for (const row of rows) {
      const top = row.getBoundingClientRect().top;
      if (top >= viewportBottom) return null;
      if (top >= viewportTop) return row;
    }
    return null;
  }

  private elementEdgeOffset(
    scrollElement: HTMLElement,
    element: HTMLElement,
    edge: ScrollHoldEdge,
  ): number {
    const rect = element.getBoundingClientRect();
    return (
      (edge === "top" ? rect.top : rect.bottom) -
      scrollElement.getBoundingClientRect().top +
      scrollElement.scrollTop
    );
  }

  private setOverflowAnchorDisabled(
    scrollElement: HTMLElement,
    disabled: boolean,
  ): void {
    if (this.overflowAnchorDisabled === disabled) return;
    this.overflowAnchorDisabled = disabled;
    scrollElement.style.overflowAnchor = disabled ? "none" : "";
  }
}
