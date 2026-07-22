import { createContext, useContext, type ReactNode } from "react";

const ToolsHubExperimentContext = createContext(false);

export function ToolsHubExperimentProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  return (
    <ToolsHubExperimentContext.Provider value={enabled}>
      {children}
    </ToolsHubExperimentContext.Provider>
  );
}

export function useToolsHubExperiment(): boolean {
  return useContext(ToolsHubExperimentContext);
}
