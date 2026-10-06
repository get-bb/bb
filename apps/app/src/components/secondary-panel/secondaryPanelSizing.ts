import { createContext, useContext, useMemo } from "react";
import { useElementWidth } from "@/hooks/useElementWidth";
import { splitWidthLimits } from "@/lib/split-layout/sizing";

export const SecondaryPanelMinimumContext = createContext({ min: 0, max: 1 });

export function useSecondaryPanelMinimum() {
  return useContext(SecondaryPanelMinimumContext);
}

export function useSecondaryPanelSizing(dividerWidth = 0) {
  const { ref, width } = useElementWidth();
  const minimum = useMemo(
    () =>
      width > 0
        ? splitWidthLimits(width - dividerWidth)
        : { min: 0, max: 1 },
    [width, dividerWidth],
  );
  return { ref, minimum };
}

export const CONVERSATION_COLLAPSED_PANEL_SIZE_PERCENT = 100;
