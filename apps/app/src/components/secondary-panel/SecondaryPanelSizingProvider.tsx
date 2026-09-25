import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useElementWidth } from "@/hooks/useElementWidth";
import { PANE_MIN_WIDTH_PX, splitWidthLimits } from "@/lib/split-layout/sizing";

const SecondaryPanelMinimumContext = createContext({ min: 0, max: 1 });

export function useSecondaryPanelMinimum() {
  return useContext(SecondaryPanelMinimumContext);
}

export function SecondaryPanelSizingProvider({
  children,
  mainMinimumWidth = PANE_MIN_WIDTH_PX,
  dividerWidth = 0,
}: {
  children: ReactNode;
  mainMinimumWidth?: number;
  dividerWidth?: number;
}) {
  const { ref, width } = useElementWidth();
  const minimum = useMemo(
    () =>
      width > 0
        ? splitWidthLimits(width - dividerWidth, mainMinimumWidth)
        : { min: 0, max: 1 },
    [width, mainMinimumWidth, dividerWidth],
  );
  return (
    <div ref={ref} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <SecondaryPanelMinimumContext.Provider value={minimum}>
        {children}
      </SecondaryPanelMinimumContext.Provider>
    </div>
  );
}
