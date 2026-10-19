import { useMemo, type RefObject } from "react";
import type { ExperimentalSidebarNavigationPlacement } from "@get-bb/plugin-sdk";
import { PopoverContent } from "@bb/shared-ui/popover";
import type { SidebarVisibilityItem } from "@bb/shared-ui/sidebar-visibility-customize";
import { SidebarVisibilityCustomize } from "./SidebarVisibilityControls";
import {
  SidebarNavigationIcon,
  useSidebarNavigationModel,
} from "./SidebarNavigationModel";

const CUSTOMIZE_SIDE_OFFSET = 12;

export function SidebarNavigationCustomize({
  title,
  placement,
  onClose,
}: {
  title: string;
  placement: ExperimentalSidebarNavigationPlacement;
  onClose: (restoreFocus: boolean) => void;
}) {
  const model = useSidebarNavigationModel();
  const items = useMemo<SidebarVisibilityItem[]>(
    () =>
      model.state.items
        .filter(
          (item) => placement === "list" || item.action.kind !== "new-thread",
        )
        .map((item) => ({
          id: item.id,
          title: item.label,
          icon: <SidebarNavigationIcon icon={item.icon} />,
          ...(item.isDisabled ? { disabled: true } : {}),
        })),
    [model.state.items, placement],
  );
  const { arrangement } = model;
  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-testid="plugin-nav-sidebar-items"
      data-sidebar-navigation-customize-mode="true"
    >
      <SidebarVisibilityCustomize
        title={title}
        listLabel="Sidebar navigation"
        variant="compact"
        items={items}
        visibleIds={arrangement.visibleKeys}
        onDone={() => onClose(true)}
        onReorder={arrangement.moveAny}
        onVisibleChange={arrangement.setVisible}
      />
    </div>
  );
}

export function SidebarNavigationCustomizePopoverContent({
  testId,
  placement,
  focusReturnRef,
  onClose,
}: {
  testId: string;
  placement: ExperimentalSidebarNavigationPlacement;
  focusReturnRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const title = "Customize navigation";
  return (
    <PopoverContent
      side="right"
      align="start"
      sideOffset={CUSTOMIZE_SIDE_OFFSET}
      aria-label={title}
      mobileTitle={title}
      data-testid={testId}
      className="flex max-h-(--radix-popover-content-available-height) flex-col p-2 md:w-64"
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        focusReturnRef.current?.focus();
      }}
    >
      <SidebarNavigationCustomize
        title={title}
        placement={placement}
        onClose={onClose}
      />
    </PopoverContent>
  );
}
