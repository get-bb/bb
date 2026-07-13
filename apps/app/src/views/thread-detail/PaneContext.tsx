import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import {
  getSurfaceAwareThreadRoutePath,
  type ThreadRoutePathArgs,
  type ThreadRouteSurface,
} from "@/lib/route-paths";

export interface PaneContextValue {
  paneId: string;
  isFocused: boolean;
  navigateInPane: (thread: ThreadRoutePathArgs) => void;
}

export const PaneContext = createContext<PaneContextValue | null>(null);

export function usePaneContext(): PaneContextValue {
  const context = useContext(PaneContext);
  if (context === null) {
    throw new Error("usePaneContext must be used within a <PaneContext>");
  }
  return context;
}

interface DefaultPaneContextProviderProps {
  children: ReactNode;
  surface: ThreadRouteSurface;
}

export function DefaultPaneContextProvider({
  children,
  surface,
}: DefaultPaneContextProviderProps) {
  const navigate = useNavigate();
  const navigateInPane = useCallback(
    (thread: ThreadRoutePathArgs) => {
      navigate(
        getSurfaceAwareThreadRoutePath({
          ...thread,
          surface,
        }),
      );
    },
    [navigate, surface],
  );
  const value = useMemo<PaneContextValue>(
    () => ({
      paneId: "main",
      isFocused: true,
      navigateInPane,
    }),
    [navigateInPane],
  );

  return <PaneContext.Provider value={value}>{children}</PaneContext.Provider>;
}
