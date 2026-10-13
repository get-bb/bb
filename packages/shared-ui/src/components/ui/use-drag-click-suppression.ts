import { useCallback, useEffect, useRef } from "react";

const DRAG_CLICK_SUPPRESSION_MS = 350;

export type ConsumeDragClickSuppression = () => boolean;

interface UseDragClickSuppressionResult {
  beginDragClickSuppression: () => void;
  clearDragClickSuppressionSoon: () => void;
  consumeDragClickSuppression: ConsumeDragClickSuppression;
}

export function useDragClickSuppression(): UseDragClickSuppressionResult {
  const suppressClickRef = useRef(false);
  const timeoutRef = useRef<number | null>(null);

  const clearScheduledTimeout = useCallback(() => {
    if (timeoutRef.current === null) {
      return;
    }
    window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }, []);

  const clearSuppression = useCallback(() => {
    clearScheduledTimeout();
    suppressClickRef.current = false;
  }, [clearScheduledTimeout]);

  const beginDragClickSuppression = useCallback(() => {
    clearScheduledTimeout();
    suppressClickRef.current = true;
  }, [clearScheduledTimeout]);

  const clearDragClickSuppressionSoon = useCallback(() => {
    clearScheduledTimeout();
    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null;
      suppressClickRef.current = false;
    }, DRAG_CLICK_SUPPRESSION_MS);
  }, [clearScheduledTimeout]);

  const consumeDragClickSuppression =
    useCallback<ConsumeDragClickSuppression>(() => {
      if (!suppressClickRef.current) {
        return false;
      }
      clearSuppression();
      return true;
    }, [clearSuppression]);

  useEffect(() => {
    const handleDocumentClick = (event: MouseEvent) => {
      if (!consumeDragClickSuppression()) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };

    /*
     * A drag that ends without producing a click — released outside the window,
     * say — used to leave the flag armed for the rest of its timeout, and the
     * next click anywhere in the app paid for it. A fresh press is by
     * definition a new gesture, and the drag's own click always arrives before
     * one, so disarming here cannot swallow the suppression it is meant for.
     *
     * Both press events are watched rather than pointerdown alone: the sensor
     * that arms this works from mouse events, and a press that somehow arrives
     * without its pointer counterpart must still disarm.
     */
    document.addEventListener("pointerdown", clearSuppression, true);
    document.addEventListener("mousedown", clearSuppression, true);
    document.addEventListener("click", handleDocumentClick, true);
    return () => {
      document.removeEventListener("pointerdown", clearSuppression, true);
      document.removeEventListener("mousedown", clearSuppression, true);
      document.removeEventListener("click", handleDocumentClick, true);
    };
  }, [clearSuppression, consumeDragClickSuppression]);

  useEffect(() => clearScheduledTimeout, [clearScheduledTimeout]);

  return {
    beginDragClickSuppression,
    clearDragClickSuppressionSoon,
    consumeDragClickSuppression,
  };
}
