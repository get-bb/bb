import { useCallback, useEffect, useRef, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import type { ImperativePanelHandle } from "react-resizable-panels";
import { useResizeObserver } from "usehooks-ts";
import { applyResizeCursor, clearResizeCursor } from "@/lib/resizeCursor";
import {
  secondaryPanelWidthPercentAtom,
  threadSecondaryPanelResizingAtom,
} from "./threadSecondaryPanelAtoms";

export type SecondaryPanelDraggingHandler = (isDragging: boolean) => void;
export type SecondaryPanelWidthChangeHandler = (
  width: number | undefined,
) => void;

type SecondaryPanelResizeHandler = (size: number) => void;

interface UseSecondaryPanelResizeArgs {
  isSecondaryPanelOpen: boolean;
  onPanelWidthChange: SecondaryPanelWidthChangeHandler;
}

export function useSecondaryPanelResize({
  isSecondaryPanelOpen,
  onPanelWidthChange,
}: UseSecondaryPanelResizeArgs) {
  const [isSecondaryPanelDragging, setIsSecondaryPanelDragging] =
    useState(false);
  const persistedWidthPercent = useAtomValue(secondaryPanelWidthPercentAtom);
  const setPersistedWidthPercent = useSetAtom(secondaryPanelWidthPercentAtom);
  const setIsResizing = useSetAtom(threadSecondaryPanelResizingAtom);
  const secondaryPanelRef = useRef<HTMLElement>(null!);
  const secondaryResizablePanelRef = useRef<ImperativePanelHandle | null>(null);
  const isSecondaryPanelDraggingRef = useRef(false);
  const lastSecondaryPanelSizeRef = useRef(persistedWidthPercent);

  const prevOpenRef = useRef(isSecondaryPanelOpen);
  useEffect(() => {
    // Skip initial mount — Panel's defaultSize handles it.
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

  const finishSecondaryPanelDragging = useCallback(() => {
    isSecondaryPanelDraggingRef.current = false;
    setIsSecondaryPanelDragging(false);
    setIsResizing(false);
    clearResizeCursor();

    // Drag finished — persist the user's chosen width.
    if (lastSecondaryPanelSizeRef.current > 0) {
      setPersistedWidthPercent(lastSecondaryPanelSizeRef.current);
    }
  }, [setIsResizing, setPersistedWidthPercent]);

  const handleSecondaryPanelDragging =
    useCallback<SecondaryPanelDraggingHandler>(
      (isDragging) => {
        if (isDragging) {
          isSecondaryPanelDraggingRef.current = true;
          setIsSecondaryPanelDragging(true);
          setIsResizing(true);
          applyResizeCursor("horizontal");
          return;
        }

        finishSecondaryPanelDragging();
      },
      [finishSecondaryPanelDragging, setIsResizing],
    );

  useEffect(
    () => () => {
      if (!isSecondaryPanelDraggingRef.current) {
        return;
      }
      isSecondaryPanelDraggingRef.current = false;
      setIsResizing(false);
      clearResizeCursor();
    },
    [setIsResizing],
  );

  useEffect(() => {
    if (!isSecondaryPanelDragging) {
      return;
    }

    window.addEventListener("pointerup", finishSecondaryPanelDragging, true);
    window.addEventListener("mouseup", finishSecondaryPanelDragging, true);
    window.addEventListener(
      "pointercancel",
      finishSecondaryPanelDragging,
      true,
    );
    window.addEventListener("blur", finishSecondaryPanelDragging);

    return () => {
      window.removeEventListener(
        "pointerup",
        finishSecondaryPanelDragging,
        true,
      );
      window.removeEventListener("mouseup", finishSecondaryPanelDragging, true);
      window.removeEventListener(
        "pointercancel",
        finishSecondaryPanelDragging,
        true,
      );
      window.removeEventListener("blur", finishSecondaryPanelDragging);
    };
  }, [finishSecondaryPanelDragging, isSecondaryPanelDragging]);

  const handleSecondaryPanelResize = useCallback<SecondaryPanelResizeHandler>(
    (size) => {
      if (size <= 0) {
        return;
      }

      lastSecondaryPanelSizeRef.current = size;
      // Mirror the live panel size onto the content's fixed width (container-query
      // units against the horizontal group) for swipe mode: the content holds the
      // open width while the panel's width transition clips it, and tracks the
      // size live during a drag-resize. Guarding size > 0 leaves the width at the
      // last open value through a collapse, so the content swipes out cleanly.
      secondaryPanelRef.current?.style.setProperty(
        "--secondary-swipe-width",
        `${size}cqw`,
      );
    },
    [],
  );

  return {
    handleSecondaryPanelDragging,
    handleSecondaryPanelResize,
    persistedWidthPercent,
    secondaryPanelRef,
    secondaryResizablePanelRef,
  };
}
