import { useStore } from "jotai";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  isDocumentVisible,
  subscribeToDocumentVisibility,
} from "@/lib/document-visibility";
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

function getObservedInnerHeight(
  entry: ResizeObserverEntry | undefined,
  inner: HTMLElement,
): number {
  const observed =
    entry === undefined ? undefined : observedBorderBoxBlockSize(entry);
  return observed ?? inner.offsetHeight;
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
    let lastWidth: number | null = null;
    let pendingVisibilitySnap = false;
    const snapState: SnapState = { savedDuration: null, restoreFrame: null };
    const unobserveInner = observeSharedResize(inner, {
      read: (entry) => {
        const width = entry?.contentRect?.width;
        const widthChanged =
          lastWidth !== null && width !== undefined && width !== lastWidth;
        const layoutAnimationActive =
          store.get(layoutAnimationInFlightCountAtom) > 0;
        const snap =
          widthChanged || pendingVisibilitySnap || layoutAnimationActive;
        pendingVisibilitySnap = false;
        if (width !== undefined) {
          lastWidth = width;
        }
        return {
          nextHeight: visible
            ? `${getObservedInnerHeight(entry, inner)}px`
            : "0px",
          snap,
        };
      },
      write: ({ nextHeight, snap }) => {
        applyHeight(wrapper, nextHeight, snap, snapState);
      },
    });
    const onVisibility = () => {
      if (!isDocumentVisible()) return;
      pendingVisibilitySnap = true;
      const nextHeight = visible ? `${inner.offsetHeight}px` : "0px";
      applyHeight(wrapper, nextHeight, true, snapState);
    };
    const unsubscribeFromDocumentVisibility =
      subscribeToDocumentVisibility(onVisibility);
    return () => {
      unobserveInner();
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
