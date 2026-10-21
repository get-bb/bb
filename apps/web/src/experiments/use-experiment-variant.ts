import { useRouteContext, useRouterState } from "@tanstack/react-router";
import { PAGE_EXPERIMENT_REGISTRY } from "./registry";

export function useExperimentVariant(id: string): string {
  const { pageExperiments } = useRouteContext({ from: "__root__" });
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const experiment = PAGE_EXPERIMENT_REGISTRY.find(
    (entry) =>
      entry.id === id &&
      entry.status === "live" &&
      entry.pages.includes(pathname),
  );
  return experiment ? (pageExperiments?.[id] ?? "control") : "control";
}
