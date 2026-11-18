import { useRouteContext } from "@tanstack/react-router";
import { createContext, useContext, type ReactNode } from "react";

import { NO_EXPERIMENTS, type ExperimentBootstrap } from "./flags";

const ExperimentsContext = createContext<ExperimentBootstrap>(NO_EXPERIMENTS);

export function ExperimentsProvider({
  value,
  children,
}: {
  value: ExperimentBootstrap;
  children: ReactNode;
}) {
  return (
    <ExperimentsContext.Provider value={value}>
      {children}
    </ExperimentsContext.Provider>
  );
}

export function RouteExperimentsProvider({
  children,
}: {
  children: ReactNode;
}) {
  const value = useRouteContext({
    from: "__root__",
    select: (context) => context?.experiments ?? NO_EXPERIMENTS,
  });
  return <ExperimentsProvider value={value}>{children}</ExperimentsProvider>;
}

export function useExperimentBootstrap(): ExperimentBootstrap {
  return useContext(ExperimentsContext);
}
