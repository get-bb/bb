import { useSystemConfig } from "@/hooks/queries/system-queries";

export function useNavigationRailExperiment(): boolean {
  return useSystemConfig().data?.experiments.navigationRail ?? false;
}
