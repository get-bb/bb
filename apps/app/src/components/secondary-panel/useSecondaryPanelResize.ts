import { useCallback, useEffect, useRef } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import type { ImperativePanelHandle } from "react-resizable-panels";
import { useResizeObserver } from "usehooks-ts";
import {
  secondaryPanelWidthPercentAtom,
  threadSecondaryPanelResizingAtom,
} from "./threadSecondaryPanelAtoms";
import { usePanelResizeSnap } from "./usePanelResizeSnap";
import {
  THREAD_SECONDARY_PANEL_MAX_SIZE_PERCENT,
  THREAD_SECONDARY_PANEL_MIN_SIZE_PERCENT,
} from "./secondaryPanelSizing";

export type SecondaryPanelWidthChangeHandler = (
  width: number | undefined,
) => void;

type SecondaryPanelResizeHandler = (size: number) => void;

interface UseSecondaryPanelResizeArgs {
  isSecondaryPanelOpen: boolean;
  onPanelWidthChange: SecondaryPanelWidthChangeHandler;
  onResizeStart: () => void;
}

export function useSecondaryPanelResize({
  isSecondaryPanelOpen,
  onPanelWidthChange,
  onResizeStart,
}: UseSecondaryPanelResizeArgs) {
  const persistedWidthPercent = useAtomValue(secondaryPanelWidthPercentAtom);
  const setPersistedWidthPercent = useSetAtom(secondaryPanelWidthPercentAtom);
  const setIsResizing = useSetAtom(threadSecondaryPanelResizingAtom);
  const secondaryPanelRef = useRef<HTMLElement>(null!);
  const secondaryResizablePanelRef = useRef<ImperativePanelHandle | null>(null);
  const lastSecondaryPanelSizeRef = useRef(persistedWidthPercent);
  const handleSecondaryPanelPointerResize = useCallback(
    (leadingFraction: number) => {
      secondaryResizablePanelRef.current?.resize((1 - leadingFraction) * 100);
    },
    [],
  );
  const handleSecondaryPanelDragging = useCallback(
    (isDragging: boolean) => {
      setIsResizing(isDragging);
      if (isDragging) {
        onResizeStart();
      } else if (lastSecondaryPanelSizeRef.current > 0) {
        setPersistedWidthPercent(lastSecondaryPanelSizeRef.current);
      }
    },
    [onResizeStart, setIsResizing, setPersistedWidthPercent],
  );
  const resizeHitTargetRef = usePanelResizeSnap({
    axis: "x",
    minFraction: (100 - THREAD_SECONDARY_PANEL_MAX_SIZE_PERCENT) / 100,
    maxFraction: (100 - THREAD_SECONDARY_PANEL_MIN_SIZE_PERCENT) / 100,
    onResize: handleSecondaryPanelPointerResize,
    onDragging: handleSecondaryPanelDragging,
    target: { boundaryIndex: 1, childCount: 2 },
  });

  const prevOpenRef = useRef(isSecondaryPanelOpen);
  useEffect(() => {
    if (prevOpenRef.current === isSecondaryPanelOpen) {
      return;
    }
    prevOpenRef.current = isSecondaryPanelOpen;

    const panel = secondaryResizablePanelRef.current;
    if (!panel) {
      return;
    }

    if (isSecondaryPanelOpen) {
      panel.expand(lastSecondaryPanelSizeRef.current);
      onPanelWidthChange(
        secondaryPanelRef.current?.getBoundingClientRect().width,
      );
    } else {
      panel.collapse();
    }
  }, [isSecondaryPanelOpen, onPanelWidthChange]);

  useResizeObserver({
    ref: secondaryPanelRef,
    onResize: ({ width }) => {
      onPanelWidthChange(
        width ?? secondaryPanelRef.current?.getBoundingClientRect().width,
      );
    },
  });

  const handleSecondaryPanelResize = useCallback<SecondaryPanelResizeHandler>(
    (size) => {
      if (size <= 0) {
        return;
      }

      lastSecondaryPanelSizeRef.current = size;
      secondaryPanelRef.current?.style.setProperty(
        "--secondary-swipe-width",
        `${size}cqw`,
      );
    },
    [],
  );

  return {
    handleSecondaryPanelResize,
    resizeHitTargetRef,
    persistedWidthPercent,
    secondaryPanelRef,
    secondaryResizablePanelRef,
  };
}
