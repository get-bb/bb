import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

const ReasoningExpansionContext = createContext<Map<string, boolean> | null>(
  null,
);

export function TimelineReasoningExpansionProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [overrides] = useState(() => new Map<string, boolean>());
  return (
    <ReasoningExpansionContext.Provider value={overrides}>
      {children}
    </ReasoningExpansionContext.Provider>
  );
}

export function useTimelineReasoningExpansion(key: string | undefined) {
  const overrides = useContext(ReasoningExpansionContext);
  const [expanded, setExpanded] = useState<boolean | null>(() =>
    key === undefined ? null : (overrides?.get(key) ?? null),
  );
  const setOverride = useCallback(
    (value: boolean) => {
      if (key !== undefined) overrides?.set(key, value);
      setExpanded(value);
    },
    [key, overrides],
  );
  return [expanded, setOverride] as const;
}
