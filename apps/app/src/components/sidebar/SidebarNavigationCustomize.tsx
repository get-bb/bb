import { useMemo } from "react";
import type { SidebarVisibilityItem } from "@bb/shared-ui/sidebar-visibility-customize";
import { SidebarVisibilityCustomize } from "./SidebarVisibilityControls";
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
  const items = useMemo<SidebarVisibilityItem[]>(
    () =>
      model.state.items.map((item) => ({
        id: item.id,
        title: item.label,
        icon: <SidebarNavigationIcon icon={item.icon} />,
        ...(item.isDisabled ? { disabled: true } : {}),
      })),
    [model.state.items],
  );
  const { arrangement, state } = model;
  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-testid="plugin-nav-sidebar-items"
      data-sidebar-navigation-customize-mode="true"
    >
      <SidebarVisibilityCustomize
        title="Customize rail"
        listLabel="Sidebar navigation"
        variant="compact"
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
