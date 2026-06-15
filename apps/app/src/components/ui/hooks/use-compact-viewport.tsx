import {
  createContext,
  createElement,
  useContext,
  type ReactNode,
} from "react";

import { useMediaQuery } from "./use-media-query.js";

export const COMPACT_VIEWPORT_QUERY = "(max-width: 767px)";

const CompactViewportOverrideContext = createContext<boolean | null>(null);

interface CompactViewportOverrideProviderProps {
  children: ReactNode;
  isCompactViewport: boolean;
}

export function CompactViewportOverrideProvider({
  children,
  isCompactViewport,
}: CompactViewportOverrideProviderProps) {
  return createElement(
    CompactViewportOverrideContext.Provider,
    { value: isCompactViewport },
    children,
  );
}

export function useIsCompactViewport(): boolean {
  const override = useContext(CompactViewportOverrideContext);
  const isCompactViewport = useMediaQuery(COMPACT_VIEWPORT_QUERY);
  if (override !== null) {
    return override;
  }
  return isCompactViewport;
}
