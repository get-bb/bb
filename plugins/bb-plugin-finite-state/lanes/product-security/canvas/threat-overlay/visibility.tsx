import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

interface ThreatOverlayVisibility {
  collapsed: boolean;
  onCollapsedChange(collapsed: boolean): void;
}

const ThreatOverlayVisibilityContext =
  createContext<ThreatOverlayVisibility | null>(null);

export function ThreatOverlayVisibilityProvider({
  children,
}: {
  children: ReactNode;
}): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(false);
  const value = useMemo<ThreatOverlayVisibility>(
    () => ({ collapsed, onCollapsedChange: setCollapsed }),
    [collapsed],
  );
  return (
    <ThreatOverlayVisibilityContext.Provider value={value}>
      {children}
    </ThreatOverlayVisibilityContext.Provider>
  );
}

export function useThreatOverlayVisibility(): ThreatOverlayVisibility | null {
  return useContext(ThreatOverlayVisibilityContext);
}
