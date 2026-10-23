export type ScrollHoldEdge = "top" | "bottom";

export type ReadingPosition =
  | { kind: "bottom" }
  | { kind: "free" }
  | {
      kind: "anchor";
      key: string;
      element: HTMLElement | null;
      edge: ScrollHoldEdge;
      offset: number;
      neighbors: readonly AnchorNeighbor[];
    };

interface AnchorNeighbor {
  key: string;
  delta: number;
}

export interface SavedReadingPosition {
  rowId: string;
  offsetWithinRow: number;
  atBottom: boolean;
}

export interface ScrollWindowList {
  itemAt: (viewportTop: number) => { key: string; top: number } | null;
  onPositionChange: (urgent: boolean) => void;
}

interface ScrollPositionKeeperOptions {
  bottomThresholdPx: number;
  deferWritesWhileScrolling: boolean;
  getContentElement: () => HTMLElement | null;
  getFooterElement: () => HTMLElement | null;
  getScrollElement: () => HTMLElement | null;
  getTopLevelRows: (scrollElement: HTMLElement) => ArrayLike<HTMLElement>;
  initiallyAttached: boolean;
}

interface TopRow {
  key: string;
  element: HTMLElement;
}

interface PendingRestore {
  rowId: string;
  offset: number;
  expiresAt: number;
}

const ROW_ID_ATTRIBUTE = "data-timeline-row-id";
const ROW_SELECTOR = `[${ROW_ID_ATTRIBUTE}]`;
const DIRECT_ROW_SELECTOR = [
  `:scope > ${ROW_SELECTOR}`,
  `:scope > [data-timeline-items] > ${ROW_SELECTOR}`,
].join(", ");
const MIN_WRITE_PX = 0.5;
const MIN_VISIBLE_ANCHOR_PX = 48;
const MAX_ANCHOR_NEIGHBORS = 8;
const SCROLL_SETTLE_MS = 150;
const RESTORE_WAIT_MS = 1_000;
const PASSIVE_CAPTURE = { capture: true, passive: true } as const;
const ATTACH_KEYS = new Set(["End", "PageDown", " ", "ArrowDown"]);
const SCROLL_KEYS = new Set([...ATTACH_KEYS, "Home", "PageUp", "ArrowUp"]);
const WHEEL_SESSION_MS = 150;
const KEY_SESSION_MS = 500;
const PROGRAMMATIC_SMOOTH_SESSION_MS = 1_000;
const SESSION_EXTENSION_MS = 150;
const MOMENTUM_SESSION_MS = 3_000;
const TOUCH_ATTACH_DRAG_PX = 8;
const FREE: ReadingPosition = { kind: "free" };

export function getDirectTimelineRows(list: Element): NodeListOf<HTMLElement> {
  return list.querySelectorAll<HTMLElement>(DIRECT_ROW_SELECTOR);
}

function findMountedRow(
  scrollElement: HTMLElement,
  rowId: string,
): HTMLElement | null {
  for (const row of scrollElement.querySelectorAll<HTMLElement>(ROW_SELECTOR)) {
    if (row.getAttribute(ROW_ID_ATTRIBUTE) === rowId) return row;
  }
  return null;
}

function firstRowStartingInViewport(
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

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  );
}

export class ScrollPositionKeeper {
  private readonly options: ScrollPositionKeeperOptions;
  private position: ReadingPosition;
  private pendingRestore: PendingRestore | null = null;
  private ownScrollTop: number | null = null;
  private maxScrollTop = 0;
  private viewportHeight = 0;
  private reconciledWidth = 0;
  private reconciledViewportHeight = 0;
  private reconciledScrollHeight = 0;
  private topRow: TopRow | null = null;
  private deferred = 0;
  private deferredElement: HTMLElement | null = null;
  private touching = false;
  private pointerDown = false;
  private gestureScrolled = false;
  private inputUntil = Number.NEGATIVE_INFINITY;
  private touchStartScrollTop = 0;
  private touchStartY: number | null = null;
  private userScrolled = false;
  private scrollMovedAt = Number.NEGATIVE_INFINITY;
  private settleTimeout: number | null = null;
  private clampFrame: number | null = null;
  private readonly lists = new Set<ScrollWindowList>();
  private readonly listeners = new Set<() => void>();
  private readonly positionListeners = new Set<() => void>();

  constructor(options: ScrollPositionKeeperOptions) {
    this.options = options;
    this.position = options.initiallyAttached ? { kind: "bottom" } : FREE;
  }

  hasUserScrolled(): boolean {
    return this.userScrolled;
  }

  isAttached(): boolean {
    return this.position.kind === "bottom";
  }

  getPosition(): ReadingPosition {
    return this.position;
  }

  getViewportHeight(): number {
    return this.viewportHeight;
  }

  getScrollElement(): HTMLElement | null {
    return this.options.getScrollElement();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  subscribePosition(listener: () => void): () => void {
    this.positionListeners.add(listener);
    return () => {
      this.positionListeners.delete(listener);
    };
  }

  registerList(list: ScrollWindowList): () => void {
    this.lists.add(list);
    return () => {
      this.lists.delete(list);
    };
  }

  connect(scrollElement: HTMLElement): () => void {
    scrollElement.style.overflowAnchor = "none";
    this.ownScrollTop = scrollElement.scrollTop;
    const onScroll = () => this.handleScroll();
    const onTouchStart = (event: TouchEvent) => {
      if (!this.touching) {
        this.gestureScrolled = false;
        this.touchStartScrollTop = scrollElement.scrollTop;
        this.touchStartY = event.touches[0]?.clientY ?? null;
      }
      this.touching = true;
    };
    const onTouchMove = (event: TouchEvent) => {
      const startY = this.touchStartY;
      const y = event.touches[0]?.clientY;
      if (startY === null || y === undefined) return;
      if (startY - y >= TOUCH_ATTACH_DRAG_PX) this.attachIfAtEnd();
    };
    const activeTouchPointers = new Set<number>();
    const endTouch = () => {
      if (!this.touching) return;
      activeTouchPointers.clear();
      this.touching = false;
      this.touchStartY = null;
      if (Math.abs(scrollElement.scrollTop - this.touchStartScrollTop) >= 1) {
        this.gestureScrolled = true;
        this.scrollMovedAt = window.performance.now();
      }
      if (this.gestureScrolled) {
        this.extendInput(MOMENTUM_SESSION_MS);
        this.handleScroll();
      }
      this.scheduleDeferredWrite();
    };
    const onTouchEnd = (event: TouchEvent) => {
      if (event.touches.length > 0) return;
      endTouch();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === "touch") {
        activeTouchPointers.add(event.pointerId);
        return;
      }
      this.pointerDown = true;
      this.gestureScrolled = false;
    };
    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerType === "touch") {
        if (event.type !== "pointerup") return;
        activeTouchPointers.delete(event.pointerId);
        if (activeTouchPointers.size === 0) endTouch();
        return;
      }
      if (!this.pointerDown) return;
      this.pointerDown = false;
      if (this.gestureScrolled) this.extendInput(SESSION_EXTENSION_MS);
    };
    const onWheel = (event: WheelEvent) => {
      this.extendInput(WHEEL_SESSION_MS);
      if (event.deltaY > 0) this.attachIfAtEnd();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!SCROLL_KEYS.has(event.key) || isEditableTarget(event.target)) {
        return;
      }
      const target = event.target;
      if (
        target instanceof Node &&
        target !== document.body &&
        !scrollElement.contains(target)
      ) {
        return;
      }
      this.extendInput(KEY_SESSION_MS);
      if (ATTACH_KEYS.has(event.key)) this.attachIfAtEnd();
    };
    scrollElement.addEventListener("scroll", onScroll, { passive: true });
    scrollElement.addEventListener("wheel", onWheel, { passive: true });
    scrollElement.addEventListener("touchstart", onTouchStart, PASSIVE_CAPTURE);
    scrollElement.addEventListener("touchmove", onTouchMove, PASSIVE_CAPTURE);
    scrollElement.addEventListener("touchend", onTouchEnd, PASSIVE_CAPTURE);
    scrollElement.addEventListener("touchcancel", onTouchEnd, PASSIVE_CAPTURE);
    scrollElement.addEventListener("pointerdown", onPointerDown, {
      passive: true,
    });
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointercancel", onPointerUp, true);
    window.addEventListener("keydown", onKeyDown);
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => this.reconcile());
      observer.observe(scrollElement);
      const content = this.options.getContentElement();
      if (content !== null) {
        observer.observe(content);
        const parent = content.parentElement;
        if (parent !== null && parent !== scrollElement) {
          observer.observe(parent);
        }
      }
    }
    this.reconcile();
    return () => {
      observer?.disconnect();
      scrollElement.removeEventListener("scroll", onScroll);
      scrollElement.removeEventListener("wheel", onWheel);
      scrollElement.removeEventListener(
        "touchstart",
        onTouchStart,
        PASSIVE_CAPTURE,
      );
      scrollElement.removeEventListener(
        "touchmove",
        onTouchMove,
        PASSIVE_CAPTURE,
      );
      scrollElement.removeEventListener(
        "touchend",
        onTouchEnd,
        PASSIVE_CAPTURE,
      );
      scrollElement.removeEventListener(
        "touchcancel",
        onTouchEnd,
        PASSIVE_CAPTURE,
      );
      scrollElement.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerUp, true);
      window.removeEventListener("keydown", onKeyDown);
      this.touching = false;
      this.pointerDown = false;
      if (this.settleTimeout !== null) window.clearTimeout(this.settleTimeout);
      if (this.clampFrame !== null)
        window.cancelAnimationFrame(this.clampFrame);
      this.settleTimeout = null;
      this.clampFrame = null;
      this.setDeferred(0);
    };
  }

  scrollToBottom(): void {
    this.pendingRestore = null;
    this.inputUntil = Number.NEGATIVE_INFINITY;
    this.gestureScrolled = false;
    this.setPosition({ kind: "bottom" });
    this.reconcile();
    const scrollElement = this.options.getScrollElement();
    if (scrollElement !== null) {
      this.touchStartScrollTop = scrollElement.scrollTop;
    }
  }

  revealElement(element: HTMLElement, options: ScrollIntoViewOptions): void {
    const scrollElement = this.options.getScrollElement();
    this.pendingRestore = null;
    this.flushDeferred();
    element.scrollIntoView(options);
    if (scrollElement === null) return;
    this.ownScrollTop = scrollElement.scrollTop;
    this.refreshExtent(scrollElement);
    this.setPosition(
      this.isAtEnd(scrollElement.scrollTop)
        ? { kind: "bottom" }
        : (this.capture(scrollElement) ?? FREE),
    );
    this.notifyLists();
  }

  scrollTo(top: number, behavior: ScrollBehavior): void {
    const scrollElement = this.options.getScrollElement();
    if (scrollElement === null) return;
    this.pendingRestore = null;
    this.flushDeferred();
    if (this.position.kind === "bottom") {
      this.setPosition(this.capture(scrollElement) ?? FREE);
    }
    if (behavior === "smooth") {
      this.extendInput(PROGRAMMATIC_SMOOTH_SESSION_MS);
      scrollElement.scrollTo({ top, behavior });
      return;
    }
    this.write(scrollElement, top);
    this.refreshExtent(scrollElement);
    this.setPosition(
      this.isAtEnd(scrollElement.scrollTop)
        ? { kind: "bottom" }
        : (this.capture(scrollElement) ?? FREE),
    );
    this.notifyLists();
  }

  hold(element: HTMLElement, edge: ScrollHoldEdge): void {
    const scrollElement = this.options.getScrollElement();
    if (scrollElement === null || this.position.kind === "bottom") return;
    const key = element.getAttribute(ROW_ID_ATTRIBUTE);
    if (key === null) return;
    this.pendingRestore = null;
    this.position = {
      kind: "anchor",
      key,
      element,
      edge,
      offset: this.edgeTop(scrollElement, element, edge),
      neighbors: [],
    };
  }

  restore(saved: SavedReadingPosition): void {
    if (saved.atBottom) {
      this.scrollToBottom();
      return;
    }
    this.pendingRestore = {
      rowId: saved.rowId,
      offset: -saved.offsetWithinRow,
      expiresAt: window.performance.now() + RESTORE_WAIT_MS,
    };
    this.reconcile();
  }

  pendingRestoreRowId(): string | null {
    return this.pendingRestore?.rowId ?? null;
  }

  savedPosition(): SavedReadingPosition | null {
    if (this.pendingRestore !== null) {
      return {
        rowId: this.pendingRestore.rowId,
        offsetWithinRow: -this.pendingRestore.offset,
        atBottom: false,
      };
    }
    this.foldPendingInputScroll();
    const position = this.position;
    if (position.kind === "bottom") {
      return { rowId: "", offsetWithinRow: 0, atBottom: true };
    }
    const scrollElement = this.options.getScrollElement();
    if (scrollElement === null) return null;
    this.refreshExtent(scrollElement);
    if (this.isAtEnd(scrollElement.scrollTop)) {
      return { rowId: "", offsetWithinRow: 0, atBottom: true };
    }
    if (position.kind === "free") return null;
    const anchor = this.capture(scrollElement);
    if (anchor === null || anchor.kind !== "anchor") return null;
    const nested =
      anchor.element?.parentElement?.closest(ROW_SELECTOR) !== null;
    const viewportTop = scrollElement.getBoundingClientRect().top;
    const restorableAnchor =
      !nested &&
      anchor.element !== null &&
      anchor.element.getBoundingClientRect().top - viewportTop <=
        this.visibleHeight(scrollElement) - MIN_VISIBLE_ANCHOR_PX;
    const saved = restorableAnchor ? anchor : this.topRow;
    if (saved === null || saved.element === null) return null;
    return {
      rowId: saved.key,
      offsetWithinRow: viewportTop - saved.element.getBoundingClientRect().top,
      atBottom: false,
    };
  }

  handleScroll(): void {
    const scrollElement = this.options.getScrollElement();
    if (scrollElement === null) return;
    const scrollTop = scrollElement.scrollTop;
    const previous = this.ownScrollTop;
    if (previous !== null && Math.abs(scrollTop - previous) < MIN_WRITE_PX) {
      return;
    }
    if (!this.isInputSession()) {
      const cachedMax = this.maxScrollTop;
      if (Math.abs(this.refreshExtent(scrollElement) - cachedMax) >= 1) {
        this.ownScrollTop = scrollTop;
        this.apply(scrollElement, true);
        return;
      }
    }
    this.extendInput(SESSION_EXTENSION_MS);
    if (this.touching || this.pointerDown) this.gestureScrolled = true;
    this.ownScrollTop = scrollTop;
    this.scrollMovedAt = window.performance.now();
    this.userScrolled = true;
    this.pendingRestore = null;
    const movedDown = previous === null || scrollTop > previous;
    const position = this.position;
    if (position.kind === "anchor" && previous !== null) {
      position.offset -= scrollTop - previous;
    }
    if (position.kind === "bottom") {
      if (!movedDown && !this.isAtEnd(scrollTop)) {
        this.refreshExtent(scrollElement);
        if (!this.isAtEnd(scrollTop)) {
          this.setPosition(this.capture(scrollElement) ?? FREE);
        }
      }
    } else if (movedDown && this.isAtEnd(scrollTop)) {
      this.setPosition({ kind: "bottom" });
    } else {
      if (position.kind === "anchor") this.apply(scrollElement, false);
      const current = this.position;
      if (current.kind !== "anchor" || !this.isInView(scrollElement, current)) {
        this.setPosition(this.capture(scrollElement) ?? FREE);
      }
      this.notifyLists();
      if (this.position.kind === "anchor") this.apply(scrollElement, false);
      this.setPosition(this.capture(scrollElement) ?? FREE);
    }
    if (this.deferred !== 0) this.scheduleDeferredWrite();
    this.notifyLists();
  }

  reconcile(urgent = true): void {
    const scrollElement = this.options.getScrollElement();
    if (scrollElement === null) return;
    this.apply(scrollElement, true, urgent);
  }

  private apply(
    scrollElement: HTMLElement,
    notify: boolean,
    urgent = true,
  ): void {
    const scrollTop = scrollElement.scrollTop;
    const max = this.refreshExtent(scrollElement);
    const width = scrollElement.clientWidth;
    const widthChanged =
      this.reconciledWidth > 0 && Math.abs(this.reconciledWidth - width) >= 1;
    if (widthChanged) this.keepAnchorVisible(scrollElement);
    const resized =
      widthChanged ||
      (this.reconciledViewportHeight > 0 &&
        Math.abs(this.reconciledViewportHeight - this.viewportHeight) >= 1);
    this.reconciledWidth = width;
    this.reconciledViewportHeight = this.viewportHeight;
    const previous = this.ownScrollTop;
    if (
      previous !== null &&
      Math.abs(scrollTop - previous) >= MIN_WRITE_PX &&
      this.position.kind === "anchor" &&
      this.isInputSession()
    ) {
      this.position.offset -= scrollTop - previous;
      this.scrollMovedAt = window.performance.now();
    }
    this.ownScrollTop = scrollTop;
    const restored = this.advancePendingRestore(scrollElement);
    const scrollHeight = scrollElement.scrollHeight;
    const extentChanged = scrollHeight !== this.reconciledScrollHeight;
    this.reconciledScrollHeight = scrollHeight;
    const defer = this.shouldDefer(scrollTop, max);
    const bouncing =
      defer && !extentChanged && (scrollTop <= 0 || scrollTop >= max - 1);
    const settledAtEnd =
      this.position.kind === "bottom" &&
      !extentChanged &&
      Math.abs(max - scrollTop) <= this.options.bottomThresholdPx;
    let target =
      bouncing || settledAtEnd
        ? null
        : this.targetScrollTop(scrollElement, scrollTop, max);
    if (
      target !== null &&
      (resized || restored) &&
      this.position.kind === "anchor" &&
      target >= max - this.options.bottomThresholdPx
    ) {
      this.setPosition({ kind: "bottom" });
      target = max;
    }
    if (target !== null) {
      const clamped = defer
        ? Math.min(
            Math.max(target, Math.min(0, scrollTop)),
            Math.max(max, scrollTop),
          )
        : Math.min(Math.max(target, 0), max);
      if (defer) {
        this.setDeferred(clamped - scrollTop);
        this.scheduleDeferredWrite();
      } else {
        this.setDeferred(0);
        this.write(scrollElement, clamped);
      }
      if (Math.abs(clamped - target) >= 1 && this.position.kind === "anchor") {
        this.scheduleClampSettle();
      }
    }
    if (notify) this.notifyLists(urgent);
  }

  private isInView(
    scrollElement: HTMLElement,
    position: Extract<ReadingPosition, { kind: "anchor" }>,
  ): boolean {
    const element = position.element;
    if (element === null || !element.isConnected) return false;
    const height = element.getBoundingClientRect().height;
    const viewportHeight = this.viewportHeight || scrollElement.clientHeight;
    return position.offset > -height && position.offset < viewportHeight;
  }

  private advancePendingRestore(scrollElement: HTMLElement): boolean {
    const pending = this.pendingRestore;
    if (pending === null) return false;
    const element = findMountedRow(scrollElement, pending.rowId);
    if (element !== null) {
      this.pendingRestore = null;
      const height = element.getBoundingClientRect().height;
      this.setPosition({
        kind: "anchor",
        key: pending.rowId,
        element,
        edge: "top",
        offset: Math.min(
          Math.max(pending.offset, -Math.max(0, height - 1)),
          Math.max(
            0,
            this.visibleHeight(scrollElement) - MIN_VISIBLE_ANCHOR_PX,
          ),
        ),
        neighbors: [],
      });
      return true;
    }
    if (window.performance.now() > pending.expiresAt) {
      this.pendingRestore = null;
    }
    return false;
  }

  private targetScrollTop(
    scrollElement: HTMLElement,
    scrollTop: number,
    max: number,
  ): number | null {
    const position = this.position;
    if (position.kind === "bottom") return max;
    if (position.kind === "free") return null;
    if (position.element === null) {
      const mounted = this.capture(scrollElement);
      if (mounted?.kind === "anchor" && mounted.element !== null) {
        this.setPosition(mounted);
      }
      return null;
    }
    const edgeTop = this.locate(scrollElement, position);
    const located = this.position;
    if (edgeTop === null || located.kind !== "anchor") return null;
    return scrollTop + this.deferred + edgeTop - located.offset;
  }

  private locate(
    scrollElement: HTMLElement,
    position: Extract<ReadingPosition, { kind: "anchor" }>,
  ): number | null {
    let element = position.element;
    if (
      element === null ||
      !element.isConnected ||
      element.getAttribute(ROW_ID_ATTRIBUTE) !== position.key
    ) {
      element = findMountedRow(scrollElement, position.key);
      if (element !== null) position.element = element;
    }
    if (element === null) {
      for (const [index, neighbor] of position.neighbors.entries()) {
        const fallback = findMountedRow(scrollElement, neighbor.key);
        if (fallback === null) continue;
        this.position = {
          kind: "anchor",
          key: neighbor.key,
          element: fallback,
          edge: "top",
          offset: position.offset + neighbor.delta,
          neighbors: position.neighbors.slice(index + 1).map((next) => ({
            key: next.key,
            delta: next.delta - neighbor.delta,
          })),
        };
        return this.edgeTop(scrollElement, fallback, "top");
      }
      return null;
    }
    return this.edgeTop(scrollElement, element, position.edge);
  }

  private capture(scrollElement: HTMLElement): ReadingPosition | null {
    const viewport = scrollElement.getBoundingClientRect();
    const viewportTop = viewport.top;
    const footerTop = this.options
      .getFooterElement()
      ?.getBoundingClientRect().top;
    const viewportBottom = Math.min(
      viewportTop + (this.viewportHeight || scrollElement.clientHeight),
      footerTop ?? Number.POSITIVE_INFINITY,
    );
    const rows = this.options.getTopLevelRows(scrollElement);
    let low = 0;
    let high = rows.length - 1;
    let straddling = -1;
    while (low <= high) {
      const index = low + Math.floor((high - low) / 2);
      const row = rows[index];
      if (row === undefined) break;
      if (row.getBoundingClientRect().bottom <= viewportTop + 0.5) {
        low = index + 1;
      } else {
        straddling = index;
        high = index - 1;
      }
    }
    const first = straddling < 0 ? undefined : rows[straddling];
    const firstTop = first?.getBoundingClientRect().top;
    if (
      first === undefined ||
      firstTop === undefined ||
      firstTop >= viewportBottom
    ) {
      return this.captureFromLists(viewportTop);
    }
    const firstKey = first.getAttribute(ROW_ID_ATTRIBUTE);
    if (firstKey !== null) {
      this.topRow = { key: firstKey, element: first };
    }
    let chosen = first;
    if (firstTop < viewportTop - 0.5) {
      const next = rows[straddling + 1];
      const nested =
        next !== undefined && next.getBoundingClientRect().top < viewportBottom
          ? null
          : firstRowStartingInViewport(
              first.querySelectorAll<HTMLElement>(ROW_SELECTOR),
              viewportTop,
              viewportBottom,
            );
      if (nested !== null) {
        chosen = nested;
      } else if (
        next !== undefined &&
        next.getBoundingClientRect().top < viewportBottom
      ) {
        chosen = next;
      }
    }
    const key = chosen.getAttribute(ROW_ID_ATTRIBUTE);
    if (key === null) return null;
    const chosenTop = chosen.getBoundingClientRect().top;
    const neighbors: AnchorNeighbor[] = [];
    for (
      let index = straddling;
      index < rows.length && neighbors.length < MAX_ANCHOR_NEIGHBORS;
      index += 1
    ) {
      const row = rows[index];
      if (row === undefined || row === chosen) continue;
      const top = row.getBoundingClientRect().top;
      if (top >= viewportBottom) break;
      const rowKey = row.getAttribute(ROW_ID_ATTRIBUTE);
      if (rowKey !== null)
        neighbors.push({ key: rowKey, delta: top - chosenTop });
    }
    return {
      kind: "anchor",
      key,
      element: chosen,
      edge: "top",
      offset: chosenTop - viewportTop,
      neighbors,
    };
  }

  private captureFromLists(viewportTop: number): ReadingPosition | null {
    for (const list of this.lists) {
      const item = list.itemAt(viewportTop);
      if (item !== null) {
        return {
          kind: "anchor",
          key: item.key,
          element: null,
          edge: "top",
          offset: item.top - viewportTop,
          neighbors: [],
        };
      }
    }
    return null;
  }

  private extendInput(durationMs: number): void {
    this.inputUntil = Math.max(
      this.inputUntil,
      window.performance.now() + durationMs,
    );
  }

  private isInputSession(): boolean {
    return (
      this.touching ||
      this.pointerDown ||
      window.performance.now() <= this.inputUntil
    );
  }

  private attachIfAtEnd(): void {
    const scrollElement = this.options.getScrollElement();
    if (scrollElement === null || this.position.kind === "bottom") return;
    if (!this.isAtEnd(scrollElement.scrollTop)) return;
    this.pendingRestore = null;
    this.setPosition({ kind: "bottom" });
    this.reconcile();
  }

  private foldPendingInputScroll(): void {
    const scrollElement = this.options.getScrollElement();
    const previous = this.ownScrollTop;
    if (scrollElement === null || previous === null || !this.isInputSession()) {
      return;
    }
    const scrollTop = scrollElement.scrollTop;
    if (Math.abs(scrollTop - previous) < MIN_WRITE_PX) return;
    this.ownScrollTop = scrollTop;
    this.refreshExtent(scrollElement);
    this.setPosition(
      this.isAtEnd(scrollTop)
        ? { kind: "bottom" }
        : (this.capture(scrollElement) ?? FREE),
    );
  }

  private isAtEnd(scrollTop: number): boolean {
    return (
      this.maxScrollTop - (scrollTop + this.deferred) <=
      this.options.bottomThresholdPx
    );
  }

  private keepAnchorVisible(scrollElement: HTMLElement): void {
    if (this.position.kind !== "anchor" || this.position.edge !== "top") {
      return;
    }
    this.position.offset = Math.min(
      this.position.offset,
      Math.max(0, this.visibleHeight(scrollElement) - MIN_VISIBLE_ANCHOR_PX),
    );
  }

  private visibleHeight(scrollElement: HTMLElement): number {
    const height = this.viewportHeight || scrollElement.clientHeight;
    const footerTop = this.options
      .getFooterElement()
      ?.getBoundingClientRect().top;
    if (footerTop === undefined) return height;
    return Math.min(
      height,
      footerTop - scrollElement.getBoundingClientRect().top,
    );
  }

  private refreshExtent(scrollElement: HTMLElement): number {
    this.viewportHeight = scrollElement.clientHeight;
    this.maxScrollTop = Math.max(
      0,
      scrollElement.scrollHeight - this.viewportHeight,
    );
    return this.maxScrollTop;
  }

  private shouldDefer(scrollTop: number, max: number): boolean {
    if (!this.options.deferWritesWhileScrolling) return false;
    if (this.touching) return true;
    if (window.performance.now() - this.scrollMovedAt < SCROLL_SETTLE_MS) {
      return true;
    }
    return scrollTop < 0 || scrollTop > max;
  }

  private scheduleDeferredWrite(): void {
    if (this.deferred === 0 || this.settleTimeout !== null) return;
    this.settleTimeout = window.setTimeout(() => {
      this.settleTimeout = null;
      const scrollElement = this.options.getScrollElement();
      if (scrollElement === null || this.deferred === 0) return;
      const scrollTop = scrollElement.scrollTop;
      if (this.shouldDefer(scrollTop, this.maxScrollTop)) {
        this.scheduleDeferredWrite();
        return;
      }
      this.flushDeferred();
      this.reconcile();
    }, SCROLL_SETTLE_MS);
  }

  private flushDeferred(): void {
    const scrollElement = this.options.getScrollElement();
    const offset = this.deferred;
    if (scrollElement === null || offset === 0) return;
    const target = scrollElement.scrollTop + offset;
    this.setDeferred(0);
    this.write(scrollElement, target);
  }

  private scheduleClampSettle(): void {
    if (this.clampFrame !== null) return;
    this.clampFrame = window.requestAnimationFrame(() => {
      this.clampFrame = null;
      const scrollElement = this.options.getScrollElement();
      if (scrollElement === null || this.position.kind !== "anchor") return;
      const scrollTop = scrollElement.scrollTop;
      const max = this.refreshExtent(scrollElement);
      const target = this.targetScrollTop(scrollElement, scrollTop, max);
      if (target === null || (target >= 0 && target <= max)) {
        this.reconcile();
        return;
      }
      this.setPosition(this.capture(scrollElement) ?? FREE);
    });
  }

  private write(scrollElement: HTMLElement, target: number): void {
    if (Math.abs(scrollElement.scrollTop - target) >= MIN_WRITE_PX) {
      scrollElement.scrollTop = target;
    }
    this.ownScrollTop = scrollElement.scrollTop;
  }

  private setDeferred(offset: number): void {
    const rounded = Math.abs(offset) < MIN_WRITE_PX ? 0 : offset;
    if (rounded === this.deferred) return;
    this.deferred = rounded;
    const element =
      rounded === 0 ? this.deferredElement : this.options.getContentElement();
    if (element === null) return;
    element.style.transform =
      rounded === 0 ? "" : `translate3d(0, ${-rounded}px, 0)`;
    this.deferredElement = rounded === 0 ? null : element;
  }

  private setPosition(next: ReadingPosition): void {
    const wasAttached = this.position.kind === "bottom";
    this.position = next;
    if (wasAttached !== (next.kind === "bottom")) {
      for (const listener of this.listeners) listener();
    }
  }

  private notifyLists(urgent = true): void {
    for (const list of this.lists) list.onPositionChange(urgent);
    for (const listener of this.positionListeners) listener();
  }

  private edgeTop(
    scrollElement: HTMLElement,
    element: HTMLElement,
    edge: ScrollHoldEdge,
  ): number {
    const rect = element.getBoundingClientRect();
    return (
      (edge === "top" ? rect.top : rect.bottom) -
      scrollElement.getBoundingClientRect().top
    );
  }
}
