import { listSidebarNavigationThreads } from "@/hooks/cache-owners/query-cache";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import { useSystemConfig } from "@/hooks/queries/system-queries";

export function useSetupComplete(): boolean {
  const settings = useSystemConfig().data?.generalSettings;
  const onboarded =
    settings !== undefined && settings.onboardingCompletedAt !== null;
  const navigation = useSidebarNavigation({ enabled: onboarded }).data;
  return (
    onboarded &&
    navigation !== undefined &&
    listSidebarNavigationThreads(navigation).length > 0
  );
}
