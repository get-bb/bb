import { Skeleton } from "@bb/shared-ui/skeleton";
import { SectionSidebar } from "@/components/sidebar/SectionSidebar";
import type { RouteSidebarProps } from "@/components/layout/routeSidebar";
import { defineSplit, SplitLoadFailure } from "@/lib/define-split";

function SettingsSidebarPlaceholder({
  retry,
  ...props
}: RouteSidebarProps & { retry?: () => void }) {
  return (
    <SectionSidebar title="Settings" testIdPrefix="settings" {...props}>
      {retry ? (
        <SplitLoadFailure retry={retry} />
      ) : (
        <div
          role="status"
          aria-label="Loading settings navigation"
          className="space-y-3 p-3"
        >
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      )}
    </SectionSidebar>
  );
}

export const LazySettingsSidebar = defineSplit<RouteSidebarProps>({
  id: "settings-sidebar",
  load: () =>
    import("./SettingsSidebar").then((module) => module.SettingsSidebar),
  loading: SettingsSidebarPlaceholder,
  error: SettingsSidebarPlaceholder,
  tier: "preload",
});
