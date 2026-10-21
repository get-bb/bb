import { useStore } from "jotai";
import {
  createContext,
  useCallback,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from "react";
import { cn } from "@bb/shared-ui/lib/utils";
import { usePrefersReducedMotion } from "@bb/shared-ui/hooks/use-media-query";
import { usePointerCoarse } from "@bb/shared-ui/hooks/use-pointer-coarse";
import {
  isDocumentVisible,
  subscribeToDocumentVisibility,
} from "@/lib/document-visibility";
import { supportsScrollAnchoring } from "@/lib/scroll-anchoring-support";
import {
  observedBorderBoxBlockSize,
  observeSharedResize,
} from "@/lib/shared-resize-observer";
import { layoutAnimationInFlightCountAtom } from "./layoutAnimationAtoms.js";

const HEIGHT_TRANSITION_DURATION_MS = 180;
const HEIGHT_TRANSITION_EASE_CSS = "cubic-bezier(0.16, 1, 0.3, 1)";
const PAUSE_COLLAPSED_DESCENDANT_ANIMATIONS_CLASS =
  "[&_*]:![animation-play-state:paused]";

interface SnapState {
  savedDuration: string | null;
  restoreFrame: number | null;
}

interface IntrinsicHeightResizeState {
  restoreTimerId: number | null;
  usingIntrinsicHeight: boolean;
}

interface HeightSync {
  nextHeight: string;
  snap: boolean;
}

type AutoHeightSync =
  | { useIntrinsicHeight: true }
  | ({ useIntrinsicHeight: false } & HeightSync);

function enterSnapMode(target: HTMLElement, state: SnapState): void {
  if (state.savedDuration === null) {
    state.savedDuration = target.style.transitionDuration;
  }
  target.style.transitionDuration = "0s";
}

function scheduleRestore(target: HTMLElement, state: SnapState): void {
  if (state.restoreFrame !== null) {
    cancelAnimationFrame(state.restoreFrame);
  }
  state.restoreFrame = requestAnimationFrame(() => {
    state.restoreFrame = null;
    if (state.savedDuration === null) return;
    target.style.transitionDuration = state.savedDuration;
    state.savedDuration = null;
  });
}

function applyHeight(
  target: HTMLElement,
  nextHeight: string,
  snap: boolean,
  state: SnapState,
): void {
  const currentHeightPx = parseFloat(target.style.height);
  const nextHeightPx = parseFloat(nextHeight);
  const heightDecreasing =
    Number.isFinite(currentHeightPx) &&
    Number.isFinite(nextHeightPx) &&
    nextHeightPx < currentHeightPx;
  if (snap || heightDecreasing) {
    enterSnapMode(target, state);
    scheduleRestore(target, state);
  }
  target.style.height = nextHeight;
}

function cleanupSnapState(target: HTMLElement | null, state: SnapState): void {
  if (state.restoreFrame !== null) {
    cancelAnimationFrame(state.restoreFrame);
    state.restoreFrame = null;
  }
  if (state.savedDuration !== null && target) {
    target.style.transitionDuration = state.savedDuration;
    state.savedDuration = null;
  }
}

function enterIntrinsicHeightMode(
  target: HTMLElement,
  resizeState: IntrinsicHeightResizeState,
  snapState: SnapState,
): void {
  enterSnapMode(target, snapState);
  if (resizeState.usingIntrinsicHeight) {
    return;
  }
  target.style.height = "auto";
  resizeState.usingIntrinsicHeight = true;
}

function scheduleIntrinsicHeightRestore(
  resizeState: IntrinsicHeightResizeState,
  restore: () => void,
): void {
  if (resizeState.restoreTimerId !== null) {
    window.clearTimeout(resizeState.restoreTimerId);
  }
  resizeState.restoreTimerId = window.setTimeout(() => {
    resizeState.restoreTimerId = null;
    if (!resizeState.usingIntrinsicHeight) return;
    restore();
  }, AUTO_HEIGHT_WIDTH_RESIZE_SETTLE_MS);
}

function cancelIntrinsicHeightRestore(
  resizeState: IntrinsicHeightResizeState,
): void {
  if (resizeState.restoreTimerId === null) {
    return;
  }
  window.clearTimeout(resizeState.restoreTimerId);
  resizeState.restoreTimerId = null;
}

function getObservedInnerHeight(
  entry: ResizeObserverEntry | undefined,
  inner: HTMLElement,
): number {
  const observed =
    entry === undefined ? undefined : observedBorderBoxBlockSize(entry);
  return observed ?? inner.offsetHeight;
}

function getObservedInnerWidth(
  entry: ResizeObserverEntry | undefined,
  inner: HTMLElement,
): number {
  return (
    entry?.borderBoxSize?.[0]?.inlineSize ?? inner.getBoundingClientRect().width
  );
}

interface HeightTransitionProps {
  visible: boolean;
  children: ReactNode;
}

export function HeightTransition({ visible, children }: HeightTransitionProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const store = useStore();
  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    const inner = innerRef.current;
    if (!wrapper || !inner) return;
    wrapper.style.height = visible ? `${inner.offsetHeight}px` : "0px";
    if (typeof ResizeObserver === "undefined") return;
    let lastWidth = inner.getBoundingClientRect().width;
    let useLiveMeasurement = true;
    let pendingVisibilitySnap = false;
    const snapState: SnapState = { savedDuration: null, restoreFrame: null };
    const resize = observeSharedResize(inner, {
      read: (entry): HeightSync => {
        const measurement = useLiveMeasurement ? undefined : entry;
        const width = getObservedInnerWidth(measurement, inner);
        const widthChanged = width !== lastWidth;
        const layoutAnimationActive =
          store.get(layoutAnimationInFlightCountAtom) > 0;
        const snap =
          widthChanged || pendingVisibilitySnap || layoutAnimationActive;
        lastWidth = width;
        return {
          nextHeight: visible
            ? `${getObservedInnerHeight(measurement, inner)}px`
            : "0px",
          snap,
        };
      },
      write: ({ nextHeight, snap }) => {
        useLiveMeasurement = false;
        pendingVisibilitySnap = false;
        applyHeight(wrapper, nextHeight, snap, snapState);
      },
      coalesce: (previous, latest) => ({
        ...latest,
        snap: previous.snap || latest.snap,
      }),
    });
    const onVisibility = () => {
      if (!isDocumentVisible()) return;
      resize.discardPending();
      useLiveMeasurement = true;
      pendingVisibilitySnap = true;
      lastWidth = inner.getBoundingClientRect().width;
      const nextHeight = visible ? `${inner.offsetHeight}px` : "0px";
      applyHeight(wrapper, nextHeight, true, snapState);
    };
    const unsubscribeFromDocumentVisibility =
      subscribeToDocumentVisibility(onVisibility);
    return () => {
      resize.disconnect();
      unsubscribeFromDocumentVisibility();
      cleanupSnapState(wrapper, snapState);
    };
  }, [visible, store]);
  return (
    <div
      ref={wrapperRef}
      className={cn(!visible && PAUSE_COLLAPSED_DESCENDANT_ANIMATIONS_CLASS)}
      style={{
        overflowX: "visible",
        overflowY: "clip",
        opacity: visible ? 1 : 0,
        transition: `height ${HEIGHT_TRANSITION_DURATION_MS}ms ${HEIGHT_TRANSITION_EASE_CSS}, opacity ${HEIGHT_TRANSITION_DURATION_MS}ms ${HEIGHT_TRANSITION_EASE_CSS}`,
      }}
    >
      {}
      <div ref={innerRef} style={{ display: "flow-root" }}>
        {children}
      </div>
    </div>
  );
}

export const AutoHeightSnapContext = createContext<(() => void) | null>(null);

interface AutoHeightContainerProps {
  children: ReactNode;
  snapRevision?: string;
  animateGrowth?: boolean;
}

const AUTO_HEIGHT_INITIAL_SETTLE_MS = 250;
const AUTO_HEIGHT_WIDTH_RESIZE_SETTLE_MS = 120;

function useSnapHeightGrowth(): boolean {
  const isPointerCoarse = usePointerCoarse();
  const prefersReducedMotion = usePrefersReducedMotion();
  return isPointerCoarse || prefersReducedMotion || !supportsScrollAnchoring();
}

export function AutoHeightContainer({
  children,
  snapRevision,
  animateGrowth = true,
}: AutoHeightContainerProps) {
  const snapGrowth = useSnapHeightGrowth();
  const durationMs =
    snapGrowth || !animateGrowth ? 0 : HEIGHT_TRANSITION_DURATION_MS;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const snapToCurrentHeightRef = useRef<(() => void) | null>(null);
  const previousSnapRevisionRef = useRef(snapRevision);
  const store = useStore();
  const snapToContentHeight = useCallback(() => {
    snapToCurrentHeightRef.current?.();
  }, []);
  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    const inner = innerRef.current;
    if (!wrapper || !inner || typeof ResizeObserver === "undefined") return;
    wrapper.style.height = `${inner.offsetHeight}px`;
    let lastWidth: number | null = null;
    let useLiveMeasurement = false;
    let pendingVisibilitySnap = false;
    let initialSettleComplete = false;
    let initialSettleTimerId = window.setTimeout(() => {
      initialSettleComplete = true;
    }, AUTO_HEIGHT_INITIAL_SETTLE_MS);
    const snapState: SnapState = { savedDuration: null, restoreFrame: null };
    const resizeState: IntrinsicHeightResizeState = {
      restoreTimerId: null,
      usingIntrinsicHeight: false,
    };
    const snapToCurrentHeight = () => {
      resize.discardPending();
      useLiveMeasurement = true;
      lastWidth = inner.getBoundingClientRect().width;
      cancelIntrinsicHeightRestore(resizeState);
      resizeState.usingIntrinsicHeight = false;
      applyHeight(wrapper, `${inner.offsetHeight}px`, true, snapState);
    };
    snapToCurrentHeightRef.current = snapToCurrentHeight;
    const deferInitialSettleComplete = () => {
      if (initialSettleComplete) {
        return;
      }
      window.clearTimeout(initialSettleTimerId);
      initialSettleTimerId = window.setTimeout(() => {
        initialSettleComplete = true;
      }, AUTO_HEIGHT_INITIAL_SETTLE_MS);
    };
    const resize = observeSharedResize(inner, {
      read: (entry): AutoHeightSync => {
        const measurement = useLiveMeasurement ? undefined : entry;
        const width = getObservedInnerWidth(measurement, inner);
        const widthChanged = lastWidth !== null && width !== lastWidth;
        const layoutAnimationActive =
          store.get(layoutAnimationInFlightCountAtom) > 0;
        const snap =
          widthChanged ||
          pendingVisibilitySnap ||
          !initialSettleComplete ||
          layoutAnimationActive;
        lastWidth = width;
        if (widthChanged || resizeState.usingIntrinsicHeight) {
          return { useIntrinsicHeight: true };
        }
        return {
          useIntrinsicHeight: false,
          nextHeight: `${getObservedInnerHeight(measurement, inner)}px`,
          snap,
        };
      },
      write: (sync) => {
        useLiveMeasurement = false;
        pendingVisibilitySnap = false;
        if (sync.useIntrinsicHeight) {
          enterIntrinsicHeightMode(wrapper, resizeState, snapState);
          scheduleIntrinsicHeightRestore(resizeState, snapToCurrentHeight);
          deferInitialSettleComplete();
          return;
        }
        applyHeight(wrapper, sync.nextHeight, sync.snap, snapState);
        deferInitialSettleComplete();
      },
      coalesce: (previous, latest): AutoHeightSync =>
        previous.useIntrinsicHeight || latest.useIntrinsicHeight
          ? { useIntrinsicHeight: true }
          : { ...latest, snap: previous.snap || latest.snap },
    });
    const onVisibility = () => {
      if (!isDocumentVisible()) return;
      pendingVisibilitySnap = true;
      snapToCurrentHeight();
    };
    const unsubscribeFromDocumentVisibility =
      subscribeToDocumentVisibility(onVisibility);
    return () => {
      snapToCurrentHeightRef.current = null;
      resize.disconnect();
      unsubscribeFromDocumentVisibility();
      window.clearTimeout(initialSettleTimerId);
      cancelIntrinsicHeightRestore(resizeState);
      cleanupSnapState(wrapper, snapState);
    };
  }, [store]);
  useLayoutEffect(() => {
    if (previousSnapRevisionRef.current === snapRevision) {
      return;
    }
    previousSnapRevisionRef.current = snapRevision;
    snapToCurrentHeightRef.current?.();
  }, [snapRevision]);
  return (
    <AutoHeightSnapContext.Provider value={snapToContentHeight}>
      <div
        ref={wrapperRef}
        style={{
          overflowX: "visible",
          overflowY: "clip",
          transition: `height ${durationMs}ms ${HEIGHT_TRANSITION_EASE_CSS}`,
        }}
      >
        <div ref={innerRef} style={{ display: "flow-root" }}>
          {children}
        </div>
      </div>
    </AutoHeightSnapContext.Provider>
  );
}
