import { useMemo } from "react";
import { cn } from "@bb/shared-ui/lib/utils";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import {
  SidebarVisibilityCustomize,
  type SidebarVisibilityItem,
} from "./SidebarVisibilityControls";
import {
  SidebarNavigationIcon,
  useSidebarNavigationModel,
} from "./SidebarNavigationModel";

export function SidebarNavigationCustomize({
  onClose,
}: {
  onClose: (restoreFocus: boolean) => void;
}) {
  const model = useSidebarNavigationModel();
  const isCompactViewport = useIsCompactViewport();
  const items = useMemo<SidebarVisibilityItem[]>(
    () =>
      (model?.state.items ?? []).map((item) => ({
        id: item.id,
        title: item.label,
        icon: <SidebarNavigationIcon icon={item.icon} />,
        ...(item.isDisabled ? { disabled: true } : {}),
      })),
    [model?.state.items],
  );
  if (model === null) return null;
  const { arrangement, state } = model;
  return (
    <div
      className={cn(
        "px-2 py-2",
        isCompactViewport ? "flex min-h-0 flex-1 flex-col" : "shrink-0",
      )}
      data-testid="plugin-nav-sidebar-items"
      data-sidebar-navigation-customize-mode="true"
    >
      <SidebarVisibilityCustomize
        title="Customize sidebar"
        listLabel="Sidebar navigation"
        variant={isCompactViewport ? "compact" : "card"}
        items={items}
        visibleIds={arrangement.visibleKeys}
        onActivate={(item, event) =>
          state.actions.activate(item.id, {
            openInSplit: event.metaKey || event.ctrlKey,
          })
        }
        onDone={() => onClose(true)}
        onExit={() => onClose(false)}
        onReorder={arrangement.moveAny}
        onVisibleChange={arrangement.setVisible}
      />
    </div>
  );
}
