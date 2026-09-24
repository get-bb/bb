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

    document.addEventListener("click", handleDocumentClick, true);
    return () => {
      document.removeEventListener("click", handleDocumentClick, true);
    };
  }, [consumeDragClickSuppression]);

  useEffect(() => clearScheduledTimeout, [clearScheduledTimeout]);

  return {
    beginDragClickSuppression,
    clearDragClickSuppressionSoon,
    consumeDragClickSuppression,
  };
}
