import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { RESET } from "jotai/utils";
import type { ImperativePanelHandle } from "react-resizable-panels";
import {
  SecondaryPanelWidthPercentAtomContext,
  threadSecondaryPanelResizingAtom,
} from "./threadSecondaryPanelAtoms";
import { usePanelResizeSnap } from "./usePanelResizeSnap";

type SecondaryPanelResizeHandler = (size: number) => void;

interface UseSecondaryPanelResizeArgs {
  isSecondaryPanelOpen: boolean;
  panelId: string;
  renderAsDrawer: boolean;
}

export function useSecondaryPanelResize({
  isSecondaryPanelOpen,
  panelId,
  renderAsDrawer,
}: UseSecondaryPanelResizeArgs) {
  const widthPercentAtom = useContext(SecondaryPanelWidthPercentAtomContext);
  const persistedWidthPercent = useAtomValue(widthPercentAtom);
  const setPersistedWidthPercent = useSetAtom(widthPercentAtom);
  const setIsResizing = useSetAtom(threadSecondaryPanelResizingAtom);
  const secondaryPanelRef = useRef<HTMLElement>(null!);
  const secondaryResizablePanelRef = useRef<ImperativePanelHandle | null>(null);
  const lastSecondaryPanelSizeRef = useRef(persistedWidthPercent);
  const didPointerResizeRef = useRef(false);
  const isDraggingRef = useRef(false);
  const applySwipeWidth = useCallback((size: number) => {
    secondaryPanelRef.current?.style.setProperty(
      "--secondary-swipe-width",
      `${size}cqw`,
    );
  }, []);
  const handleSecondaryPanelPointerResize = useCallback(
    (leadingFraction: number) => {
      didPointerResizeRef.current = true;
      secondaryResizablePanelRef.current?.resize((1 - leadingFraction) * 100);
    },
    [],
  );
  const handleSecondaryPanelDragging = useCallback(
    (isDragging: boolean) => {
      isDraggingRef.current = isDragging;
      if (isDragging) {
        setIsResizing(true);
        didPointerResizeRef.current = false;
        return;
      }
      applySwipeWidth(lastSecondaryPanelSizeRef.current);
      setIsResizing(false);
      if (
        didPointerResizeRef.current &&
        lastSecondaryPanelSizeRef.current > 0
      ) {
        setPersistedWidthPercent(lastSecondaryPanelSizeRef.current);
      }
    },
    [applySwipeWidth, setIsResizing, setPersistedWidthPercent],
  );
  const handleSecondaryPanelReset = useCallback(() => {
    setPersistedWidthPercent(RESET);
  }, [setPersistedWidthPercent]);
  const resizeHitTargetRef = usePanelResizeSnap({
    onResize: handleSecondaryPanelPointerResize,
    onDragging: handleSecondaryPanelDragging,
    onReset: handleSecondaryPanelReset,
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
    } else {
      panel.collapse();
    }
  }, [isSecondaryPanelOpen]);

  const handleSecondaryPanelResize = useCallback<SecondaryPanelResizeHandler>(
    (size) => {
      if (size <= 0) {
        return;
      }

      lastSecondaryPanelSizeRef.current = size;
      if (!isDraggingRef.current) applySwipeWidth(size);
    },
    [applySwipeWidth],
  );

  useLayoutEffect(() => {
    const panel =
      secondaryPanelRef.current?.closest<HTMLElement>("[data-panel]");
    const size = Number.parseFloat(panel?.style.flexGrow ?? "");
    if (Number.isFinite(size)) handleSecondaryPanelResize(size);
  }, [
    handleSecondaryPanelResize,
    isSecondaryPanelOpen,
    panelId,
    renderAsDrawer,
  ]);

  return {
    handleSecondaryPanelResize,
    resizeHitTargetRef,
    persistedWidthPercent,
    secondaryPanelRef,
    secondaryResizablePanelRef,
  };
}
